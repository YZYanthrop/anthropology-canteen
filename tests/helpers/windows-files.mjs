import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("windows-file-fixture.ps1", import.meta.url));
const args = (root, target, mode) => ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script,
  "-FixtureRoot", root, "-Target", target, "-Mode", mode];

export async function setWindowsFixtureAccess(root, target, mode) {
  await promisify(execFile)("powershell.exe", args(root, target, mode), { windowsHide: true, timeout: 15000 });
}

export async function lockWindowsFixtureFile(root, target) {
  const child = spawn("powershell.exe", args(root, target, "Lock"), { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let details = "";
  child.stderr.on("data", (data) => { details += data; });
  const closed = new Promise((resolve) => child.once("close", resolve));
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Native file lock timed out")), 15000);
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error(details || "Native file lock exited")); });
      child.stdout.on("data", (data) => { if (String(data).includes("ready")) { clearTimeout(timer); resolve(); } });
    });
  } catch (error) { child.kill(); await closed; throw error; }
  return async () => { child.stdin.end("release\n"); await closed; };
}
