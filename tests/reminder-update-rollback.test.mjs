import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { enableReminderTransaction, publicReminderErrorMessage } from "../portable-server.mjs";
import { withSchedulerTransaction, getSchedulerStatus, installScheduler } from "../reminder-scheduler.mjs";
import { writeJsonAtomic } from "../reminder-utils.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

for (const blockedFile of ["anthropology-canteen-settings.json", "anthropology-canteen-reminder-scheduler.json"]) {
  test(`failed restoration of ${blockedFile} retains recovery bytes and blocks a new process`, async () => {
    const root = await mkdtemp(join(tmpdir(), "canteen-slice-a-restore-"));
    const data = join(root, "data");
    const destination = join(data, blockedFile);
    const original = '{ "synthetic": "original bytes" }\n';
    await mkdir(data);
    await writeFile(destination, original);
    try {
      await assert.rejects(withSchedulerTransaction(root, {}, async () => {
        // An obstructing directory simulates a target that can no longer be
        // replaced. It is confined to this synthetic fixture.
        await rm(destination);
        await mkdir(destination);
        throw new Error("injected persistence failure");
      }, { platform: "test-only" }), /恢复未完成/);
      const journal = JSON.parse(await readFile(join(data, ".scheduler-update.json"), "utf8"));
      assert.equal(Buffer.from(journal.files[blockedFile], "base64").toString(), original);
      const schedulerUrl = new URL("../reminder-scheduler.mjs", import.meta.url).href;
      const script = `import assert from 'node:assert/strict';
        import { withSchedulerTransaction, schedulerRecoveryPending } from ${JSON.stringify(schedulerUrl)};
        const root = process.argv[1];
        assert.equal(await schedulerRecoveryPending(root), true);
        await assert.rejects(withSchedulerTransaction(root, {}, () => assert.fail('must not mutate')), /恢复未完成/);`;
      await execFileAsync(process.execPath, ["--input-type=module", "-e", script, root]);
      assert.equal(await readFile(join(data, ".scheduler-update.json"), "utf8"), JSON.stringify(journal));
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

for (const state of ["loaded", "unloaded", "disabled", "absent"]) {
  for (const fails of [false, true]) {
    test(`macOS update preserves ${state} task and suppresses worker execution (failure=${fails})`, async () => {
      const root = await mkdtemp(join(tmpdir(), "canteen-slice-a-mac-"));
      const plist = join(root, "isolated-launchagents", "reminder.plist");
      const oldRoot = join(root, "old");
      const config = { installationId: "slice-a-test", schedule: { time: "08:00" } };
      let label;
      let loaded = state === "loaded";
      const disabled = state === "disabled";
      const initialLoaded = loaded;
      const original = Buffer.from('<?xml version="1.0"?><plist><dict><key>RunAtLoad</key><true/></dict></plist>');
      const bootstrapDefinitions = [];
      const mutations = [];
      await mkdir(join(root, "isolated-launchagents"));
      if (state !== "absent") await writeFile(plist, original);
      const runCommand = async (command, args) => {
        if (command === "/usr/bin/plutil") {
          if (args[1] === "Label") return label;
          if (args[1] === "WorkingDirectory") return oldRoot;
          if (args[1] === "ProgramArguments") return JSON.stringify([resolve(oldRoot, "runtime", "bin", "node"), resolve(oldRoot, "reminder-worker.mjs")]);
          assert.fail("unexpected plist query");
        }
        assert.equal(command, "/bin/launchctl");
        if (args[0] === "print") {
          label = args[1].split("/").at(-1);
          if (!loaded) throw new Error("Could not find service");
          return "loaded";
        }
        if (args[0] === "print-disabled") return `{ "${label}" => ${disabled} }`;
        mutations.push(args[0]);
        if (args[0] === "bootout") { loaded = false; return ""; }
        if (args[0] === "bootstrap") {
          const bytes = await readFile(plist, "utf8");
          assert.match(bytes, /<key>RunAtLoad<\/key>\s*<false\s*\/>/);
          bootstrapDefinitions.push(bytes);
          loaded = true;
          return "";
        }
        assert.fail("updating must not kickstart or run a worker");
      };
      try {
        const operation = installScheduler(root, config, {
          platform: "darwin", uid: "501", plistPath: plist, runCommand,
          writeMarker: async (path, marker) => {
            await writeJsonAtomic(path, marker);
            if (fails) throw new Error("injected marker failure");
          },
        });
        if (fails) {
          await assert.rejects(operation, /injected marker failure/);
          assert.equal(loaded, initialLoaded);
          if (state === "absent") await assert.rejects(access(plist), { code: "ENOENT" });
          else assert.deepEqual(await readFile(plist), original);
        } else {
          await operation;
          assert.equal(loaded, state === "loaded" || state === "absent");
          assert.match(await readFile(plist, "utf8"), /<key>RunAtLoad<\/key><true\/>/);
        }
        if (state === "disabled" || state === "unloaded") assert.deepEqual(mutations, []);
        else assert.ok(bootstrapDefinitions.length > 0);
        await assert.rejects(access(join(root, "data", ".scheduler-update.json")), { code: "ENOENT" });
      } finally { await rm(root, { recursive: true, force: true }); }
    });
  }
}

function fixture({ existed = true, enabled = true, failAt = "persist", rollbackFails = false } = {}) {
  const current = { enabled, installationId: "slice-a-test", schedulerPath: existed ? "old-folder" : "", schedule: { time: "08:00" } };
  const originalTask = existed ? { path: "old-folder", enabled, dailyEnabled: false, logonEnabled: true, principal: "original-user", runLevel: "Limited" } : null;
  let task = structuredClone(originalTask);
  let saved = structuredClone(current);
  let marker = existed ? { path: "old-folder", installedAt: "previous-success" } : null;
  let workerRuns = 0;
  const events = [];
  return {
    originalTask, current, events,
    state: () => ({ task, saved, marker, workerRuns }),
    args: {
      current, rootPath: "new-folder", operation: "update",
      snapshotScheduler: async () => {
        events.push("snapshot");
        return structuredClone({ task, marker });
      },
      install: async () => {
        events.push("install");
        task = { path: "new-folder", enabled: true };
        if (failAt === "inspection") throw new Error("inspection threw after registration");
        marker = { path: "new-folder" };
        if (failAt === "marker") throw new Error("marker write failed after replacement");
        return { taskName: "slice-a-test" };
      },
      uninstall: async () => { events.push("uninstall"); task = null; marker = null; },
      restoreScheduler: async (snapshot) => {
        events.push("restore");
        if (rollbackFails) throw new Error("restore refused");
        task = structuredClone(snapshot.task);
        marker = structuredClone(snapshot.marker);
      },
      commitScheduler: async () => { events.push("commit"); },
      persist: async (next) => {
        saved = structuredClone(next);
        if (failAt === "persist" && next.schedulerPath !== current.schedulerPath) throw new Error("settings write failed after replacement");
      },
      snapshotLedger: async () => ({ version: 2 }),
      restoreLedger: async () => { events.push("restore-ledger"); },
      runInitialCheck: async () => { workerRuns += 1; },
    },
  };
}

for (const failAt of ["inspection", "marker", "persist"]) {
  for (const previous of [{ existed: true, enabled: true }, { existed: true, enabled: false }, { existed: false, enabled: false }]) {
    test(`update ${failAt} failure restores task and records (existed=${previous.existed}, enabled=${previous.enabled})`, async () => {
      const f = fixture({ ...previous, failAt });
      await assert.rejects(enableReminderTransaction(f.args));
      assert.deepEqual(f.state().task, f.originalTask);
      assert.deepEqual(f.state().saved, f.current);
      assert.deepEqual(f.state().marker, previous.existed ? { path: "old-folder", installedAt: "previous-success" } : null);
      assert.equal(f.state().workerRuns, 0);
      assert.equal(f.events[0], "snapshot");
      assert.ok(!f.events.includes("uninstall"), "restore owns cleanup; do not blindly uninstall the original task");
    });
  }
}

test("explicit folder update never runs the initial check even when saved enabled is false", async () => {
  const f = fixture({ enabled: false, failAt: "none" });
  await enableReminderTransaction(f.args);
  assert.equal(f.state().workerRuns, 0);
  assert.ok(f.events.includes("commit"));
});

test("explicit re-enable changes saved enabled state but never performs an immediate check", async () => {
  const f = fixture({ enabled: false, failAt: "none" });
  await enableReminderTransaction({ ...f.args, operation: "reenable" });
  assert.equal(f.state().saved.enabled, true);
  assert.equal(f.state().workerRuns, 0);
});

test("failed task restoration is reported without claiming unchanged or restored state", async () => {
  const f = fixture({ failAt: "inspection", rollbackFails: true });
  await assert.rejects(enableReminderTransaction(f.args), (error) => {
    const message = publicReminderErrorMessage(error);
    assert.match(message, /恢复未完成|回滚未完全成功/);
    assert.doesNotMatch(message, /没有更改|原任务已恢复/);
    return true;
  });
  assert.ok(!f.events.includes("commit"));
});

for (const failAt of ["inspection", "marker", "settings", "restore"]) {
  for (const existed of [true, false]) {
    test(`durable ${failAt} failure preserves exact local files and task ownership (existed=${existed})`, async () => {
      const root = await mkdtemp(join(tmpdir(), "canteen-slice-a-files-"));
      const data = join(root, "data");
      await mkdir(data);
      const settingsPath = join(data, "anthropology-canteen-settings.json");
      const markerPath = join(data, "anthropology-canteen-reminder-scheduler.json");
      const current = { enabled: true, installationId: "slice-a-test", schedulerPath: "old-folder", schedule: { time: "08:00" } };
      const originalSettings = '{ "version": 3, "openAlexApiKey": "synthetic", "reminders": { "enabled": true } }\n';
      const originalMarker = '{ "path": "old-folder", "taskName": "old-test-task" }\n';
      await writeFile(settingsPath, originalSettings);
      if (existed) await writeFile(markerPath, originalMarker);
      const originalTask = existed ? { root: "old-folder", enabled: false, dailyEnabled: false, owner: "original-user" } : null;
      let task = structuredClone(originalTask);
      let calls = 0;
      const options = {
        platform: "win32",
        runCommand: async (_command, args) => {
          calls += 1;
          const snapshotPath = args[args.indexOf("-TransactionPath") + 1];
          if (args.includes("Restore")) {
            if (failAt === "restore") throw new Error("temporary OS restoration denied");
            task = JSON.parse(await readFile(snapshotPath, "utf8")).task;
            return JSON.stringify({ status: "restored", installed: existed });
          }
          await writeFile(snapshotPath, JSON.stringify({ task }));
          task = { root, enabled: false, dailyEnabled: false, owner: "original-user" };
          if (failAt === "inspection") throw new Error("OS check threw after registration");
          return JSON.stringify({ status: "current", installed: true });
        },
        writeMarker: async (path, value) => {
          await writeJsonAtomic(path, value);
          if (failAt === "marker") throw new Error("marker close failed after replacement");
        },
      };
      const perform = () => withSchedulerTransaction(root, current, (controls) => enableReminderTransaction({
        ...controls, current, rootPath: root, operation: "update",
        persist: async (next) => {
          await writeJsonAtomic(settingsPath, { version: 3, reminders: next });
          if (["settings", "restore"].includes(failAt)) throw new Error("settings close failed after replacement");
        },
        runInitialCheck: () => assert.fail("updating must not run the worker"),
        snapshotLedger: () => assert.fail("updating must not reset the ledger"),
        restoreLedger: () => assert.fail("updating must not reset the ledger"),
      }), options);
      try {
        await assert.rejects(perform());
        assert.equal(await readFile(settingsPath, "utf8"), originalSettings);
        if (existed) assert.equal(await readFile(markerPath, "utf8"), originalMarker);
        else await assert.rejects(access(markerPath), { code: "ENOENT" });
        if (failAt === "restore") {
          const status = await getSchedulerStatus(root, current, options);
          assert.equal(status.installed, false);
          assert.equal(status.status, "recovery-required");
          const journal = JSON.parse(await readFile(join(data, ".scheduler-update.json"), "utf8"));
          assert.equal(journal.phase, "prepared");
          await access(journal.taskSnapshot);
          const previousCalls = calls;
          await assert.rejects(perform(), /恢复未完成/);
          assert.equal(calls, previousCalls, "restart/retry guard must precede any OS operation");
        } else {
          assert.deepEqual(task, originalTask);
          await assert.rejects(access(join(data, ".scheduler-update.json")), { code: "ENOENT" });
        }
      } finally { await rm(root, { recursive: true, force: true }); }
    });
  }
}
