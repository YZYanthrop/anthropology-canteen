#!/usr/bin/env node
// B/D acceptance of the immutable published source. No built package is modified.
// Source fixtures replace ONLY the rendering/worker boundaries with offline sentinels.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { release as osRelease } from "node:os";

const PRODUCT_SHA = "bb78dd9431a61617c3198b087ac556759ef85333";
const execute = promisify(execFile);
const options = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, args) => {
  if (value.startsWith("--")) pairs.push([value.slice(2), args[index + 1]]);
  return pairs;
}, []));
if (!options.source || !options.scratch || !options.report) {
  throw new Error("Usage: node migration.mjs --source RELEASE_CHECKOUT --scratch OWNED_TEMP_PARENT --report REPORT.json [--case EXACT_CASE_ID]");
}
const source = resolve(options.source);
const scratch = resolve(options.scratch);
const reportPath = resolve(options.report);
const report = { sourceCommit: PRODUCT_SHA, cases: [], environment: {
  platform: process.platform, arch: process.arch, kernel: osRelease(), node: process.version,
  uid: process.getuid?.() ?? null,
}, cleanup: { status: "pending", errors: [], retainedEvidence: [] },
scope: "Published source B/D with documented offline fixture boundaries; never package black-box. No OS reminder task is created here.",
notCovered: ["UI rendering", "Real mailbox", "Full disk/physical interruption", "OS restart", "Finder and safety dialogs"] };
let owned;
let utils;
const sourceModules = ["portable-server.mjs", "reminder-utils.mjs", "reminder-scheduler.mjs", "reminder-mail.mjs"];
const permissionRestorations = new Set();
const children = new Set();
let caseObservations = [];

