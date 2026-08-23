import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { writeJsonAtomic } from "./reminder-utils.mjs";

export const WINDOWS_SCHEDULER_PERMISSION_MESSAGE =
  "Windows 拒绝注册计划任务。请关闭所有 Anthropology Canteen 页面，等待约 10 秒，然后右键 start-local.cmd，选择‘以管理员身份运行’，再重新开启提醒。管理员权限仅用于首次注册或更新后的迁移，日常运行不需要。";

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

function launchdLabel(config) {
  return `org.anthropology-canteen.reminder.${config.installationId.slice(0, 24)}`;
}

function schedulerMarker(root) {
  return resolve(root, "data", "anthropology-canteen-reminder-scheduler.json");
}

async function installWindows(root, config, runCommand = run) {
  const script = resolve(root, "tools", "register-windows-reminder.ps1");
  await runCommand("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    script,
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
  ], { operation: "注册", windowsPermissionHint: true });
  return { taskName: taskName(config), platform: "windows", path: root };
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
  await writeJsonAtomic(schedulerMarker(root), { ...result, installedAt: new Date().toISOString() });
  return result;
}

export async function uninstallScheduler(root, config, options = {}) {
  const platform = options.platform || process.platform;
  const runCommand = options.runCommand || run;
  if (platform === "win32") await uninstallWindows(root, config, runCommand);
  else if (platform === "darwin") await uninstallMac(root, config, runCommand);
  await unlink(schedulerMarker(root)).catch(() => {});
}

export async function getSchedulerStatus(root) {
  try {
    const marker = JSON.parse(await readFile(schedulerMarker(root), "utf8"));
    return {
      installed: marker.path === root,
      stalePath: marker.path && marker.path !== root ? String(marker.path) : "",
      path: String(marker.path || ""),
      platform: marker.platform,
      installedAt: String(marker.installedAt || ""),
      taskName: marker.taskName || marker.label || "",
    };
  } catch {
    return { installed: false, path: "", platform: process.platform, taskName: "" };
  }
}

export { taskName, launchdLabel };
