import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schedulerCommandError, getSchedulerStatus, installScheduler, launchdLabel } from "../reminder-scheduler.mjs";

const config = { installationId: "diagnostic-regression", schedule: { time: "23:59" } };
const label = launchdLabel(config);
const missing = `Could not find service "${label}" in domain for user gui: 501`;
const wrapped = (stderr, command = "/bin/launchctl", args = ["print", `gui/501/${label}`]) => schedulerCommandError({
  command, args, error: { code: 113, message: "synthetic exit" }, stderr,
});
for (const stderr of [missing, `Bad request.\n${missing}`, `Bad request.\r\n${missing}\r\n`]) {
  test(`native missing diagnostic remains classified after display sanitization: ${JSON.stringify(stderr)}`, () => {
    const error = wrapped(stderr);
    assert.equal(error.code, "SCHEDULER_TASK_MISSING");
    assert.doesNotMatch(error.message, /diagnostic-regression|gui:|501|Bad request/);
  });
}
for (const stderr of ["Bad request.", "Operation not permitted", `Permission denied\n${missing}`, `Unknown failure\n${missing}`, missing.replace(label, "unrelated-label"), missing.replace("501", "502")]) {
  test(`unknown or mismatched launchctl failure is not treated as absent: ${JSON.stringify(stderr)}`, () => {
    assert.equal(wrapped(stderr).code, "SCHEDULER_COMMAND_FAILED");
  });
}
test("only the matching launchctl print may classify absence", () => {
  assert.equal(wrapped(missing, "/bin/launchctl", ["bootstrap", "gui/501", "/synthetic.plist"]).code, "SCHEDULER_COMMAND_FAILED");
  assert.equal(wrapped(missing, "powershell.exe").code, "SCHEDULER_COMMAND_FAILED");
});
for (const fails of [false, true]) {
  test(`default-wrapped absence supports first install and rollback (persistence failure=${fails})`, async () => {
    const root = await mkdtemp(join(tmpdir(), "canteen-native-diagnostic-"));
    const plist = join(root, "owned.plist");
    let loaded = false;
    let bootstraps = 0;
    const runCommand = async (command, args) => {
      assert.equal(command, "/bin/launchctl");
      if (args[0] === "print") {
        if (!loaded) throw wrapped(`Bad request.\n${missing}`, command, args);
        return "loaded";
      }
      if (args[0] === "print-disabled") return "disabled services = { }";
      if (args[0] === "bootstrap") {
        assert.match(await readFile(plist, "utf8"), /<key>RunAtLoad<\/key>\s*<false\s*\/>/);
        loaded = true; bootstraps += 1; return "";
      }
      if (args[0] === "bootout") { loaded = false; return ""; }
      assert.fail("Unexpected mutation/worker invocation");
    };
    const options = { platform: "darwin", uid: "501", plistPath: plist, runCommand };
    try {
      assert.equal((await getSchedulerStatus(root, config, options)).status, "missing");
      await mkdir(join(root, "data"));
      const settings = join(root, "data", "anthropology-canteen-settings.json");
      await writeFile(settings, '{"synthetic":"preserve"}');
      if (fails) await assert.rejects(installScheduler(root, config, { ...options, writeMarker: async () => { throw new Error("synthetic marker failure"); } }), /synthetic marker failure/);
      else await installScheduler(root, config, options);
      assert.equal(bootstraps, 1);
      assert.equal(loaded, !fails);
      if (fails) await assert.rejects(access(plist), { code: "ENOENT" });
      assert.equal(await readFile(settings, "utf8"), '{"synthetic":"preserve"}');
      await assert.rejects(access(join(root, "data", ".scheduler-update.json")), { code: "ENOENT" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
for (const stderr of ["Bad request.", `Permission denied\n${missing}`]) {
  test(`unclassified query blocks update before mutation: ${JSON.stringify(stderr)}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "canteen-query-diagnostic-"));
    const plist = join(root, "owned.plist");
    const original = '<plist><dict><key>RunAtLoad</key><true/></dict></plist>';
    await writeFile(plist, original);
    const options = { platform: "darwin", uid: "501", plistPath: plist, runCommand: async (command, args) => {
      assert.equal(args[0], "print", "Uncertain inspection must not mutate");
      throw wrapped(stderr, command, args);
    } };
    try {
      assert.equal((await getSchedulerStatus(root, config, options)).status, "unknown");
      await assert.rejects(installScheduler(root, config, options), { code: "SCHEDULER_COMMAND_FAILED" });
      assert.equal(await readFile(plist, "utf8"), original);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