function within(file, root) {
  const rel = relative(root, resolve(file));
  return rel !== "" && !isAbsolute(rel) && !rel.startsWith(`..${sep}`) && rel !== "..";
}
function diagnostic(error, depth = 0) {
  const result = { name: error?.name || "Error", code: error?.code || "", message: String(error?.message || error)
    .replaceAll(source, "[release-source]").replaceAll(owned || scratch, "[synthetic-fixture]").slice(0, 1200),
  recovery: error?.recovery || "", cleanupFailed: Boolean(error?.cleanupFailed) };
  if (error?.syscall) result.syscall = String(error.syscall);
  if (error?.errno) result.errno = error.errno;
  if (depth < 3) {
    if (error?.cause) result.cause = diagnostic(error.cause, depth + 1);
    if (Array.isArray(error?.recoveryErrors)) result.recoveryErrors = error.recoveryErrors.map((entry) => diagnostic(entry, depth + 1));
    if (Array.isArray(error?.errors)) result.errors = error.errors.map((entry) => diagnostic(entry, depth + 1));
  }
  return result;
}
async function exists(file) { try { await stat(file); return true; } catch (e) { if (e.code === "ENOENT") return false; throw e; } }
async function json(file, value) { await mkdir(dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(value)); }
async function caseDirectory(id) { const path = join(owned, id); await mkdir(path); return path; }
async function capture(id, directory) {
  const target = join(dirname(reportPath), "migration-evidence", id);
  await mkdir(target, { recursive: true });
  const mapping = [];
  async function collect(folder, parts = []) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const name = entry.name;
      if (["dist", "runtime", "tools", ".migration-write.lock", ".anthropology-canteen-migration.lock"].includes(name)) continue;
      const sourcePath = join(folder, name);
      const relativeParts = [...parts, name];
      if (entry.isDirectory()) { await collect(sourcePath, relativeParts); continue; }
      if (!entry.isFile() || !([".json", ".jsonl", ".json.backup", ".tmp"].some((suffix) => name.endsWith(suffix)) || name.includes(".migration-") || name.includes(".restore-"))) continue;
      const outputParts = relativeParts.map((part) => part.startsWith(".") ? "hidden-" + part.slice(1) : part);
      const output = join(target, ...outputParts);
      await mkdir(dirname(output), { recursive: true });
      await copyFile(sourcePath, output);
      mapping.push({ original: relativeParts.join("/"), artifact: outputParts.join("/") });
    }
  }
  await collect(directory);
  await json(join(target, "evidence-files.json"), mapping);
  assert.ok(mapping.length > 0, "No synthetic recovery evidence was captured");
  report.cleanup.retainedEvidence.push(relative(dirname(reportPath), target).split(sep).join("/"));
}
async function runCase(id, category, body) {
  if (options.case && options.case !== id) return;
  caseObservations = [];
  const started = Date.now();
  try {
    const details = await body();
    report.cases.push({ id, category, status: details?.pending ? "pending" : "pass", details, durationMs: Date.now() - started });
  } catch (error) {
    report.cases.push({ id, category, status: "fail", details: { ...diagnostic(error), observations: caseObservations }, durationMs: Date.now() - started });
    const directory = join(owned, id);
    if (await exists(directory)) {
      try { await capture(`${id}-failure`, directory); } catch (captureError) { report.cleanup.errors.push(diagnostic(captureError)); }
    }
  }
}
async function rejectTransaction(files, config = {}) {
  let error;
  try { await utils.installFileTransaction(files, config); } catch (caught) { error = caught; }
  caseObservations.push({ operation: "installFileTransaction", error: error ? diagnostic(error) : null });
  assert.ok(error, "fault must actually reject the migration");
  return error;
}
async function unchanged(file, value) { assert.equal(await readFile(file, "utf8"), value); }
async function chmodTracked(path, mode) {
  assert.ok(within(path, owned), "permissions may only change inside the uniquely owned scratch");
  permissionRestorations.add(path);
  await chmod(path, mode);
}
async function restoreMode(path) { await chmod(path, 0o700); permissionRestorations.delete(path); }
async function noWorker(f) { assert.equal(await exists(f.workerLog), false, "migration/read must not directly execute the sentinel worker"); }
async function fixture(id) {
  const parent = await caseDirectory(id);
  const root = join(parent, "current");
  const data = join(root, "data");
  await mkdir(join(root, "dist", "server"), { recursive: true });
  await mkdir(data);
  await writeFile(join(root, "package.json"), '{"type":"module"}');
  await writeFile(join(root, "dist", "server", "index.js"), 'export default { fetch() { throw new Error("Offline source fixture: product renderer/provider calls forbidden"); } };');
  for (const name of sourceModules) {
    await copyFile(join(source, name), join(root, name));
    assert.deepEqual(await readFile(join(root, name)), await readFile(join(source, name)), "source fixture must contain exact released module bytes");
  }
  const workerLog = join(root, "offline-worker.jsonl");
  await writeFile(join(root, "reminder-worker.mjs"), `import { appendFile } from 'node:fs/promises'; import { fileURLToPath } from 'node:url'; import { resolve } from 'node:path';
export async function runReminderOnce(){ await appendFile(${JSON.stringify(workerLog)}, JSON.stringify({at:new Date().toISOString(),count:1})+'\\n'); throw new Error('Offline fixture worker must not run during migration'); }
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runReminderOnce();`);
  const productModule = await import(pathToFileURL(join(root, "portable-server.mjs")).href);
  const f = { parent, root, data, module: productModule, file: join(data, "anthropology-canteen-data.json"), workerLog };
  await noWorker(f);
  return f;
}
function settings() {
  return { version: 3, openAlexApiKey: "synthetic-preserved-key", semanticScholarApiKey: "", reminders: {
    enabled: false, installationId: "acceptance-migration-only-identity", credentialRef: "acceptance-migration-only-identity",
    sender: "synthetic@example.test", username: "synthetic@example.test",
  } };
}
function state() { return { version: 2, baselineComplete: true, baselines: {}, items: {}, lastSuccessfulSendAt: "2026-01-01T00:00:00.000Z" }; }
function data(f, id) { return { ...f.module.emptyLocalData(), states: { [id]: { saved: true, read: false, ignored: false } } }; }
async function sourceData(f, id = "old", record = "old-source") {
  const path = join(f.parent, id, "data", "anthropology-canteen-data.json");
  await json(path, data(f, record));
  return path;
}
async function probePermissions() {
  if (process.platform !== "darwin") return "native macOS required; local source smoke is not native evidence";
  if (!process.getuid || process.getuid() === 0) return "ordinary non-root user unavailable";
  const path = await caseDirectory("permission-probe");
  await chmodTracked(path, 0o500);
  try {
    try { await writeFile(join(path, "should-not-write"), "synthetic"); return "mode 0500 does not deny creation for this execution identity"; }
    catch (error) { if (!["EACCES", "EPERM"].includes(error.code)) throw error; }
  } finally { await restoreMode(path); }
  return "";
}
async function processCheck(code, args) {
  const result = await execute(process.execPath, ["--input-type=module", "-e", code, ...args], { timeout: 25000, windowsHide: true });
  return result.stdout.trim();
}

