import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, open, readFile, rename, rm, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { withDirectoryLock, writeJsonAtomic } from "./reminder-utils.mjs";

export const SCHEDULER_RECOVERY_MESSAGE =
  "后台提醒更新失败，恢复未完成。请保留当前和旧版文件夹，处理恢复问题后再重试；不要继续覆盖任务或提醒资料。";

const activeTransactions = new Set();

function recoveryError(cause) {
  const error = new Error(SCHEDULER_RECOVERY_MESSAGE, { cause });
  error.code = "SCHEDULER_ROLLBACK_FAILED";
  error.userMessage = error.message;
  return error;
}

function transactionPath(root) {
  return resolve(root, "data", ".scheduler-update.json");
}

async function readOptionalFile(file) {
  try { return await readFile(file); } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function schedulerRecoveryPending(root) {
  const bytes = await readOptionalFile(transactionPath(root));
  if (!bytes) return false;
  try { return !["committed", "restored"].includes(JSON.parse(bytes).phase); }
  catch { return true; }
}

async function writeDurable(file, bytes, exclusive = false) {
  const temporary = exclusive ? file : `${file}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
  if (!exclusive) await rename(temporary, file);
}

async function saveTransaction(ticket, phase) {
  await writeDurable(ticket.file, JSON.stringify({ ...ticket.record, phase }));
  ticket.record.phase = phase;
}

async function finishTransaction(ticket, phase) {
  await saveTransaction(ticket, phase);
  ticket.closed = true;
  // A completed journal is safe to clean again on the next operation. Never
  // turn a cleanup error into a second attempt to mutate a restored task.
  try {
    await rm(ticket.record.taskSnapshot, { force: true });
    await rm(ticket.file, { force: true });
  } catch { /* Keep the completed journal for later cleanup. */ }
}

async function restoreFileSnapshot(root, file, bytes) {
  const destination = resolve(root, "data", file);
  if (bytes === null) await rm(destination, { force: true });
  else await writeDurable(destination, Buffer.from(bytes, "base64"));
  const actual = await readOptionalFile(destination);
  if ((actual === null ? null : actual.toString("base64")) !== bytes) {
    throw new Error("Scheduler file restoration did not verify");
  }
}

/** Keep scheduler and local-file recovery material until the caller has also
 * persisted settings. A leftover incomplete journal blocks a new transaction,
 * including after process restart. No credential file is read here. */
export async function withSchedulerTransaction(root, config, callback, options = {}) {
  await mkdir(resolve(root, "data"), { recursive: true });
  return withDirectoryLock(resolve(root, "data", ".scheduler-update.lock"), async () => {
    const file = transactionPath(root);
    const existing = await readOptionalFile(file);
    if (existing !== null) {
      let previous;
      try { previous = JSON.parse(existing); } catch { throw recoveryError(); }
      if (!["committed", "restored"].includes(previous.phase)) throw recoveryError();
      // Only the fixed journal is removed here; never follow a persisted path.
      await rm(file);
    }
    const files = {};
    for (const name of [
      "anthropology-canteen-reminder-scheduler.json",
      "anthropology-canteen-reminder-scheduler.json.backup",
      "anthropology-canteen-settings.json",
      "anthropology-canteen-settings.json.backup",
    ]) {
      const bytes = await readOptionalFile(resolve(root, "data", name));
      files[name] = bytes === null ? null : bytes.toString("base64");
    }
    const ticket = {
      file, root, config, options, closed: false, recoveryAttempted: false,
      record: {
        phase: "prepared", platform: options.platform || process.platform,
        taskSnapshot: resolve(root, "data", `.scheduler-task-${randomUUID().replaceAll("-", "")}.json`),
        files,
      },
    };
    await writeDurable(file, JSON.stringify(ticket.record), true);
    const controls = {
      snapshotScheduler: async () => ticket,
      install: (next) => installScheduler(root, next, { ...options, transaction: ticket }),
      restoreSettings: async () => {}, // Restored byte-for-byte with the marker below.
      restoreScheduler: async () => {
        ticket.recoveryAttempted = true;
        const failures = [];
        if (ticket.record.platform === "win32") {
          try {
            if (await readOptionalFile(ticket.record.taskSnapshot)) {
              const output = await runWindowsTaskHelper(root, config, options.runCommand || run,
                ["-TransactionPath", ticket.record.taskSnapshot, "-Mode", "Restore"]);
              if (JSON.parse(output).status !== "restored") throw new Error("Task restoration did not verify");
            } else if (ticket.osAttempted && !ticket.noTaskMutation) {
              throw new Error("The OS task snapshot is missing; restoration cannot be verified");
            }
          } catch (error) { failures.push(error); }
        } else if (ticket.restorePlatform) {
          try { await ticket.restorePlatform(); } catch (error) { failures.push(error); }
        }
        for (const [name, bytes] of Object.entries(files)) {
          try { await restoreFileSnapshot(root, name, bytes); } catch (error) { failures.push(error); }
        }
        if (failures.length) throw recoveryError(new AggregateError(failures));
      },
      completeRollback: () => finishTransaction(ticket, "restored"),
      commitScheduler: () => finishTransaction(ticket, "committed"),
    };
    activeTransactions.add(root);
    try {
      const result = await callback(controls);
      if (!ticket.closed) await controls.commitScheduler();
      return result;
    } catch (error) {
      if (!ticket.closed && !ticket.recoveryAttempted) {
        try { await controls.restoreScheduler(); await controls.completeRollback(); }
        catch (restoreError) { throw recoveryError(new AggregateError([error, restoreError])); }
      }
      throw error;
    } finally {
      activeTransactions.delete(root);
    }
  });
}

export const WINDOWS_SCHEDULER_PERMISSION_MESSAGE =
  "Windows 没有允许更新后台提醒任务。请重试并确认一次 Windows 权限提示；只提升任务小工具，应用和日常提醒仍以普通权限运行。";

export const WINDOWS_SCHEDULER_ELEVATION_CANCELLED_MESSAGE =
  "你已取消 Windows 权限确认，后台提醒更新未完成。";

function cleanSchedulerDiagnostic(value) {
  const lines = String(value || "")
    .replaceAll("\0", "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const diagnostic = lines.find((line) =>
    !/^([+~]|at\s|At\s|CategoryInfo|FullyQualifiedErrorId)/i.test(line) &&
    !/[A-Za-z]:\\/.test(line) &&
    !/\/(?:Users|home)\//i.test(line) &&
    !/powershell(?:\.exe)?\s+-/i.test(line),
  );
  if (!diagnostic || /\uFFFD/.test(diagnostic)) return "";
  return diagnostic
    .replace(/^ANTHROPOLOGY_CANTEEN_SCHEDULER_ERROR:\s*/i, "")
    .slice(0, 240);
}

export function schedulerCommandError({
  error,
  stdout = "",
  stderr = "",
  operation = "操作",
  windowsPermissionHint = false,
} = {}) {
  const raw = [stderr, stdout, error?.message, error?.code]
    .filter(Boolean)
    .join("\n");
  if (/ANTHROPOLOGY_CANTEEN_SCHEDULER_UPDATE_FAILED_RESTORED/i.test(raw)) {
    const updateError = new Error("后台提醒更新失败。");
    updateError.code = "SCHEDULER_UPDATE_FAILED";
    updateError.userMessage = updateError.message;
    return updateError;
  }
  if (/ANTHROPOLOGY_CANTEEN_SCHEDULER_SNAPSHOT_FAILED/i.test(raw)) {
    const snapshotError = new Error("无法可靠保存后台提醒任务的原状态，已停止更新。");
    snapshotError.code = "SCHEDULER_SNAPSHOT_FAILED";
    snapshotError.userMessage = snapshotError.message;
    return snapshotError;
  }
  if (/ANTHROPOLOGY_CANTEEN_SCHEDULER_ELEVATION_CANCELLED/i.test(raw)) {
    const cancellationError = new Error(WINDOWS_SCHEDULER_ELEVATION_CANCELLED_MESSAGE);
    cancellationError.code = "SCHEDULER_ELEVATION_CANCELLED";
    cancellationError.userMessage = WINDOWS_SCHEDULER_ELEVATION_CANCELLED_MESSAGE;
    return cancellationError;
  }
  if (/ANTHROPOLOGY_CANTEEN_SCHEDULER_ROLLBACK_FAILED/i.test(raw)) {
    const rollbackError = new Error(
      "后台提醒任务没有更新完成，无法自动恢复原任务。恢复未完成，请保留当前和旧版文件夹，处理恢复问题后再操作。",
    );
    rollbackError.code = "SCHEDULER_ROLLBACK_FAILED";
    rollbackError.userMessage = rollbackError.message;
    return rollbackError;
  }
  if (/ANTHROPOLOGY_CANTEEN_SCHEDULER_VALIDATION_FAILED/i.test(raw)) {
    const validationError = new Error(
      "后台提醒任务更新后未通过核对，原任务已恢复。邮件设置、授权码和发送记录保持不变。",
    );
    validationError.code = "SCHEDULER_VALIDATION_FAILED";
    validationError.userMessage = validationError.message;
    return validationError;
  }
  if (/ANTHROPOLOGY_CANTEEN_SCHEDULER_ELEVATION_FAILED/i.test(raw)) {
    const elevationError = new Error(
      "Windows 任务小工具未能完成更新。邮件设置、授权码和发送记录保持不变，请重试。",
    );
    elevationError.code = "SCHEDULER_ELEVATION_FAILED";
    elevationError.userMessage = elevationError.message;
    return elevationError;
  }
  if (
    windowsPermissionHint &&
    /(ANTHROPOLOGY_CANTEEN_SCHEDULER_PERMISSION_DENIED|PermissionDenied|Access\s+is\s+denied|HRESULT\s*0x80070005|0x80070005|UnauthorizedAccess|\bEACCES\b|\bEPERM\b)/i.test(raw)
  ) {
    const permissionError = new Error(WINDOWS_SCHEDULER_PERMISSION_MESSAGE);
    permissionError.code = "SCHEDULER_PERMISSION_DENIED";
    permissionError.userMessage = WINDOWS_SCHEDULER_PERMISSION_MESSAGE;
    return permissionError;
  }
  const detail = cleanSchedulerDiagnostic(stderr || stdout || error?.message);
  const exitCode = Number.isInteger(error?.code) ? `（退出码 ${error.code}）` : "";
  const message = detail
    ? `计划任务${operation}失败：${detail}`
    : `计划任务${operation}失败${exitCode}。`;
  const schedulerError = new Error(message);
  schedulerError.code = "SCHEDULER_COMMAND_FAILED";
  schedulerError.userMessage = message;
  return schedulerError;
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        rejectRun(schedulerCommandError({
          error,
          stdout,
          stderr,
          ...options,
        }));
        return;
      }
      resolveRun(String(stdout || "").trim());
    });
  });
}

function taskName(config) {
  return `Anthropology Canteen Reminder ${config.installationId.slice(0, 12)}`;
}

function windowsTaskArguments(root, config) {
  return [
    "-TaskName",
    taskName(config),
    "-NodePath",
    resolve(root, "runtime", "node.exe"),
    "-WorkerPath",
    resolve(root, "reminder-worker.mjs"),
    "-RootPath",
    root,
    "-Time",
    config.schedule.time,
  ];
}

function powershellFileArguments(script, taskArguments) {
  return [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    script,
    ...taskArguments,
  ];
}

function parseWindowsInspection(output) {
  let parsed;
  try {
    parsed = JSON.parse(String(output || ""));
  } catch {
    throw schedulerCommandError({
      operation: "核对",
      error: { message: "计划任务返回了无法识别的核对结果。" },
    });
  }
  return {
    status: ["current", "stale", "missing", "ambiguous", "disabled"].includes(parsed?.status)
      ? parsed.status
      : "ambiguous",
    installed: parsed?.installed === true && parsed.status === "current",
    definitionValid: parsed?.definitionValid === true || (parsed.status === "current" && parsed.installed === true),
    reasonCodes: Array.isArray(parsed?.reasonCodes)
      ? parsed.reasonCodes.map(String).slice(0, 12)
      : [],
    ambiguousTaskCount: Number.isInteger(parsed?.ambiguousTaskCount)
      ? Math.max(0, parsed.ambiguousTaskCount)
      : 0,
    ambiguousTaskIds: Array.isArray(parsed?.ambiguousTaskIds)
      ? parsed.ambiguousTaskIds.map(String).filter((value) => /^[A-Za-z0-9-]{1,12}$/.test(value)).slice(0, 12)
      : [],
  };
}

async function inspectWindows(root, config, runCommand = run) {
  const script = resolve(root, "tools", "inspect-windows-reminder.ps1");
  const output = await runCommand(
    "powershell.exe",
    powershellFileArguments(script, windowsTaskArguments(root, config)),
    { operation: "核对", windowsPermissionHint: true },
  );
  return parseWindowsInspection(output);
}

function launchdLabel(config) {
  return `org.anthropology-canteen.reminder.${config.installationId.slice(0, 24)}`;
}

function schedulerMarker(root) {
  return resolve(root, "data", "anthropology-canteen-reminder-scheduler.json");
}

async function runWindowsTaskHelper(root, config, runCommand, extraArguments = []) {
  const script = resolve(root, "tools", "register-windows-reminder.ps1");
  const taskArguments = [...windowsTaskArguments(root, config), ...extraArguments];
  let registrationOutput;
  try {
    registrationOutput = await runCommand(
      "powershell.exe",
      powershellFileArguments(script, taskArguments),
      { operation: "更新", windowsPermissionHint: true },
    );
  } catch (error) {
    if (error?.code !== "SCHEDULER_PERMISSION_DENIED") throw error;
    const elevationScript = resolve(root, "tools", "elevate-windows-reminder.ps1");
    registrationOutput = await runCommand(
      "powershell.exe",
      powershellFileArguments(elevationScript, taskArguments),
      { operation: "请求 Windows 权限", windowsPermissionHint: true },
    );
  }

  return registrationOutput;
}

async function installWindows(root, config, runCommand = run, transaction) {
  transaction.osAttempted = true;
  let registrationOutput;
  try {
    registrationOutput = await runWindowsTaskHelper(root, config, runCommand,
      ["-TransactionPath", transaction.record.taskSnapshot, ...(transaction.options.reenable ? ["-Reenable"] : [])]);
  } catch (error) {
    transaction.noTaskMutation = ["SCHEDULER_PERMISSION_DENIED", "SCHEDULER_ELEVATION_CANCELLED", "SCHEDULER_SNAPSHOT_FAILED"].includes(error.code);
    throw error;
  }
  if (!(await readOptionalFile(transaction.record.taskSnapshot))) throw recoveryError();
  const inspection = parseWindowsInspection(registrationOutput);
  if (!inspection.definitionValid || !["current", "disabled"].includes(inspection.status)) {
    const validationError = new Error("后台提醒任务更新后未通过核对。");
    validationError.code = "SCHEDULER_VALIDATION_FAILED";
    validationError.userMessage = validationError.message;
    throw validationError;
  }
  return {
    taskName: taskName(config),
    platform: "windows",
    status: inspection.status,
    ambiguousTaskCount: inspection.ambiguousTaskCount,
    ambiguousTaskIds: inspection.ambiguousTaskIds,
  };
}

async function uninstallWindows(root, config, runCommand = run) {
  const script = resolve(root, "tools", "unregister-windows-reminder.ps1");
  await runCommand("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    script,
    "-TaskName",
    taskName(config),
  ], { operation: "移除", windowsPermissionHint: true });
}

function launchdPath(config) {
  return join(homedir(), "Library", "LaunchAgents", `${launchdLabel(config)}.plist`);
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function macJobLoaded(uid, label, runCommand) {
  try {
    await runCommand("/bin/launchctl", ["print", `gui/${uid}/${label}`]);
    return true;
  } catch (error) {
    if (/Could not find service|service not found/i.test(String(error.message))) return false;
    throw error;
  }
}

async function macJobDisabled(uid, label, runCommand) {
  const result = await runCommand("/bin/launchctl", ["print-disabled", `gui/${uid}`]);
  const unreliable = () => new Error("无法可靠核对 macOS 后台提醒的停用状态。");
  // Current launchctl uses enabled/disabled; older output uses booleans.
  // Absence means no override only after the entire dictionary was parsed.
  const dictionary = String(result).trim().match(/^(?:disabled services\s*=\s*)?\{([\s\S]*)\}$/);
  if (!dictionary) throw unreliable();
  const values = new Map();
  let rest = dictionary[1].trim();
  while (rest) {
    const entry = rest.match(/^"([^"\r\n]+)"\s*=>\s*(enabled|disabled|true|false)(?=\s|$)/);
    if (!entry || values.has(entry[1])) throw unreliable();
    values.set(entry[1], entry[2] === "disabled" || entry[2] === "true");
    rest = rest.slice(entry[0].length).trim();
  }
  return values.get(label) ?? false;
}

function withoutRunAtLoad(bytes) {
  const xml = bytes.toString("utf8");
  if (!xml.includes("<plist")) throw new Error("无法安全保存原 macOS 提醒任务定义。");
  return Buffer.from(xml.replace(/(<key>RunAtLoad<\/key>\s*)<true\s*\/>/g, "$1<false/>"));
}

async function restoreMacSnapshot(snapshot, runCommand) {
  const { uid, label, plist, loaded, disabled, bytes } = snapshot;
  if (await macJobDisabled(uid, label, runCommand) !== disabled) {
    if (snapshot.mayChangeDisabled && disabled) await runCommand("/bin/launchctl", ["disable", `gui/${uid}/${label}`]);
    else throw new Error("macOS 任务启用状态已被其他操作改变，停止自动覆盖。");
  }
  const current = await readOptionalFile(plist);
  const currentLoaded = await macJobLoaded(uid, label, runCommand);
  if ((current === null ? null : current.toString("base64")) === bytes && currentLoaded === loaded &&
      await macJobDisabled(uid, label, runCommand) === disabled) return;
  if (currentLoaded) await runCommand("/bin/launchctl", ["bootout", `gui/${uid}/${label}`]);
  if (bytes === null) await rm(plist, { force: true });
  else {
    const original = Buffer.from(bytes, "base64");
    if (loaded) {
      await writeDurable(plist, withoutRunAtLoad(original));
      if (disabled) await runCommand("/bin/launchctl", ["enable", `gui/${uid}/${label}`]);
      await runCommand("/bin/launchctl", ["bootstrap", `gui/${uid}`, plist]);
    }
    await writeDurable(plist, original);
  }
  if (disabled && loaded) await runCommand("/bin/launchctl", ["disable", `gui/${uid}/${label}`]);
  const restored = await readOptionalFile(plist);
  if ((restored === null ? null : restored.toString("base64")) !== bytes ||
      await macJobLoaded(uid, label, runCommand) !== loaded ||
      await macJobDisabled(uid, label, runCommand) !== disabled) {
    throw new Error("macOS 原任务恢复核对失败。");
  }
}

async function installMac(root, config, runCommand = run, transaction) {
  const uid = String(transaction?.options.uid || process.getuid?.() || "");
  if (!uid) throw new Error("无法确定当前 macOS 用户。");
  const plist = transaction?.options.plistPath || launchdPath(config);
  await mkdir(dirname(plist), { recursive: true });
  const label = launchdLabel(config);
  const previous = await readOptionalFile(plist);
  const loaded = await macJobLoaded(uid, label, runCommand);
  const disabled = await macJobDisabled(uid, label, runCommand);
  if (loaded && previous === null) {
    throw new Error("无法可靠恢复原 macOS 提醒任务，已停止更新。");
  }
  if (previous) withoutRunAtLoad(previous); // Validate before any OS mutation.
  if (previous) {
    const previousLabel = await runCommand("/usr/bin/plutil", ["-extract", "Label", "raw", "-o", "-", plist]);
    const previousRoot = await runCommand("/usr/bin/plutil", ["-extract", "WorkingDirectory", "raw", "-o", "-", plist]);
    const previousArguments = JSON.parse(await runCommand("/usr/bin/plutil", ["-extract", "ProgramArguments", "json", "-o", "-", plist]));
    if (previousLabel !== label || !Array.isArray(previousArguments) || previousArguments.length !== 2 ||
        previousArguments[0] !== resolve(previousRoot, "runtime", "bin", "node") ||
        previousArguments[1] !== resolve(previousRoot, "reminder-worker.mjs")) {
      throw new Error("无法确认原 macOS 提醒任务归属，已停止更新。");
    }
  }
  const reenable = transaction.options.reenable === true;
  const snapshot = { uid, label, plist, loaded, disabled, reenable,
    mayChangeDisabled: disabled && (reenable || loaded), bytes: previous === null ? null : previous.toString("base64") };
  transaction.record.mac = snapshot;
  await saveTransaction(transaction, "prepared");
  transaction.restorePlatform = () => restoreMacSnapshot(snapshot, runCommand);
  const [hour, minute] = config.schedule.time.split(":").map(Number);
  const plistText = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xmlEscape(launchdLabel(config))}</string>
<key>ProgramArguments</key><array><string>${xmlEscape(resolve(root, "runtime", "bin", "node"))}</string><string>${xmlEscape(resolve(root, "reminder-worker.mjs"))}</string></array>
<key>WorkingDirectory</key><string>${xmlEscape(root)}</string>
<key>StartCalendarInterval</key><dict><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>${minute}</integer></dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><false/>
<key>StandardOutPath</key><string>${xmlEscape(resolve(root, "data", "anthropology-canteen-reminder.log"))}</string>
<key>StandardErrorPath</key><string>${xmlEscape(resolve(root, "data", "anthropology-canteen-reminder.log"))}</string>
</dict></plist>
`;
  if (loaded) await runCommand("/bin/launchctl", ["bootout", `gui/${uid}/${label}`]);
  const shouldLoad = reenable || loaded || (previous === null && !disabled);
  if (shouldLoad) {
    // Bootstrap must not execute the worker as a side effect of folder update.
    // The on-disk definition retains RunAtLoad for the next normal login.
    await writeDurable(plist, withoutRunAtLoad(Buffer.from(plistText)));
    if (disabled) await runCommand("/bin/launchctl", ["enable", `gui/${uid}/${label}`]);
    await runCommand("/bin/launchctl", ["bootstrap", `gui/${uid}`, plist]);
  }
  await writeDurable(plist, Buffer.from(plistText));
  if (disabled && shouldLoad && !reenable) await runCommand("/bin/launchctl", ["disable", `gui/${uid}/${label}`]);
  if (await macJobLoaded(uid, label, runCommand) !== shouldLoad ||
      await macJobDisabled(uid, label, runCommand) !== (reenable ? false : disabled)) {
    throw new Error("macOS 提醒任务更新后未通过核对。");
  }
  return { label: launchdLabel(config), platform: "macos", path: root, plist };
}

async function uninstallMac(root, config, runCommand = run) {
  const uid = String(process.getuid?.() || "");
  const plist = launchdPath(config);
  if (uid) {
    try {
      await runCommand("/bin/launchctl", ["bootout", `gui/${uid}`, plist], {
        operation: "卸载 macOS 提醒任务",
      });
    } catch {
      // The job may already be unloaded.
    }
    try {
      await runCommand("/bin/launchctl", ["bootout", `gui/${uid}/${launchdLabel(config)}`], {
        operation: "卸载 macOS 提醒任务",
      });
    } catch {
      // The label may already be unloaded.
    }
  }
  await unlink(plist).catch(() => {});
}

export async function installScheduler(root, config, options = {}) {
  if (!options.transaction) {
    return withSchedulerTransaction(root, config, ({ install }) => install(config), options);
  }
  const platform = options.platform || process.platform;
  const runCommand = options.runCommand || run;
  const result = platform === "win32"
    ? await installWindows(root, config, runCommand, options.transaction)
    : platform === "darwin"
      ? await installMac(root, config, runCommand, options.transaction)
      : { platform, path: root, unsupported: true };
  await (options.writeMarker || writeJsonAtomic)(schedulerMarker(root), {
    ...result,
    path: root,
    installedAt: new Date().toISOString(),
  });
  return result;
}

export async function uninstallScheduler(root, config, options = {}) {
  const platform = options.platform || process.platform;
  const runCommand = options.runCommand || run;
  if (platform === "win32") await uninstallWindows(root, config, runCommand);
  else if (platform === "darwin") await uninstallMac(root, config, runCommand);
  await unlink(schedulerMarker(root)).catch(() => {});
}

export async function getSchedulerStatus(root, config, options = {}) {
  if (await schedulerRecoveryPending(root)) {
    return {
      installed: false,
      status: activeTransactions.has(root) ? "updating" : "recovery-required",
      reasonCodes: [activeTransactions.has(root) ? "update-in-progress" : "update-recovery-incomplete"],
      path: "",
    };
  }
  let marker;
  try {
    marker = JSON.parse(await readFile(schedulerMarker(root), "utf8"));
  } catch {
    marker = {};
  }

  const platform = options.platform || process.platform;
  const runCommand = options.runCommand || run;
  if (platform === "win32" && config?.installationId) {
    const requiredFiles = [
      resolve(root, "runtime", "node.exe"),
      resolve(root, "reminder-worker.mjs"),
      resolve(root, "tools", "inspect-windows-reminder.ps1"),
    ];
    const packaged = (await Promise.all(requiredFiles.map((file) => access(file).then(
      () => true,
      () => false,
    )))).every(Boolean);
    if (packaged) {
      try {
        const inspection = await inspectWindows(root, config, runCommand);
        return {
          installed: inspection.installed,
          status: inspection.status,
          definitionValid: inspection.definitionValid,
          stalePath: inspection.status === "stale"
            ? "previous-folder"
            : "",
          path: "",
          platform: "windows",
          installedAt: String(marker.installedAt || ""),
          taskName: taskName(config),
          reasonCodes: inspection.reasonCodes,
          ambiguousTaskCount: inspection.ambiguousTaskCount,
          ambiguousTaskIds: inspection.ambiguousTaskIds,
        };
      } catch (error) {
        if (error?.code === "SCHEDULER_PERMISSION_DENIED") {
          return {
            installed: false,
            status: "permission-denied",
            stalePath: "",
            path: "",
            platform: "windows",
            installedAt: String(marker.installedAt || ""),
            taskName: taskName(config),
            reasonCodes: ["inspection-permission-denied"],
            ambiguousTaskCount: Number.isInteger(marker.ambiguousTaskCount)
              ? Math.max(0, marker.ambiguousTaskCount)
              : 0,
            ambiguousTaskIds: Array.isArray(marker.ambiguousTaskIds)
              ? marker.ambiguousTaskIds.map(String).filter((value) => /^[A-Za-z0-9-]{1,12}$/.test(value)).slice(0, 12)
              : [],
          };
        }
        return { installed: false, status: "unknown", path: "", platform: "windows", reasonCodes: ["inspection-failed"] };
      }
    }
  }

  if (platform === "darwin" && config?.installationId) {
    try {
      const uid = String(options.uid || process.getuid?.() || "");
      if (!uid) throw new Error("Unknown user");
      const label = launchdLabel(config);
      const plist = options.plistPath || launchdPath(config);
      const loaded = await macJobLoaded(uid, label, runCommand);
      const disabled = await macJobDisabled(uid, label, runCommand);
      const bytes = await readOptionalFile(plist);
      if (!bytes) return { installed: false, status: loaded ? "unknown" : "missing", path: "", platform };
      const storedRoot = await runCommand("/usr/bin/plutil", ["-extract", "WorkingDirectory", "raw", "-o", "-", plist]);
      const storedLabel = await runCommand("/usr/bin/plutil", ["-extract", "Label", "raw", "-o", "-", plist]);
      const args = JSON.parse(await runCommand("/usr/bin/plutil", ["-extract", "ProgramArguments", "json", "-o", "-", plist]));
      const calendar = JSON.parse(await runCommand("/usr/bin/plutil", ["-extract", "StartCalendarInterval", "json", "-o", "-", plist]));
      const [hour, minute] = config.schedule.time.split(":").map(Number);
      const valid = storedRoot === root && storedLabel === label && Array.isArray(args) && args.length === 2 &&
        args[0] === resolve(root, "runtime", "bin", "node") && args[1] === resolve(root, "reminder-worker.mjs") &&
        calendar.Hour === hour && calendar.Minute === minute;
      return { installed: valid && loaded && !disabled, definitionValid: valid,
        status: disabled || !loaded ? "disabled" : valid ? "current" : "stale", path: "", platform,
        reasonCodes: [...(!loaded ? ["job-unloaded"] : []), ...(disabled ? ["job-disabled"] : []), ...(!valid ? ["definition-mismatch"] : [])] };
    } catch { return { installed: false, status: "unknown", path: "", platform, reasonCodes: ["inspection-failed"] }; }
  }
  return { installed: false, path: "", platform, taskName: "", status: "unknown", reasonCodes: ["inspection-unavailable"] };
}

export { taskName, launchdLabel };
