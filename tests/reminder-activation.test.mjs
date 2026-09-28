import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  enableReminderTransaction,
  publicReminderErrorMessage,
} from "../portable-server.mjs";
import {
  getSchedulerStatus,
  installScheduler,
  schedulerCommandError,
  taskName,
  uninstallScheduler,
  WINDOWS_SCHEDULER_PERMISSION_MESSAGE,
  WINDOWS_SCHEDULER_ELEVATION_CANCELLED_MESSAGE,
} from "../reminder-scheduler.mjs";

test("the same reminder identity reuses one forced Windows task name after a folder move", async () => {
  const firstRoot = await mkdtemp(join(tmpdir(), "anthropology-canteen-task-first-"));
  const secondRoot = await mkdtemp(join(tmpdir(), "anthropology-canteen-task-second-"));
  const config = reminderConfig();
  const registeredTasks = new Map();
  const invokedNames = [];
  const fakeWindowsRegistry = async (_command, args) => {
    const script = String(args[args.indexOf("-File") + 1] || "");
    if (script.endsWith("inspect-windows-reminder.ps1")) {
      return successfulSchedulerCommand(_command, args);
    }
    const name = args[args.indexOf("-TaskName") + 1];
    const root = args[args.indexOf("-RootPath") + 1];
    invokedNames.push(name);
    registeredTasks.set(name, root);
    return successfulSchedulerCommand(_command, args);
  };

  try {
    await installScheduler(firstRoot, config, {
      platform: "win32",
      runCommand: fakeWindowsRegistry,
    });
    await installScheduler(secondRoot, config, {
      platform: "win32",
      runCommand: fakeWindowsRegistry,
    });

    assert.deepEqual(invokedNames, [taskName(config), taskName(config)]);
    assert.equal(registeredTasks.size, 1);
    assert.equal(registeredTasks.get(taskName(config)), secondRoot);

    const registerScript = await readFile(
      new URL("../tools/register-windows-reminder.ps1", import.meta.url),
      "utf8",
    );
    assert.match(registerScript, /Register-ScheduledTask[\s\S]+-TaskName \$TaskName[\s\S]+-Force/);
  } finally {
    await rm(firstRoot, { recursive: true, force: true });
    await rm(secondRoot, { recursive: true, force: true });
  }
});

function reminderConfig() {
  return {
    enabled: false,
    installationId: "windows-activation-test-id",
    provider: "custom",
    sender: "sender@example.com",
    recipient: "reader@example.com",
    host: "smtp.example.com",
    port: 587,
    security: "starttls",
    username: "sender@example.com",
    format: "detailed",
    schedule: { cadence: "weekly", time: "07:45", weekday: 4, monthDay: 12 },
    credentialRef: "windows-activation-test-id",
    testedConfigHash: "saved-and-tested",
    schedulerPath: "",
    configuredAt: "2026-08-23T00:00:00.000Z",
  };
}

function permissionFailure() {
  return schedulerCommandError({
    operation: "注册",
    windowsPermissionHint: true,
    error: { code: 1, message: "Command failed" },
    stderr: [
      "Register-ScheduledTask : Access is denied.",
      "At C:\\Users\\Alice\\Anthropology Canteen\\tools\\register-windows-reminder.ps1:27 char:1",
      "CategoryInfo : PermissionDenied",
      "FullyQualifiedErrorId : HRESULT 0x80070005",
    ].join("\r\n"),
  });
}

async function successfulSchedulerCommand(_command, args) {
  const script = String(args[args.indexOf("-File") + 1] || "");
  const snapshotIndex = args.indexOf("-TransactionPath");
  if (snapshotIndex >= 0 && args.includes("Restore")) {
    return JSON.stringify({ status: "restored", installed: false });
  }
  if (snapshotIndex >= 0) {
    await writeFile(args[snapshotIndex + 1], JSON.stringify({ existed: false }));
  }
  if (
    script.endsWith("inspect-windows-reminder.ps1") ||
    script.endsWith("register-windows-reminder.ps1") ||
    script.endsWith("elevate-windows-reminder.ps1")
  ) {
    return JSON.stringify({
      status: "current",
      installed: true,
      reasonCodes: [],
      ambiguousTaskCount: 0,
      ambiguousTaskIds: [],
    });
  }
  return "";
}

