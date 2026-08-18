import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { writeJsonAtomic } from "./reminder-utils.mjs";

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr || stdout || error.message).trim();
        rejectRun(new Error(detail || `${command} failed`));
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

async function installWindows(root, config) {
  const script = resolve(root, "tools", "register-windows-reminder.ps1");
  await run("powershell.exe", [
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
  ]);
  return { taskName: taskName(config), platform: "windows", path: root };
}

async function uninstallWindows(root, config) {
  const script = resolve(root, "tools", "unregister-windows-reminder.ps1");
  try {
    await run("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      script,
      "-TaskName",
      taskName(config),
    ]);
  } catch {
    // Removing an already missing task is idempotent.
  }
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

async function installMac(root, config) {
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
    await run("/bin/launchctl", ["bootout", `gui/${uid}`, plist]);
  } catch {
    // The job may not have been loaded yet.
  }
  try {
    await run("/bin/launchctl", ["bootout", `gui/${uid}/${launchdLabel(config)}`]);
  } catch {
    // A copied folder may have registered the same label from an old path.
  }
  await run("/bin/launchctl", ["bootstrap", `gui/${uid}`, plist]);
  return { label: launchdLabel(config), platform: "macos", path: root, plist };
}

async function uninstallMac(root, config) {
  const uid = String(process.getuid?.() || "");
  const plist = launchdPath(config);
  if (uid) {
    try {
      await run("/bin/launchctl", ["bootout", `gui/${uid}`, plist]);
    } catch {
      // The job may already be unloaded.
    }
    try {
      await run("/bin/launchctl", ["bootout", `gui/${uid}/${launchdLabel(config)}`]);
    } catch {
      // The label may already be unloaded.
    }
  }
  await unlink(plist).catch(() => {});
}

export async function installScheduler(root, config) {
  const result = process.platform === "win32"
    ? await installWindows(root, config)
    : process.platform === "darwin"
      ? await installMac(root, config)
      : { platform: process.platform, path: root, unsupported: true };
  await writeJsonAtomic(schedulerMarker(root), { ...result, installedAt: new Date().toISOString() });
  return result;
}

export async function uninstallScheduler(root, config) {
  if (process.platform === "win32") await uninstallWindows(root, config);
  else if (process.platform === "darwin") await uninstallMac(root, config);
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
