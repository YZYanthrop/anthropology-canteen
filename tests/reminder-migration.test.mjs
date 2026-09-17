import assert from "node:assert/strict";
import {
  cp,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import {
  inspectReminderSecret,
  saveReminderSecret,
} from "../reminder-utils.mjs";
import { importPortableData } from "../packaging/shared/import-data.mjs";

const SERVER_FILES = [
  "portable-server.mjs",
  "reminder-utils.mjs",
  "reminder-mail.mjs",
  "reminder-worker.mjs",
  "reminder-scheduler.mjs",
];

function reminderConfig(id = "migration-reminder-id") {
  return {
    enabled: true,
    installationId: id,
    provider: "qq",
    sender: "sender@qq.com",
    recipient: "reader@example.com",
    host: "smtp.qq.com",
    port: 465,
    security: "tls",
    username: "sender@qq.com",
    format: "concise",
    schedule: { cadence: "daily", time: "08:00", weekday: 1, monthDay: 1 },
    credentialRef: id,
    testedConfigHash: "preserved-test-hash",
    schedulerPath: "C:\\Old Anthropology Canteen",
    configuredAt: "2026-09-01T00:00:00.000Z",
  };
}

function data(label = "Migrated Scholar") {
  return {
    version: 8,
    revision: 3,
    savedAt: "2026-09-01T00:00:00.000Z",
    subscriptions: {
      journal: [],
      scholar: [{
        label,
        subscriptionId: `openalex:${label.toLowerCase().replaceAll(" ", "-")}`,
        followedAt: "2026-08-01T00:00:00.000Z",
      }],
      keyword: [],
    },
    states: {},
    articleArchive: {},
    feed: null,
    translations: {},
    scholarProfiles: {},
  };
}

function blankData() {
  return {
    version: 8,
    revision: 0,
    savedAt: "2026-09-01T00:00:00.000Z",
    subscriptions: { journal: [], scholar: [], keyword: [] },
    states: {},
    articleArchive: {},
    feed: null,
    translations: {},
    scholarProfiles: {},
  };
}

function reminderState() {
  return {
    version: 2,
    enabledAt: "2026-08-01T00:00:00.000Z",
    baselineComplete: true,
    baselines: { "scholar:one": { itemKeys: ["doi:old"], ready: true } },
    items: {},
    pendingDigest: null,
    lastAttemptAt: "2026-09-01T08:00:00.000Z",
    lastCheckAt: "2026-09-01T08:00:00.000Z",
    lastSuccessfulCheckAt: "2026-09-01T08:00:00.000Z",
    lastSuccessfulSendAt: "2026-09-01T08:01:00.000Z",
    nextDueAt: "2026-09-02T08:00:00.000Z",
    lastError: "",
    lastResult: "sent",
  };
}

async function writeJson(file, value) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function preparePortableRoot(root) {
  await mkdir(root, { recursive: true });
  await cp(new URL("../dist", import.meta.url), join(root, "dist"), { recursive: true });
  for (const file of SERVER_FILES) {
    await copyFile(new URL(`../${file}`, import.meta.url), join(root, file));
  }
  if (process.platform === "win32") {
    await mkdir(join(root, "tools"), { recursive: true });
    await copyFile(
      new URL("../tools/dpapi-helper.ps1", import.meta.url),
      join(root, "tools", "dpapi-helper.ps1"),
    );
  }
}

async function startPortableServer(root) {
  const moduleUrl = pathToFileURL(join(root, "portable-server.mjs"));
  moduleUrl.searchParams.set("migration-test", `${Date.now()}-${Math.random()}`);
  const portableModule = await import(moduleUrl.href);
  const server = portableModule.createAnthropologyServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const runtime = await fetch(`${baseUrl}/api/runtime-status`).then((response) => response.json());
  const headers = { "x-anthropology-canteen-session": runtime.sessionToken };
  return { server, baseUrl, headers };
}

test("credential inspection distinguishes missing, unreadable, unsupported, and configured", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "anthropology-canteen-credential-status-"));
  try {
    const config = reminderConfig();
    assert.equal((await inspectReminderSecret(root, config, { platform: "win32" })).status, "missing");
    await writeJson(join(root, "data", "anthropology-canteen-reminder-secret.json"), {
      version: 1,
      ciphertext: "not-valid-for-this-account",
    });
    assert.equal((await inspectReminderSecret(root, config, { platform: "win32" })).status, "unreadable");
    assert.equal((await inspectReminderSecret(root, config, { platform: "linux" })).status, "unsupported");

    if (process.platform !== "win32") {
      t.diagnostic("Windows current-account encryption check runs only on Windows.");
      return;
    }
    await mkdir(join(root, "tools"), { recursive: true });
    await copyFile(
      new URL("../tools/dpapi-helper.ps1", import.meta.url),
      join(root, "tools", "dpapi-helper.ps1"),
    );
    await saveReminderSecret(root, config, "temporary-test-authorization-code");
    const configured = await inspectReminderSecret(root, config);
    assert.equal(configured.status, "configured");
    assert.equal(configured.secret, "temporary-test-authorization-code");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("migration file installation restores every original after an interrupted replacement", async () => {
  const root = await mkdtemp(join(tmpdir(), "anthropology-canteen-migration-rollback-"));
  try {
    const moduleUrl = new URL(`../portable-server.mjs?rollback=${Date.now()}`, import.meta.url);
    const { installMigrationFiles } = await import(moduleUrl.href);
    const first = join(root, "first.json");
    const second = join(root, "second.json");
    await writeFile(first, "first-original", "utf8");
    await writeFile(second, "second-original", "utf8");

    await assert.rejects(
      installMigrationFiles([
        { destination: first, bytes: Buffer.from("first-new") },
        { destination: second, bytes: Buffer.from("second-new") },
      ], {
        renameFile: async (source, destination) => {
          if (source.includes(".migration-") && destination === second) {
            throw new Error("simulated interruption");
          }
          return rename(source, destination);
        },
      }),
      /simulated interruption/,
    );
    assert.equal(await readFile(first, "utf8"), "first-original");
    assert.equal(await readFile(second, "utf8"), "second-original");
    assert.deepEqual((await readdir(root)).sort(), ["first.json", "second.json"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("one sibling supplies data, settings, delivery history, and the Windows encrypted credential", {
  skip: process.platform !== "win32" ? "Windows current-account encryption is required." : false,
}, async () => {
  const parent = await mkdtemp(join(tmpdir(), "anthropology-canteen-complete-migration-"));
  const oldRoot = join(parent, "Anthropology-Canteen-v1.3.2");
  const newRoot = join(parent, "Anthropology-Canteen-v1.3.3");
  const manualRoot = join(parent, "Manual-Import-Comparison");
  let server;
  try {
    await preparePortableRoot(newRoot);
    await preparePortableRoot(oldRoot);
    const oldDataRoot = join(oldRoot, "data");
    const newDataRoot = join(newRoot, "data");
    const config = reminderConfig();
    await writeJson(join(oldDataRoot, "anthropology-canteen-data.json"), data());
    await writeJson(join(oldDataRoot, "anthropology-canteen-settings.json"), {
      version: 3,
      openAlexApiKey: "",
      semanticScholarApiKey: "",
      reminders: config,
    });
    await writeJson(join(oldDataRoot, "anthropology-canteen-reminder-state.json"), reminderState());
    await saveReminderSecret(oldRoot, config, "temporary-migration-authorization-code");
    const oldSecretBefore = await readFile(join(oldDataRoot, "anthropology-canteen-reminder-secret.json"));

    await writeJson(join(newDataRoot, "anthropology-canteen-data.json"), blankData());
    await writeJson(join(newDataRoot, "anthropology-canteen-settings.json"), {
      version: 3,
      openAlexApiKey: "",
      semanticScholarApiKey: "",
      reminders: {},
    });
    await writeJson(join(newDataRoot, "anthropology-canteen-reminder-state.json"), {
      ...reminderState(),
      enabledAt: "",
      baselineComplete: false,
      baselines: {},
      lastAttemptAt: "",
      lastCheckAt: "",
      lastSuccessfulCheckAt: "",
      lastSuccessfulSendAt: "",
      nextDueAt: "",
      lastResult: "",
    });

    const running = await startPortableServer(newRoot);
    server = running.server;
    const status = await fetch(`${running.baseUrl}/api/reminders/status`, {
      headers: running.headers,
    }).then((response) => response.json());
    assert.equal(status.credentialStatus, "configured");
    assert.equal(status.credentialConfigured, true);
    assert.equal(status.reminderMigration.outcome, "restored");
    assert.equal(status.scheduler.needsMigration, true);
    assert.equal(status.state.lastSuccessfulSendAt, "2026-09-01T08:01:00.000Z");

    const migratedData = JSON.parse(await readFile(join(newDataRoot, "anthropology-canteen-data.json"), "utf8"));
    const migratedSettings = JSON.parse(await readFile(join(newDataRoot, "anthropology-canteen-settings.json"), "utf8"));
    assert.equal(migratedData.subscriptions.scholar[0].label, "Migrated Scholar");
    assert.equal(migratedSettings.reminders.installationId, config.installationId);
    assert.deepEqual(
      await readFile(join(newDataRoot, "anthropology-canteen-reminder-secret.json")),
      oldSecretBefore,
    );
    await assert.rejects(readFile(join(newDataRoot, "anthropology-canteen-reminder-scheduler.json")), { code: "ENOENT" });
    assert.deepEqual(
      await readFile(join(oldDataRoot, "anthropology-canteen-reminder-secret.json")),
      oldSecretBefore,
    );

    await preparePortableRoot(manualRoot);
    await importPortableData({ source: oldDataRoot, targetRoot: manualRoot });
    const manualModuleUrl = pathToFileURL(join(manualRoot, "portable-server.mjs"));
    manualModuleUrl.searchParams.set("manual-comparison", String(Date.now()));
    const manualPortableModule = await import(manualModuleUrl.href);
    assert.deepEqual(
      migratedData,
      JSON.parse(JSON.stringify(await manualPortableModule.readLocalDataFile())),
    );
    for (const name of [
      "anthropology-canteen-settings.json",
      "anthropology-canteen-reminder-state.json",
      "anthropology-canteen-reminder-secret.json",
    ]) {
      assert.deepEqual(
        JSON.parse(await readFile(join(newDataRoot, name), "utf8")),
        JSON.parse(await readFile(join(manualRoot, "data", name), "utf8")),
      );
    }

    const repeated = await fetch(`${running.baseUrl}/api/reminders/status`, {
      headers: running.headers,
    }).then((response) => response.json());
    assert.equal(repeated.reminderMigration.outcome, "restored");
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(parent, { recursive: true, force: true });
  }
});

test("a uniquely matching old reminder identity repairs an earlier incomplete Windows migration", {
  skip: process.platform !== "win32" ? "Windows current-account encryption is required." : false,
}, async () => {
  const parent = await mkdtemp(join(tmpdir(), "anthropology-canteen-reminder-backfill-"));
  const oldRoot = join(parent, "Anthropology-Canteen-v1.3.2");
  const unrelatedRoot = join(parent, "Anthropology-Canteen-v1.3.1");
  const newRoot = join(parent, "Anthropology-Canteen-v1.3.3");
  let server;
  try {
    await preparePortableRoot(newRoot);
    await preparePortableRoot(oldRoot);
    const config = reminderConfig("unique-backfill-reminder-id");
    const oldDataRoot = join(oldRoot, "data");
    const newDataRoot = join(newRoot, "data");
    await writeJson(join(oldDataRoot, "anthropology-canteen-data.json"), data());
    await writeJson(join(oldDataRoot, "anthropology-canteen-settings.json"), {
      version: 3,
      openAlexApiKey: "old-api-key",
      semanticScholarApiKey: "",
      reminders: config,
    });
    await writeJson(join(oldDataRoot, "anthropology-canteen-reminder-state.json"), reminderState());
    await saveReminderSecret(oldRoot, config, "temporary-backfill-authorization-code");

    await writeJson(join(unrelatedRoot, "data", "anthropology-canteen-data.json"), data("Unrelated Scholar"));
    await writeJson(join(unrelatedRoot, "data", "anthropology-canteen-settings.json"), {
      version: 3,
      openAlexApiKey: "",
      semanticScholarApiKey: "",
      reminders: reminderConfig("different-reminder-identity"),
    });

    await writeJson(join(newDataRoot, "anthropology-canteen-data.json"), data("Already Migrated Scholar"));
    await writeJson(join(newDataRoot, "anthropology-canteen-settings.json"), {
      version: 3,
      openAlexApiKey: "new-api-key-must-stay",
      semanticScholarApiKey: "",
      reminders: config,
    });

    const running = await startPortableServer(newRoot);
    server = running.server;
    const status = await fetch(`${running.baseUrl}/api/reminders/status`, {
      headers: running.headers,
    }).then((response) => response.json());
    assert.equal(status.reminderMigration.outcome, "restored");
    assert.equal(status.credentialStatus, "configured");
    assert.equal(status.state.lastSuccessfulSendAt, "2026-09-01T08:01:00.000Z");

    const currentData = JSON.parse(await readFile(join(newDataRoot, "anthropology-canteen-data.json"), "utf8"));
    const currentSettings = JSON.parse(await readFile(join(newDataRoot, "anthropology-canteen-settings.json"), "utf8"));
    assert.equal(currentData.subscriptions.scholar[0].label, "Already Migrated Scholar");
    assert.equal(currentSettings.openAlexApiKey, "new-api-key-must-stay");
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(parent, { recursive: true, force: true });
  }
});

test("a damaged companion file cancels the whole automatic migration", async () => {
  const parent = await mkdtemp(join(tmpdir(), "anthropology-canteen-invalid-migration-"));
  const oldRoot = join(parent, "Anthropology-Canteen-v1.3.2");
  const newRoot = join(parent, "Anthropology-Canteen-v1.3.3");
  let server;
  try {
    await preparePortableRoot(newRoot);
    const oldDataRoot = join(oldRoot, "data");
    const newDataRoot = join(newRoot, "data");
    await writeJson(join(oldDataRoot, "anthropology-canteen-data.json"), data());
    const damagedSettings = "{ this is not valid JSON";
    await writeFile(join(oldDataRoot, "anthropology-canteen-settings.json"), damagedSettings, "utf8");

    const running = await startPortableServer(newRoot);
    server = running.server;
    const status = await fetch(`${running.baseUrl}/api/reminders/status`, {
      headers: running.headers,
    }).then((response) => response.json());
    assert.equal(status.reminderMigration.outcome, "manual-import-required");
    assert.equal(status.reminderMigration.reason, "source-invalid");
    await assert.rejects(readFile(join(newDataRoot, "anthropology-canteen-data.json")), { code: "ENOENT" });
    await assert.rejects(readFile(join(newDataRoot, "anthropology-canteen-settings.json")), { code: "ENOENT" });
    assert.equal(await readFile(join(oldDataRoot, "anthropology-canteen-settings.json"), "utf8"), damagedSettings);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(parent, { recursive: true, force: true });
  }
});

test("an ambiguous backfill source is reported and does not copy reminder files", async () => {
  const parent = await mkdtemp(join(tmpdir(), "anthropology-canteen-ambiguous-migration-"));
  const newRoot = join(parent, "Anthropology-Canteen-v1.3.3");
  let server;
  try {
    await preparePortableRoot(newRoot);
    const config = reminderConfig("ambiguous-reminder-id");
    const targetDataRoot = join(newRoot, "data");
    await writeJson(join(targetDataRoot, "anthropology-canteen-data.json"), data("Current Scholar"));
    await writeJson(join(targetDataRoot, "anthropology-canteen-settings.json"), {
      version: 3,
      openAlexApiKey: "",
      semanticScholarApiKey: "",
      reminders: config,
    });

    for (const name of ["Anthropology-Canteen-v1.3.1", "Anthropology-Canteen-v1.3.2"]) {
      const sourceDataRoot = join(parent, name, "data");
      await writeJson(join(sourceDataRoot, "anthropology-canteen-data.json"), data(name));
      await writeJson(join(sourceDataRoot, "anthropology-canteen-settings.json"), {
        version: 3,
        openAlexApiKey: "",
        semanticScholarApiKey: "",
        reminders: config,
      });
      await writeJson(join(sourceDataRoot, "anthropology-canteen-reminder-state.json"), reminderState());
    }

    const running = await startPortableServer(newRoot);
    server = running.server;
    const status = await fetch(`${running.baseUrl}/api/reminders/status`, {
      headers: running.headers,
    }).then((response) => response.json());
    assert.equal(status.reminderMigration.outcome, "manual-import-required");
    assert.equal(status.reminderMigration.reason, "ambiguous-source");
    await assert.rejects(readFile(join(targetDataRoot, "anthropology-canteen-reminder-state.json")), { code: "ENOENT" });
    await assert.rejects(readFile(join(targetDataRoot, "anthropology-canteen-reminder-secret.json")), { code: "ENOENT" });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(parent, { recursive: true, force: true });
  }
});
