import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
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
  uninstallScheduler,
  WINDOWS_SCHEDULER_PERMISSION_MESSAGE,
} from "../reminder-scheduler.mjs";

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
          runCommand: async () => undefined,
        });
      },
      uninstall: () => assert.fail("successful activation must not roll back"),
      persist: async (config) => {
        savedConfig = structuredClone(config);
        events.push(config.enabled ? "persist-enabled" : "persist-disabled");
      },
      runInitialCheck: async () => {
        assert.equal((await getSchedulerStatus(root)).installed, true);
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
    assert.equal((await getSchedulerStatus(root)).installed, true);
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
            runCommand: async () => undefined,
          });
        },
        uninstall: async (config) => {
          events.push("unregister");
          await uninstallScheduler(root, config, {
            platform: "win32",
            runCommand: async () => undefined,
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
