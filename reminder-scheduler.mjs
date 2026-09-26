import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { writeJsonAtomic } from "./reminder-utils.mjs";

export const WINDOWS_SCHEDULER_PERMISSION_MESSAGE =
  "Windows 没有允许更新后台提醒任务。请重试并确认一次 Windows 权限提示；只提升任务小工具，应用和日常提醒仍以普通权限运行。";

export const WINDOWS_SCHEDULER_ELEVATION_CANCELLED_MESSAGE =
  "没有更改后台提醒任务。你已取消 Windows 权限确认；设置、授权码和发送记录都保持不变。";

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
  if (/ANTHROPOLOGY_CANTEEN_SCHEDULER_ELEVATION_CANCELLED/i.test(raw)) {
    const cancellationError = new Error(WINDOWS_SCHEDULER_ELEVATION_CANCELLED_MESSAGE);
    cancellationError.code = "SCHEDULER_ELEVATION_CANCELLED";
    cancellationError.userMessage = WINDOWS_SCHEDULER_ELEVATION_CANCELLED_MESSAGE;
    return cancellationError;
  }
  if (/ANTHROPOLOGY_CANTEEN_SCHEDULER_ROLLBACK_FAILED/i.test(raw)) {
    const rollbackError = new Error(
      "后台提醒任务没有更新完成，而且无法自动恢复原任务。邮件设置、授权码和发送记录没有被删除；请暂时保留旧版文件夹并重试。",
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
    status: ["current", "stale", "missing", "ambiguous"].includes(parsed?.status)
      ? parsed.status
      : "ambiguous",
    installed: parsed?.installed === true,
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

async function installWindows(root, config, runCommand = run) {
  const script = resolve(root, "tools", "register-windows-reminder.ps1");
  const taskArguments = windowsTaskArguments(root, config);
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

  const inspection = parseWindowsInspection(registrationOutput);
  if (!inspection.installed || inspection.status !== "current") {
    const validationError = new Error("后台提醒任务更新后未通过核对，原任务已尽量恢复。");
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

async function installMac(root, config, runCommand = run) {
  const uid = String(process.getuid?.() || "");
  if (!uid) throw new Error("无法确定当前 macOS 用户。");
  const plist = launchdPath(config);
  await mkdir(dirname(plist), { recursive: true });
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
  await writeFile(plist, plistText, "utf8");
  try {
    await runCommand("/bin/launchctl", ["bootout", `gui/${uid}`, plist], {
      operation: "卸载 macOS 提醒任务",
    });
  } catch {
    // The job may not have been loaded yet.
  }
  try {
    await runCommand("/bin/launchctl", ["bootout", `gui/${uid}/${launchdLabel(config)}`], {
      operation: "卸载 macOS 提醒任务",
    });
  } catch {
    // A copied folder may have registered the same label from an old path.
  }
  await runCommand("/bin/launchctl", ["bootstrap", `gui/${uid}`, plist], {
    operation: "加载 macOS 提醒任务",
  });
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
  const platform = options.platform || process.platform;
  const runCommand = options.runCommand || run;
  const result = platform === "win32"
    ? await installWindows(root, config, runCommand)
    : platform === "darwin"
      ? await installMac(root, config, runCommand)
      : { platform, path: root, unsupported: true };
  await writeJsonAtomic(schedulerMarker(root), {
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
          stalePath: inspection.status === "stale" || (marker.path && marker.path !== root)
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
          const markerMatches = marker.path === root && marker.taskName === taskName(config);
          return {
            installed: markerMatches,
            status: "permission-denied",
            stalePath: marker.path && marker.path !== root ? "previous-folder" : "",
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
        throw error;
      }
    }
  }

  if (marker.path || marker.platform || marker.taskName || marker.label) {
    return {
      installed: marker.path === root,
      stalePath: marker.path && marker.path !== root ? "previous-folder" : "",
      path: "",
      platform: marker.platform,
      installedAt: String(marker.installedAt || ""),
      taskName: marker.taskName || marker.label || "",
    };
  }
  return { installed: false, path: "", platform, taskName: "", status: "missing" };
}

export { taskName, launchdLabel };