try {
  assert.notEqual(source, scratch);
  assert.equal(within(scratch, source), false, "scratch must not be inside the published source checkout");
  await mkdir(scratch, { recursive: true });
  owned = await mkdtemp(join(scratch, "migration-"));
  const head = (await execute("git", ["-C", source, "rev-parse", "HEAD"])).stdout.trim();
  assert.equal(head, PRODUCT_SHA, "only the immutable release checkout can supply source fixtures");
  await execute("git", ["-C", source, "diff", "--quiet", PRODUCT_SHA, "--", ...sourceModules, "reminder-worker.mjs"]);
  utils = await import(pathToFileURL(join(source, "reminder-utils.mjs")).href);
  report.environment.permissionCondition = await probePermissions();

  for (const stage of ["write", "sync", "close", "backup", "replace"]) {
    await runCase(`B-${stage}-failure`, "source-injection", async () => {
      const directory = await caseDirectory(`B-${stage}-failure`);
      const destination = join(directory, "record.json");
      await writeFile(destination, "original");
      const error = await rejectTransaction([{ destination, bytes: Buffer.from("migrated") }], {
        checkpoint: async (event) => { if (event === stage) throw new Error(`injected-${stage}`); },
      });
      assert.equal(error.recovery, "restored");
      assert.match(error.message, new RegExp(`injected-${stage}`));
      await unchanged(destination, "original");
      assert.deepEqual(await readdir(directory), ["record.json"]);
      return { error: diagnostic(error), originalRetained: true, noResidues: true, noWorkerEntryPointInvoked: true };
    });
  }
  await runCase("B-restoration-incomplete", "source-injection", async () => {
    const f = await fixture("B-restoration-incomplete");
    const first = f.file;
    const second = join(f.data, "anthropology-canteen-settings.json");
    const original = JSON.stringify(data(f, "original"));
    await writeFile(first, original); await json(second, settings());
    const error = await rejectTransaction([
      { destination: first, bytes: Buffer.from(JSON.stringify(data(f, "migrated"))) },
      { destination: second, bytes: Buffer.from('{"version":3}') },
    ], { checkpoint: async (event, index) => { if ((event === "replace" && index === 1) || event === "restore") throw new Error("synthetic recovery fault"); } });
    assert.equal(error.recovery, "incomplete");
    assert.equal((await utils.migrationRecoveryStatus(f.data)).blocked, true);
    const backups = (await readdir(f.data)).filter((name) => name.includes("backup-migration"));
    assert.ok(backups.length >= 2);
    assert.equal(await readFile(join(f.data, backups.find((name) => name.startsWith("anthropology-canteen-data."))), "utf8"), original);
    await assert.rejects(f.module.readLocalDataFile(), { code: "MIGRATION_RECOVERY_REQUIRED" });
    await assert.rejects(utils.writeJsonAtomic(first, {}), { code: "MIGRATION_RECOVERY_REQUIRED" });
    const child = await processCheck(`import assert from 'node:assert/strict'; import { migrationRecoveryStatus, writeJsonAtomic } from ${JSON.stringify(pathToFileURL(join(source, "reminder-utils.mjs")).href)};
assert.equal((await migrationRecoveryStatus(process.argv[1])).blocked,true); await assert.rejects(writeJsonAtomic(process.argv[2],{}), {code:'MIGRATION_RECOVERY_REQUIRED'}); console.log('restart-blocked');`, [f.data, first]);
    assert.equal(child, "restart-blocked");
    const server = f.module.createAnthropologyServer();
    await new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveListen); });
    let status;
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const runtime = await fetch(`${base}/api/runtime-status`).then((r) => r.json());
      status = await fetch(`${base}/api/reminders/status`, { headers: { "x-anthropology-canteen-session": runtime.sessionToken } }).then((r) => r.json());
      assert.equal(status.reminderMigration.reason, "recovery-incomplete");
      assert.equal(status.scheduler.status, "recovery-required");
      assert.equal(status.scheduler.installed, false);
    } finally { await new Promise((resolveClose) => server.close(resolveClose)); }
    await noWorker(f); await capture("B-restoration-incomplete", f.data);
    return { error: diagnostic(error), freshProcessBlocked: true, publicReason: status.reminderMigration.reason, schedulerStatus: status.scheduler.status, backupsRetained: backups, workerCalls: 0 };
  });
  for (const committed of [false, true]) {
    const id = `B-cleanup-${committed ? "committed" : "restored"}`;
    await runCase(id, "source-injection", async () => {
      const directory = await caseDirectory(id); const destination = join(directory, "record.json");
      await writeFile(destination, "original");
      const error = await rejectTransaction([{ destination, bytes: Buffer.from("migrated") }], {
        checkpoint: async (event) => { if (event === "cleanup" || (!committed && event === "replace")) throw new Error("synthetic cleanup fault"); },
      });
      assert.equal(error.recovery, committed ? "committed" : "restored");
      assert.equal(error.cleanupFailed, true);
      assert.equal((await utils.migrationRecoveryStatus(directory)).cleanupPending, true);
      if (committed) assert.match(error.message, /资料已迁移.*清理未完成/);
      await unchanged(destination, committed ? "migrated" : "original");
      await assert.rejects(utils.installFileTransaction([{ destination, bytes: Buffer.from("overwrite") }]), { code: "MIGRATION_CLEANUP_REQUIRED" });
      await capture(id, directory);
      return { error: diagnostic(error), repeatMigrationBlocked: true, evidenceRetained: true, noWorkerEntryPointInvoked: true };
    });
  }
  await runCase("B-newer-target-protected", "source-injection", async () => {
    const directory = await caseDirectory("B-newer-target-protected"); const destination = join(directory, "record.json");
    await writeFile(destination, "new-user-data");
    const error = await rejectTransaction([{ destination, bytes: Buffer.from("old-source"), expectedBytes: null }]);
    assert.match(error.message, /changed/); await unchanged(destination, "new-user-data");
    await writeFile(destination, "original");
    const second = join(directory, "second.json");
    const rollback = await rejectTransaction([{ destination, bytes: Buffer.from("migrated") }, { destination: second, bytes: Buffer.from("other") }], {
      checkpoint: async (event, index) => { if (event === "replace" && index === 1) { await writeFile(destination, "new-user-data"); throw new Error("interrupted after concurrent user write"); } },
    });
    assert.equal(rollback.recovery, "incomplete"); await unchanged(destination, "new-user-data");
    const backup = (await readdir(directory)).find((name) => name.startsWith("record.backup-"));
    await unchanged(join(directory, backup), "original"); await capture("B-newer-target-protected", directory);
    return { preReplacementConflictBlocked: true, rollbackPreservedNewerData: true, originalBackupRetained: true, noWorkerEntryPointInvoked: true };
  });
  await runCase("B-process-interruption", "source-injection", async () => {
    const directory = await caseDirectory("B-process-interruption"); const first = join(directory, "first.json"); const second = join(directory, "second.json");
    await writeFile(first, "original-first"); await writeFile(second, "original-second");
    const signal = join(directory, "checkpoint-ready");
    const code = `import { installFileTransaction } from ${JSON.stringify(pathToFileURL(join(source, "reminder-utils.mjs")).href)};
import { writeFile } from 'node:fs/promises'; await installFileTransaction([{destination:process.argv[1],bytes:Buffer.from('new-first')},{destination:process.argv[2],bytes:Buffer.from('new-second')}],{checkpoint:async(event,index)=>{if(event==='replace'&&index===1){await writeFile(process.argv[3],'ready');await new Promise(()=>{setInterval(()=>{},1000);});}}});`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", code, first, second, signal], { windowsHide: true, stdio: "ignore" });
    children.add(child);
    const ended = new Promise((resolveEnd, reject) => { child.once("error", reject); child.once("close", (exit, signalName) => resolveEnd({ exit, signal: signalName })); });
    for (let attempt = 0; attempt < 100 && !(await exists(signal)); attempt++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(await exists(signal), true, "interruption checkpoint reached");
    assert.equal(child.kill("SIGKILL"), true, "the actual live child must receive interruption"); const exit = await ended; children.delete(child);
    if (process.platform !== "win32") assert.equal(exit.signal, "SIGKILL");
    await unchanged(first, "new-first"); await unchanged(second, "original-second");
    assert.equal((await utils.migrationRecoveryStatus(directory)).blocked, true);
    // Kill leaves the ordinary lock behind. Advance ONLY the synthetic lock's age
    // to exercise the documented >10-minute reclaim without a 10-minute CI sleep.
    const lock = join(directory, ".migration-write.lock"); const stale = new Date(Date.now() - 11 * 60 * 1000);
    await utimes(lock, stale, stale);
    const output = await processCheck(`import assert from 'node:assert/strict'; import { migrationRecoveryStatus, writeJsonAtomic } from ${JSON.stringify(pathToFileURL(join(source, "reminder-utils.mjs")).href)};
assert.equal((await migrationRecoveryStatus(process.argv[1])).blocked,true); await assert.rejects(writeJsonAtomic(process.argv[2],{}),{code:'MIGRATION_RECOVERY_REQUIRED'}); console.log('restart-blocked');`, [directory, first]);
    assert.equal(output, "restart-blocked"); await unchanged(first, "new-first"); await unchanged(second, "original-second");
    const backup = (await readdir(directory)).find((name) => name.startsWith("first.backup-")); await unchanged(join(directory, backup), "original-first");
    await capture("B-process-interruption", directory);
    return { interruption: exit, freshProcessBlocked: true, originalBackupRetained: true, syntheticLockAgeAdvancedMinutes: 11, scope: "real process termination at injected boundary; not machine restart/power loss", noWorkerEntryPointInvoked: true };
  });

  for (const stage of ["write-entry", "backup", "replace", "restore", "cleanup"]) {
    const id = `B-native-${stage}-denied`;
    await runCase(id, "native-filesystem", async () => {
      if (report.environment.permissionCondition) return { pending: report.environment.permissionCondition };
      const directory = await caseDirectory(id); const first = join(directory, "first.json"); const second = join(directory, "second.json");
      await writeFile(first, "old-first"); await writeFile(second, "old-second");
      let error;
      try {
        if (stage === "write-entry") await chmodTracked(directory, 0o500);
        error = await rejectTransaction([{ destination: first, bytes: Buffer.from("new-first") }, { destination: second, bytes: Buffer.from("new-second") }], {
          checkpoint: async (event, index) => {
            if ((stage === "backup" && event === "backup") || (stage === "replace" && event === "replace" && index === 0) ||
                (stage === "restore" && event === "replace" && index === 1) || (stage === "cleanup" && event === "cleanup")) await chmodTracked(directory, 0o500);
          },
        });
      } finally { await restoreMode(directory); }
      if (stage === "write-entry") {
        assert.ok(["EACCES", "EPERM"].includes(error.code));
        assert.equal(await exists(join(directory, ".migration-recovery.json")), false);
        await unchanged(first, "old-first"); await unchanged(second, "old-second");
      } else if (stage === "cleanup") {
        assert.equal(error.recovery, "committed"); assert.equal(error.cleanupFailed, true);
        await unchanged(first, "new-first"); await unchanged(second, "new-second");
        assert.equal((await utils.migrationRecoveryStatus(directory)).cleanupPending, true);
      } else {
        assert.ok(["EACCES", "EPERM"].includes(error.code));
        assert.equal(error.recovery, "incomplete", "permission denial also prevents journaling a successful recovery; do not claim restored");
        await unchanged(first, stage === "restore" ? "new-first" : "old-first"); await unchanged(second, "old-second");
        assert.equal((await utils.migrationRecoveryStatus(directory)).blocked, true);
        if (stage === "restore") {
          const backup = (await readdir(directory)).find((name) => name.startsWith("first.backup-")); await unchanged(join(directory, backup), "old-first");
        }
      }
      await capture(id, directory);
      return { error: diagnostic(error), realPermissionFailure: true, permissionRestoredByHarness: true, boundary: stage, noWorkerEntryPointInvoked: true };
    });
  }
  await runCase("B-protected-existing-companions", "source-injection", async () => {
    const f = await fixture("B-protected-existing-companions"); const old = await sourceData(f); const oldBytes = await readFile(old);
    await json(f.file, f.module.emptyLocalData());
    const protectedFiles = {
      "anthropology-canteen-settings.json": settings(),
      "anthropology-canteen-reminder-state.json": state(),
      "anthropology-canteen-reminder-secret.json": { version: 1, ciphertext: "synthetic-only-never-decrypted" },
    };
    const bytes = new Map();
    for (const [name, value] of Object.entries(protectedFiles)) { await json(join(f.data, name), value); bytes.set(name, await readFile(join(f.data, name))); }
    assert.equal((await f.module.readLocalDataFile()).states["old-source"].saved, true);
    for (const [name, before] of bytes) assert.deepEqual(await readFile(join(f.data, name)), before);
    assert.deepEqual(await readFile(old), oldBytes); await noWorker(f);
    return { oldSourceUnchanged: true, existingSettingsSecretAndSentLedgerUnchanged: true, schemas: [8, 2, 3], workerCalls: 0, keychainNotAccessed: true };
  });
  await runCase("D-parent-denied-current-readable", "native-filesystem", async () => {
    if (report.environment.permissionCondition) return { pending: report.environment.permissionCondition };
    const f = await fixture("D-parent-denied-current-readable"); const bytes = JSON.stringify(data(f, "current"));
    await writeFile(f.file, bytes); await json(join(f.data, "anthropology-canteen-settings.json"), settings());
    let discovery;
    try {
      await chmodTracked(f.parent, 0o100);
      discovery = await f.module.findSiblingMigrationCandidates();
      assert.equal(discovery.reason, "source-scan-failed");
      assert.equal((await f.module.readLocalDataFile()).states.current.saved, true);
      await unchanged(f.file, bytes); await noWorker(f);
    } finally { await restoreMode(f.parent); }
    return { reason: discovery.reason, existingCurrentDataReadableAndUnchanged: true, permissionRestoredByHarness: true, workerCalls: 0 };
  });
  await runCase("D-parent-denied-no-blank", "native-filesystem", async () => {
    if (report.environment.permissionCondition) return { pending: report.environment.permissionCondition };
    const f = await fixture("D-parent-denied-no-blank");
    try {
      await chmodTracked(f.parent, 0o100);
      await assert.rejects(f.module.readLocalDataFile(), (error) => error.code === "MIGRATION_DISCOVERY_FAILED" && /未创建空白资料/.test(error.message));
      assert.equal(await exists(f.file), false); await noWorker(f);
    } finally { await restoreMode(f.parent); }
    return { errorCode: "MIGRATION_DISCOVERY_FAILED", blankNotCreated: true, workerCalls: 0 };
  });
  await runCase("D-scan-candidate-vanishes", "source-injection", async () => {
    const f = await fixture("D-scan-candidate-vanishes"); await sourceData(f);
    const bytes = JSON.stringify(data(f, "current")); await writeFile(f.file, bytes);
    await json(join(f.data, "anthropology-canteen-settings.json"), settings());
    let enumerated = false;
    const scan = () => f.module.findSiblingMigrationCandidates({ readDirectory: async (...args) => {
      const entries = await readdir(...args); enumerated = true;
      const old = join(f.parent, "old"); assert.ok(within(old, owned)); await rm(old, { recursive: true }); return entries;
    } });
    let reason;
    assert.equal((await f.module.readLocalDataFile({ scan: async () => { const result = await scan(); reason = result.reason; return result; } })).states.current.saved, true);
    assert.equal(enumerated, true); assert.equal(reason, "source-scan-incomplete"); await unchanged(f.file, bytes); await noWorker(f);
    return { reason, controlledRealDirectoryRemovalAfterEnumeration: true, currentUnchanged: true, workerCalls: 0 };
  });
  await runCase("D-no-source-then-late-source", "source-injection", async () => {
    const f = await fixture("D-no-source-then-late-source");
    assert.equal((await f.module.findSiblingMigrationCandidates()).reason, "");
    const empty = await f.module.readLocalDataFile(); assert.equal(empty.version, 8); assert.deepEqual(empty.states, {});
    const old = await sourceData(f); const original = await readFile(old);
    assert.equal((await f.module.readLocalDataFile()).states["old-source"].saved, true);
    assert.deepEqual(await readFile(old), original); await noWorker(f);
    return { initialEmptyDiscoverySucceeded: true, laterSourceDiscovered: true, sourceUnchanged: true, workerCalls: 0 };
  });
  await runCase("D-existing-new-data-not-overwritten", "source-injection", async () => {
    const f = await fixture("D-existing-new-data-not-overwritten"); const old = await sourceData(f); const oldBytes = await readFile(old);
    const original = JSON.stringify(data(f, "new-current")); await writeFile(f.file, original);
    assert.equal((await f.module.readLocalDataFile()).states["new-current"].saved, true);
    await unchanged(f.file, original); assert.deepEqual(await readFile(old), oldBytes); await noWorker(f);
    return { currentAndSourceUnchanged: true, workerCalls: 0 };
  });
  await runCase("D-current-unreadable", "native-filesystem", async () => {
    if (report.environment.permissionCondition) return { pending: report.environment.permissionCondition };
    const f = await fixture("D-current-unreadable"); const original = JSON.stringify(data(f, "current")); await writeFile(f.file, original); await sourceData(f);
    try {
      await chmodTracked(f.file, 0o000);
      await assert.rejects(f.module.readLocalDataFile(), (error) => ["EACCES", "EPERM"].includes(error.code));
    } finally { await restoreMode(f.file); }
    await unchanged(f.file, original); await noWorker(f);
    return { unreadableCurrentNotReplacedByOldOrBlank: true, workerCalls: 0 };
  });
  assert.ok(report.cases.length, "--case must match an existing exact case ID");
} catch (error) {
  report.cases.push({ id: "harness-setup-or-unhandled", category: "harness", status: "fail", details: diagnostic(error) });
} finally {
  for (const child of children) {
    try {
      if (child.exitCode === null && child.signalCode === null) {
        const ended = new Promise((done) => child.once("close", done));
        child.kill("SIGKILL");
        await Promise.race([ended, new Promise((_, reject) => setTimeout(() => reject(new Error("child cleanup timed out")), 5000).unref())]);
      }
    } catch (error) { report.cleanup.errors.push(diagnostic(error)); }
  }
  for (const path of permissionRestorations) {
    try { await chmod(path, 0o700); } catch (error) { report.cleanup.errors.push(diagnostic(error)); }
  }
  if (owned) {
    try { assert.ok(within(owned, scratch)); await rm(owned, { recursive: true, force: true }); }
    catch (error) { report.cleanup.errors.push(diagnostic(error)); report.cleanup.retainedScratch = basename(owned); }
  }
  report.cleanup.status = report.cleanup.errors.length ? "fail" : "pass";
  report.cleanup.tasksCreated = 0; report.cleanup.keychainItemsCreated = 0;
  report.cleanup.note = "Intentional synthetic recovery evidence is retained separately; no OS tasks or Keychain items are created by this suite.";
  report.status = report.cases.some((entry) => entry.status === "fail") || report.cleanup.status === "fail" ? "fail" : "pass-with-recorded-limits";
  await mkdir(dirname(reportPath), { recursive: true }); await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ suite: "migration", status: report.status, cases: report.cases.map(({ id, category, status }) => ({ id, category, status })), cleanup: report.cleanup.status }));
  if (report.status === "fail") process.exitCode = 1;
}