test("scheduler permission failure happens before the worker and preserves every saved reminder artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "anthropology-canteen-activation-denied-"));
  const marker = join(root, "data", "anthropology-canteen-reminder-scheduler.json");
  const originalConfig = reminderConfig();
  const originalLedger = {
    version: 2,
    baselineComplete: true,
    baselines: { "scholar:stable": { itemKeys: ["doi:old"], ready: true } },
    items: { "doi:old": { sentAt: "2026-08-20T00:00:00.000Z" } },
  };
  const originalSecret = "dpapi-ciphertext-that-must-not-change";
  let savedConfig = structuredClone(originalConfig);
  let ledger = structuredClone(originalLedger);
  let secret = originalSecret;
  let workerRuns = 0;

  try {
    let failure;
    try {
      await enableReminderTransaction({
        current: structuredClone(originalConfig),
        rootPath: root,
        install: (config) => installScheduler(root, config, {
          platform: "win32",
          runCommand: async () => {
            throw permissionFailure();
          },
        }),
        uninstall: () => assert.fail("registration failure must not uninstall an unregistered task"),
        persist: async (config) => {
          savedConfig = structuredClone(config);
        },
        runInitialCheck: async () => {
          workerRuns += 1;
          secret = "unexpected-send";
        },
        snapshotLedger: async () => structuredClone(ledger),
        restoreLedger: async (snapshot) => {
          ledger = structuredClone(snapshot);
        },
      });
      assert.fail("permission failure should reject activation");
    } catch (error) {
      failure = error;
    }

    assert.equal(workerRuns, 0);
    assert.deepEqual(savedConfig, originalConfig);
    assert.deepEqual(ledger, originalLedger);
    assert.equal(secret, originalSecret);
    assert.equal((await getSchedulerStatus(root)).installed, false);
    await assert.rejects(access(marker), { code: "ENOENT" });
    const message = publicReminderErrorMessage(failure);
    assert.equal(message, WINDOWS_SCHEDULER_PERMISSION_MESSAGE);
    assert.doesNotMatch(message, /Access is denied|PermissionDenied|0x80070005|C:\\Users|register-windows-reminder/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Windows retries only the task helper with elevation and verifies before writing the marker", async () => {
  const root = await mkdtemp(join(tmpdir(), "anthropology-canteen-elevation-success-"));
  const marker = join(root, "data", "anthropology-canteen-reminder-scheduler.json");
  const events = [];
  const allArguments = [];
  try {
    const result = await installScheduler(root, reminderConfig(), {
      platform: "win32",
      runCommand: async (_command, args) => {
        const script = String(args[args.indexOf("-File") + 1] || "");
        allArguments.push(args.join(" "));
        if (script.endsWith("register-windows-reminder.ps1")) {
          events.push("normal-register");
          throw permissionFailure();
        }
        if (script.endsWith("elevate-windows-reminder.ps1")) {
          events.push("elevated-helper");
          return successfulSchedulerCommand(_command, args);
        }
        assert.fail(`unexpected task helper: ${script}`);
      },
    });

    assert.deepEqual(events, ["normal-register", "elevated-helper"]);
    assert.equal(result.status, "current");
    assert.equal(JSON.parse(await readFile(marker, "utf8")).path, root);
    assert.doesNotMatch(allArguments.join("\n"), /sender@example|reader@example|dpapi|authorization/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cancelling the Windows permission prompt changes no marker or reminder data", async () => {
  const root = await mkdtemp(join(tmpdir(), "anthropology-canteen-elevation-cancel-"));
  const marker = join(root, "data", "anthropology-canteen-reminder-scheduler.json");
  try {
    await assert.rejects(
      installScheduler(root, reminderConfig(), {
        platform: "win32",
        runCommand: async (_command, args) => {
          const script = String(args[args.indexOf("-File") + 1] || "");
          if (script.endsWith("register-windows-reminder.ps1")) throw permissionFailure();
          if (script.endsWith("elevate-windows-reminder.ps1")) {
            throw schedulerCommandError({
              operation: "请求 Windows 权限",
              error: { code: 6, message: "cancelled" },
              stderr: "ANTHROPOLOGY_CANTEEN_SCHEDULER_ELEVATION_CANCELLED",
            });
          }
          assert.fail("cancellation must stop before inspection");
        },
      }),
      (error) => {
        assert.equal(error.code, "SCHEDULER_ELEVATION_CANCELLED");
        assert.equal(error.userMessage, WINDOWS_SCHEDULER_ELEVATION_CANCELLED_MESSAGE);
        return true;
      },
    );
    await assert.rejects(access(marker), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ambiguous old task ids are preserved for warning and never trigger automatic deletion", async () => {
  const root = await mkdtemp(join(tmpdir(), "anthropology-canteen-ambiguous-tasks-"));
  const config = reminderConfig();
  const invokedScripts = [];
  const ambiguousInspection = JSON.stringify({
    status: "current",
    installed: true,
    reasonCodes: [],
    ambiguousTaskCount: 2,
    ambiguousTaskIds: ["old-task-a", "old-task-b"],
  });
  try {
    const installed = await installScheduler(root, config, {
      platform: "win32",
      runCommand: async (_command, args) => {
        const script = String(args[args.indexOf("-File") + 1] || "");
        invokedScripts.push(script);
        const snapshotIndex = args.indexOf("-TransactionPath");
        if (snapshotIndex >= 0) await writeFile(args[snapshotIndex + 1], JSON.stringify({ existed: false }));
        return ambiguousInspection;
      },
    });
    assert.equal(installed.ambiguousTaskCount, 2);
    assert.deepEqual(installed.ambiguousTaskIds, ["old-task-a", "old-task-b"]);
    assert.doesNotMatch(invokedScripts.join("\n"), /unregister-windows-reminder/i);

    await mkdir(join(root, "runtime"), { recursive: true });
    await mkdir(join(root, "tools"), { recursive: true });
    await writeFile(join(root, "runtime", "node.exe"), "");
    await writeFile(join(root, "reminder-worker.mjs"), "");
    await writeFile(join(root, "tools", "inspect-windows-reminder.ps1"), "");
    const status = await getSchedulerStatus(root, config, {
      platform: "win32",
      runCommand: async () => {
        throw permissionFailure();
      },
    });
    assert.equal(status.installed, false);
    assert.equal(status.status, "permission-denied");
    assert.equal(status.path, "");
    assert.equal(status.ambiguousTaskCount, 2);
    assert.deepEqual(status.ambiguousTaskIds, ["old-task-a", "old-task-b"]);
    assert.doesNotMatch(JSON.stringify(status), /[A-Za-z]:\\|sender@example|reader@example/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a successful scheduler registration precedes the initial check and leaves reminders enabled", async () => {
  const root = await mkdtemp(join(tmpdir(), "anthropology-canteen-activation-success-"));
  const events = [];
  let savedConfig = reminderConfig();
  try {
    const result = await enableReminderTransaction({
      current: structuredClone(savedConfig),
      rootPath: root,
      install: async (config) => {
        events.push("register");
        return installScheduler(root, config, {
          platform: "win32",
          runCommand: successfulSchedulerCommand,
        });
      },
      uninstall: () => assert.fail("successful activation must not roll back"),
      persist: async (config) => {
        savedConfig = structuredClone(config);
        events.push(config.enabled ? "persist-enabled" : "persist-disabled");
      },
      runInitialCheck: async () => {
        assert.equal(JSON.parse(await readFile(join(root, "data", "anthropology-canteen-reminder-scheduler.json"), "utf8")).path, root);
        assert.equal(savedConfig.enabled, true);
        events.push("initial-check");
      },
      snapshotLedger: async () => ({ version: 2, baselines: {}, items: {} }),
      restoreLedger: () => assert.fail("successful activation must not restore the ledger"),
      now: () => "2026-08-24T00:00:00.000Z",
    });

    assert.deepEqual(events, ["register", "persist-enabled", "initial-check"]);
    assert.equal(result.config.enabled, true);
    assert.equal(savedConfig.enabled, true);
    assert.ok(savedConfig.schedulerPath);
    assert.equal(JSON.parse(await readFile(join(root, "data", "anthropology-canteen-reminder-scheduler.json"), "utf8")).path, root);
    assert.equal((await getSchedulerStatus(root)).installed, false, "a marker alone cannot verify the live system task");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an initial-check failure removes the new task and restores disabled config and ledger", async () => {
  const root = await mkdtemp(join(tmpdir(), "anthropology-canteen-activation-rollback-"));
  const originalConfig = reminderConfig();
  const originalLedger = {
    version: 2,
    baselineComplete: true,
    baselines: { "journal:1234-5678": { itemKeys: ["doi:kept"], ready: true } },
    items: { "doi:kept": { sentAt: "2026-08-20T00:00:00.000Z" } },
  };
  const originalSecret = "unchanged-dpapi-ciphertext";
  const events = [];
  let savedConfig = structuredClone(originalConfig);
  let ledger = structuredClone(originalLedger);
  let secret = originalSecret;

  try {
    await assert.rejects(
      enableReminderTransaction({
        current: structuredClone(originalConfig),
        rootPath: root,
        install: async (config) => {
          events.push("register");
          return installScheduler(root, config, {
            platform: "win32",
            runCommand: successfulSchedulerCommand,
          });
        },
        uninstall: async (config) => {
          events.push("unregister");
          await uninstallScheduler(root, config, {
            platform: "win32",
            runCommand: successfulSchedulerCommand,
          });
        },
        persist: async (config) => {
          savedConfig = structuredClone(config);
          events.push(config.enabled ? "persist-enabled" : "persist-disabled");
        },
        runInitialCheck: async () => {
          events.push("initial-check");
          ledger.items["doi:partial"] = { sentAt: "" };
          throw new Error("模拟首次检查失败");
        },
        snapshotLedger: async () => structuredClone(ledger),
        restoreLedger: async (snapshot) => {
          events.push("restore-ledger");
          ledger = structuredClone(snapshot);
        },
      }),
      /模拟首次检查失败/,
    );

    assert.deepEqual(events, [
      "register",
      "persist-enabled",
      "initial-check",
      "persist-disabled",
      "unregister",
      "restore-ledger",
    ]);
    assert.deepEqual(savedConfig, originalConfig);
    assert.deepEqual(ledger, originalLedger);
    assert.equal(secret, originalSecret);
    assert.equal((await getSchedulerStatus(root)).installed, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unknown reminder failures keep a short diagnostic without stack or personal path", () => {
  const message = publicReminderErrorMessage(new Error(
    "计划任务服务暂时不可用，脚本位于 C:\\Users\\Alice\\Private\\register.ps1\n" +
    "    at register (C:\\Users\\Alice\\Private\\server.mjs:10:2)",
  ));
  assert.match(message, /计划任务服务暂时不可用/);
  assert.match(message, /\[本机路径\]/);
  assert.doesNotMatch(message, /Alice|C:\\Users|\bat register\b|server\.mjs/);
});

test("every known Windows permission signature maps to the same safe Chinese instruction", () => {
  for (const stderr of [
    "PermissionDenied",
    "Register-ScheduledTask : Access is denied.",
    "FullyQualifiedErrorId : HRESULT 0x80070005",
  ]) {
    const error = schedulerCommandError({
      operation: "注册",
      windowsPermissionHint: true,
      error: { code: 1, message: "Command failed" },
      stderr,
    });
    assert.equal(publicReminderErrorMessage(error), WINDOWS_SCHEDULER_PERMISSION_MESSAGE);
  }

  const garbled = schedulerCommandError({
    operation: "注册",
    windowsPermissionHint: true,
    error: { code: 1, message: "Command failed" },
    stderr: "\uFFFD\uFFFD\uFFFD\uFFFD\r\nAt C:\\Users\\Alice\\Private\\register.ps1:27",
  });
  const garbledMessage = publicReminderErrorMessage(garbled);
  assert.match(garbledMessage, /^计划任务注册失败（退出码 1）。$/);
  assert.doesNotMatch(garbledMessage, /\uFFFD|Alice|C:\\Users|register\.ps1/);
});

test("Windows helper validation and rollback failures use safe ordinary Chinese", () => {
  const cases = [
    ["ANTHROPOLOGY_CANTEEN_SCHEDULER_VALIDATION_FAILED", /未通过核对.*原任务已恢复/],
    ["ANTHROPOLOGY_CANTEEN_SCHEDULER_ROLLBACK_FAILED", /无法自动恢复原任务/],
    ["ANTHROPOLOGY_CANTEEN_SCHEDULER_ELEVATION_FAILED", /任务小工具未能完成更新/],
  ];
  for (const [stderr, expected] of cases) {
    const error = schedulerCommandError({
      operation: "更新",
      error: { code: 1, message: "Command failed" },
      stderr,
    });
    assert.match(error.userMessage, expected);
    assert.doesNotMatch(error.userMessage, /ANTHROPOLOGY_|C:\\Users|PowerShell/i);
  }
});
