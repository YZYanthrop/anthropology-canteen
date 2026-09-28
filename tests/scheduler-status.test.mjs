import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { getSchedulerStatus, taskName, launchdLabel } from "../reminder-scheduler.mjs";

// Authored before Slice C implementation. Execution is deferred.
for (const status of ["current", "disabled", "stale", "missing", "ambiguous", "unknown", "permission-denied", "broken-json", "missing-helper"]) {
  test(`live ${status} cannot be hidden by a matching old marker`, async () => {
    const root = await mkdtemp(join(tmpdir(), "canteen-live-status-"));
    const config = { installationId: "status-test", enabled: true, schedule: { time: "08:00" } };
    const files = ["data/anthropology-canteen-reminder-scheduler.json"];
    if (status !== "missing-helper") files.push("runtime/node.exe", "reminder-worker.mjs", "tools/inspect-windows-reminder.ps1");
    for (const file of files) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), file.endsWith(".json") ? JSON.stringify({ path: root, taskName: taskName(config) }) : "fixture");
    }
    let calls = 0;
    try {
      const result = await getSchedulerStatus(root, config, { platform: "win32", runCommand: async (_command, args) => {
        calls++;
        assert.ok(args.some((arg) => String(arg).endsWith("inspect-windows-reminder.ps1")));
        if (status === "permission-denied") throw Object.assign(new Error("denied"), { code: "SCHEDULER_PERMISSION_DENIED" });
        if (status === "unknown") throw new Error("inspection unavailable");
        if (status === "broken-json") return "{";
        return JSON.stringify({ status, installed: status === "current", reasonCodes: status === "disabled" ? ["daily-disabled"] : [] });
      } });
      assert.equal(result.installed, status === "current");
      assert.equal(result.status, ["broken-json", "missing-helper"].includes(status) ? "unknown" : status);
      assert.equal(calls, status === "missing-helper" ? 0 : 1, "status must never repair or elevate");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

for (const state of ["current", "disabled", "unloaded", "missing", "stale", "unknown"]) {
  test(`macOS live ${state} query is read-only and conservative`, async () => {
    const root = await mkdtemp(join(tmpdir(), "canteen-mac-status-"));
    const plist = join(root, "fixture.plist");
    const config = { installationId: "status-test", schedule: { time: "08:00" } };
    if (state !== "missing") await writeFile(plist, "fixture");
    try {
      const result = await getSchedulerStatus(root, config, { platform: "darwin", uid: "501", plistPath: plist,
        runCommand: async (command, args) => {
          if (state === "unknown") throw new Error("permission denied");
          if (command === "/bin/launchctl") {
            assert.ok(["print", "print-disabled"].includes(args[0]));
            if (args[0] === "print" && ["unloaded", "missing"].includes(state)) throw new Error("Could not find service");
            return args[0] === "print" ? "loaded" : `{ "${launchdLabel(config)}" => ${state === "disabled"} }`;
          }
          assert.equal(command, "/usr/bin/plutil");
          if (args[1] === "Label") return launchdLabel(config);
          if (args[1] === "WorkingDirectory") return state === "stale" ? join(root, "old") : root;
          if (args[1] === "ProgramArguments") return JSON.stringify([resolve(root, "runtime", "bin", "node"), resolve(root, "reminder-worker.mjs")]);
          if (args[1] === "StartCalendarInterval") return JSON.stringify({ Hour: 8, Minute: 0 });
          assert.fail("unexpected inspection command");
        },
      });
      assert.equal(result.installed, state === "current");
      assert.equal(result.status, state === "unloaded" ? "disabled" : state);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
