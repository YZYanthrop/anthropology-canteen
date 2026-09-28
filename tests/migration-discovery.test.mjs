import assert from "node:assert/strict";
import test from "node:test";
import { copyFile, mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setWindowsFixtureAccess } from "./helpers/windows-files.mjs";

async function fixture() {
  const parent = await mkdtemp(join(tmpdir(), "canteen-discovery-"));
  const root = join(parent, "current");
  await mkdir(join(root, "dist", "server"), { recursive: true });
  await mkdir(join(root, "data"));
  await writeFile(join(root, "package.json"), '{"type":"module"}');
  await writeFile(join(root, "dist", "server", "index.js"), 'export default { fetch() { throw new Error("No network in discovery fixtures"); } };');
  for (const name of ["portable-server.mjs", "reminder-utils.mjs", "reminder-mail.mjs", "reminder-worker.mjs", "reminder-scheduler.mjs"]) {
    await copyFile(new URL(`../${name}`, import.meta.url), join(root, name));
  }
  const serverModule = await import(pathToFileURL(join(root, "portable-server.mjs")).href);
  return { parent, root, module: serverModule, dataFile: join(root, "data", "anthropology-canteen-data.json") };
}
const denied = async () => { throw Object.assign(new Error("synthetic parent denied"), { code: "EACCES" }); };

test("parent scan failure does not block healthy current data or overwrite its bytes", async () => {
  const f = await fixture();
  try {
    const value = { ...f.module.emptyLocalData(), states: { current: { read: true, saved: false, ignored: false } } };
    const original = JSON.stringify(value);
    await writeFile(f.dataFile, original);
    // A partial reminder migration still needs discovery; its failure must not
    // block independently valid current research data.
    await writeFile(join(f.root, "data", "anthropology-canteen-settings.json"), JSON.stringify({ version: 3, reminders: {
      enabled: true, sender: "synthetic@example.test", username: "synthetic@example.test", installationId: "discovery-fixture-identity", credentialRef: "discovery-fixture-identity",
    } }));
    let scans = 0;
    const result = await f.module.readLocalDataFile({ scan: async () => { scans++; return denied(); } });
    assert.equal(scans, 1, "valid reminder identity must actually exercise the failed backfill scan");
    assert.deepEqual(result.states, value.states);
    assert.equal(await readFile(f.dataFile, "utf8"), original);
  } finally { await rm(f.parent, { recursive: true, force: true }); }
});

test("failed discovery with no current data does not initialize an empty replacement", async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.module.readLocalDataFile({ scan: denied }), { code: "MIGRATION_DISCOVERY_FAILED" });
    await assert.rejects(readFile(f.dataFile), { code: "ENOENT" });
  } finally { await rm(f.parent, { recursive: true, force: true }); }
});

test("successful empty discovery retries when an old version appears later", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.module.readLocalDataFile()).version, 8);
    const oldData = join(f.parent, "old", "data");
    await mkdir(oldData, { recursive: true });
    await writeFile(join(oldData, "anthropology-canteen-data.json"), JSON.stringify({ ...f.module.emptyLocalData(), states: { preserved: { saved: true } } }));
    assert.equal((await f.module.readLocalDataFile()).states.preserved.saved, true);
  } finally { await rm(f.parent, { recursive: true, force: true }); }
});

test("scan denial, disappearing candidate and no old version are distinct", async () => {
  const f = await fixture();
  try {
    const unavailable = await f.module.findSiblingMigrationCandidates({ readDirectory: denied });
    assert.equal(unavailable.reason, "source-scan-failed");
    assert.deepEqual(unavailable.candidates, []);
    const empty = await f.module.findSiblingMigrationCandidates({ readDirectory: async () => [] });
    assert.equal(empty.reason, "");
    const disappeared = await f.module.findSiblingMigrationCandidates({
      readDirectory: async () => [{ name: "old", isDirectory: () => true }],
      statFile: async () => ({ isFile: () => true, mtimeMs: 1 }),
      readCandidate: async () => ({ exists: false }),
    });
    assert.equal(disappeared.reason, "source-scan-incomplete");
  } finally { await rm(f.parent, { recursive: true, force: true }); }
});

test("unreadable current file and incomplete recovery never create blank data", async () => {
  const f = await fixture();
  try {
    await mkdir(f.dataFile);
    await assert.rejects(f.module.readLocalDataFile());
    await rm(f.dataFile, { recursive: true });
    await writeFile(join(f.root, "data", ".migration-recovery.json"), '{"phase":"prepared"}');
    await assert.rejects(f.module.readLocalDataFile(), { code: "MIGRATION_RECOVERY_REQUIRED" });
    await assert.rejects(readFile(f.dataFile), { code: "ENOENT" });
  } finally { await rm(f.parent, { recursive: true, force: true }); }
});

test("Windows native parent listing denial preserves readable current data", { skip: process.platform !== "win32" }, async () => {
  const f = await fixture();
  const original = JSON.stringify({ ...f.module.emptyLocalData(), states: { native: { saved: true } } });
  await writeFile(f.dataFile, original);
  try {
    await setWindowsFixtureAccess(f.parent, f.parent, "DenyList");
    assert.equal((await f.module.findSiblingMigrationCandidates()).reason, "source-scan-failed");
    assert.equal((await f.module.readLocalDataFile()).states.native.saved, true);
    assert.equal(await readFile(f.dataFile, "utf8"), original);
  } finally {
    await setWindowsFixtureAccess(f.parent, f.parent, "AllowList");
    await rm(f.parent, { recursive: true, force: true });
  }
});

test("unreadable sibling identity prevents selecting a falsely unique reminder backfill", async () => {
  const f = await fixture();
  const settings = { version: 3, reminders: { enabled: true, sender: "synthetic@example.test", username: "synthetic@example.test", installationId: "discovery-fixture-identity", credentialRef: "discovery-fixture-identity" } };
  const current = JSON.stringify({ ...f.module.emptyLocalData(), states: { current: { read: true } } });
  try {
    await writeFile(f.dataFile, current);
    await writeFile(join(f.root, "data", "anthropology-canteen-settings.json"), JSON.stringify(settings));
    for (const name of ["known", "unreadable"]) {
      const directory = join(f.parent, name, "data");
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "anthropology-canteen-data.json"), current);
      if (name === "known") {
        await writeFile(join(directory, "anthropology-canteen-settings.json"), JSON.stringify(settings));
        await writeFile(join(directory, "anthropology-canteen-reminder-state.json"), JSON.stringify({ version: 2, baselines: {}, items: {}, baselineComplete: true }));
      } else await mkdir(join(directory, "anthropology-canteen-settings.json"));
    }
    await f.module.readLocalDataFile();
    await assert.rejects(readFile(join(f.root, "data", "anthropology-canteen-reminder-state.json")), { code: "ENOENT" });
    assert.equal(await readFile(f.dataFile, "utf8"), current);
  } finally { await rm(f.parent, { recursive: true, force: true }); }
});
