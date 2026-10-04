import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { getSchedulerStatus, installScheduler, taskName, launchdLabel } from "../reminder-scheduler.mjs";

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

// v1.3.5 regressions: macOS 15 prints enabled/disabled, not booleans.
// These are deterministic parser/transaction checks, not native evidence.
const disabledOutputs = [
  { id: "native disabled", output: (label) => `disabled services = {\n\t"${label}" => disabled\n}`, expected: "disabled" },
  { id: "native enabled", output: (label) => `disabled services = {\n\t"${label}" => enabled\n}`, expected: "current" },
  { id: "boolean true", output: (label) => `{ "${label}" => true }`, expected: "disabled" },
  { id: "boolean false", output: (label) => `{ "${label}" => false }`, expected: "current" },
  { id: "valid empty dictionary", output: () => "disabled services = {\n}", expected: "current" },
  { id: "unrelated valid labels", output: (label) => `disabled services = {\n"${label}-other" => disabled\n"other.service" => true\n}`, expected: "current" },
  { id: "mixed native and boolean values", output: (label) => `{ "other.service" => false\n"${label}" => disabled }`, expected: "disabled" },
  { id: "empty output", output: () => "", expected: "unknown" },
  { id: "whitespace output", output: () => "  \n", expected: "unknown" },
  { id: "unknown target value", output: (label) => `{ "${label}" => unexpected }`, expected: "unknown" },
  { id: "unknown unrelated value", output: (label) => `{ "other.service" => unexpected\n"${label}" => enabled }`, expected: "unknown" },
  { id: "unrecognized dictionary wrapper", output: () => "query was refused {}", expected: "unknown" },
  { id: "truncated dictionary", output: (label) => `disabled services = { "${label}" => disabled`, expected: "unknown" },
  { id: "trailing diagnostic", output: (label) => `{ "${label}" => enabled }\nquery incomplete`, expected: "unknown" },
  { id: "duplicate conflicting target", output: (label) => `{ "${label}" => enabled\n"${label}" => disabled }`, expected: "unknown" },
  { id: "duplicate identical target", output: (label) => `{ "${label}" => disabled\n"${label}" => disabled }`, expected: "unknown" },
  { id: "duplicate unrelated label", output: (label) => `{ "other" => enabled\n"other" => enabled\n"${label}" => enabled }`, expected: "unknown" },
  { id: "unquoted target", output: (label) => `{ ${label} => disabled }`, expected: "unknown" },
];

for (const specimen of disabledOutputs) {
  test(`macOS disabled inspection handles ${specimen.id} without changing a task`, async () => {
    const root = await mkdtemp(join(tmpdir(), "canteen-v135-disabled-"));
    const plist = join(root, "fixture.plist");
    const config = { installationId: "status-native-format", schedule: { time: "08:00" } };
    await writeFile(plist, "synthetic plist queried by the deterministic adapter");
    const calls = [];
    const runCommand = async (command, args) => {
      calls.push([command, ...args]);
      if (command === "/bin/launchctl") {
        assert.ok(["print", "print-disabled"].includes(args[0]), "inspection must not mutate a task");
        return args[0] === "print" ? "loaded" : specimen.output(launchdLabel(config));
      }
      assert.equal(command, "/usr/bin/plutil");
      if (args[1] === "Label") return launchdLabel(config);
      if (args[1] === "WorkingDirectory") return root;
      if (args[1] === "ProgramArguments") return JSON.stringify([resolve(root, "runtime", "bin", "node"), resolve(root, "reminder-worker.mjs")]);
      if (args[1] === "StartCalendarInterval") return JSON.stringify({ Hour: 8, Minute: 0 });
      assert.fail("unexpected inspection command");
    };
    try {
      const status = await getSchedulerStatus(root, config, { platform: "darwin", uid: "501", plistPath: plist, runCommand });
      assert.equal(status.status, specimen.expected);
      assert.equal(status.installed, specimen.expected === "current");
      if (specimen.expected === "disabled") assert.ok(status.reasonCodes.includes("job-disabled"));
      if (specimen.expected === "unknown") {
        assert.deepEqual(status.reasonCodes, ["inspection-failed"]);
        assert.equal(calls.some(([command]) => command === "/usr/bin/plutil"), false);
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

for (const specimen of disabledOutputs.filter((item) => item.expected === "unknown")) {
  test(`macOS update stops before mutation for ${specimen.id}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "canteen-v135-stop-"));
    const plist = join(root, "original.plist");
    const config = { installationId: "stop-on-unknown-output", schedule: { time: "08:00" } };
    const original = Buffer.from('<?xml version="1.0"?><plist><dict><key>RunAtLoad</key><true/></dict></plist>');
    await writeFile(plist, original);
    const commands = [];
    try {
      await assert.rejects(installScheduler(root, config, { platform: "darwin", uid: "501", plistPath: plist, runCommand: async (command, args) => {
        commands.push([command, ...args]);
        assert.equal(command, "/bin/launchctl");
        if (args[0] === "print") return "loaded";
        if (args[0] === "print-disabled") return specimen.output(launchdLabel(config));
        assert.fail("unreliable state must stop before any scheduler mutation");
      } }), /无法可靠核对 macOS 后台提醒的停用状态/);
      assert.deepEqual(await readFile(plist), original);
      assert.deepEqual(commands.map((command) => command[1]), ["print", "print-disabled"]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
