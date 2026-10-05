#!/usr/bin/env node
// Acceptance harness only. Imports the frozen candidate's scheduler module;
// never alters that checkout or a published package. Fault injection is named
// separately from real launchd observations in every case result.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";


const STATES = ["loaded", "unloaded", "disabled", "loaded-disabled"];
const FAULTS = ["none", "marker-write", "settings-write", "post-registration-query", "recovery-obstruction"];
// Unloaded and disabled definitions are rewritten without bootstrap by design.
// Their post-write query and persistence failures remain separate required cases.
const REGISTRATION_STATES = ["loaded", "loaded-disabled", "absent"];
const faultsFor = (state) => [...FAULTS, ...(process.argv.includes("--include-registration-fault") && REGISTRATION_STATES.includes(state) ? ["registration"] : [])];
const CASE_IDS = new Set([
  ...[...STATES, "absent"].flatMap((state) => faultsFor(state).map((fault) => `A-${state}-${fault}`)),
  ...["loaded", "loaded-disabled", "disabled", "unloaded", "absent"].map((state) => `C-${state}`),
  "C-native-plist-read-denied", "C-injected-launchctl-query-failure", "C-native-launchctl-query-denied",
  "scheduler-real-calendar-trigger", "environment-keychain", "C-injected-disabled-output-unknown",
]);
const flags = process.argv.slice(2);
const RELEASE_SHA = flags[flags.indexOf("--product-sha") + 1];
assert.ok(flags.includes("--product-sha") && /^[0-9a-f]{40}$/.test(RELEASE_SHA), "--product-sha requires frozen candidate SHA");
const skipKeychain = flags.includes("--skip-keychain");
const cleanupOnly = flags.includes("--cleanup");
const caseArgument = flags.includes("--case") ? flags[flags.indexOf("--case") + 1] : null;
if (flags.includes("--case") && (!caseArgument || caseArgument.startsWith("--"))) throw new Error("--case requires exact IDs separated by commas");
const selectedCases = caseArgument === null ? null : new Set(caseArgument.split(",").map((id) => id.trim()));
if (selectedCases && [...selectedCases].some((id) => !CASE_IDS.has(id))) throw new Error("Unknown --case ID: " + [...selectedCases].filter((id) => !CASE_IDS.has(id)).join(","));
const selected = (id) => selectedCases === null || selectedCases.has(id);
const argument = (name) => {
  const index = flags.indexOf(name);
  if (index < 0 || !flags[index + 1] || flags[index + 1].startsWith("--")) throw new Error(`Missing ${name}`);
  return resolve(flags[index + 1]);
};
const source = argument("--source");
const scratch = argument("--scratch");
const reportFile = argument("--report");
const manifestFile = join(scratch, "scheduler-owned.json");
const controller = new AbortController();
const report = {
  productSha: RELEASE_SHA,
  requestedCases: selectedCases === null ? "all" : [...selectedCases],
  cases: [],
  environment: { platform: process.platform, architecture: process.arch, node: process.version },
  cleanup: { status: "pending", jobs: [], keychains: [], remainingProcesses: [] },
  commandLog: [],
  overrideObservations: [],
  limitations: [
    "Source-native results exercise the unchanged candidate scheduler with synthetic worker fixtures; they are not candidate-ZIP black-box results.",
    "Native launchctl is used except in explicitly named injected query-failure/unknown-output cases; injected results are not native evidence.",
    "Finder/Gatekeeper, login/logout, sleep/wake, reboot, and real email are outside scope.",
    "launchctl enable may retain a false override entry for an isolated label; macOS has no safe per-label deletion command. Such an enabled entry is reported, not described as a remaining job.",
  ],
};
let manifest = { version: 1, runId: randomUUID(), uid: process.getuid?.(), sourceSha: RELEASE_SHA, jobs: [], keychains: [] };
let scheduler;
let utilities;
let cleaning;
let interrupted = false;

for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => {
  interrupted = true;
  controller.abort(new Error(`Acceptance interrupted by ${signal}`));
});

function inside(path) {
  const part = relative(scratch, resolve(path));
  return part !== "" && !part.startsWith(`..${sep}`) && part !== ".." && !isAbsolute(part);
}
function safeText(value) {
  return String(value || "").replaceAll(scratch, "<scratch>").replaceAll(source, "<release-source>")
    .replace(/\/Users\/[^/\s]+/g, "/Users/<user>").slice(0, 1800);
}
function productError(error, depth = 0) {
  if (!error) return null;
  if (depth > 4) return { message: "nested causes truncated after depth 4" };
  return {
    name: error.name, code: error.code, message: safeText(error.message),
    ...(error.userMessage ? { userMessage: safeText(error.userMessage) } : {}),
    ...(error.cause ? { cause: productError(error.cause, depth + 1) } : {}),
    ...(Array.isArray(error.errors) ? { aggregateCauses: error.errors.slice(0, 8).map((item) => productError(item, depth + 1)) } : {}),
  };
}
function note(id, category, status, details) {
  const item = { id, category, status, details };
  report.cases.push(item);
  console.log(`${status.toUpperCase()} ${id}`);
  return item;
}
async function saveJson(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}
async function saveManifest() { await saveJson(manifestFile, manifest); }
async function run(command, args, { cleanup = false, secret = false, timeout = 20000 } = {}) {
  if (!cleanup && controller.signal.aborted) throw controller.signal.reason;
  const event = { command: basename(command), arguments: secret ? ["<synthetic-keychain-operation>"] : args.map(safeText), at: new Date().toISOString() };
  report.commandLog.push(event);
  return new Promise((resolveRun, rejectRun) => {
    execFile(command, args, { timeout, maxBuffer: 4 * 1024 * 1024, ...(cleanup ? {} : { signal: controller.signal }) }, (error, stdout, stderr) => {
      event.exit = error ? error.code ?? error.signal ?? "error" : 0;
      if (error) {
        const detail = secret ? "Synthetic Keychain command failed" : safeText(stderr || stdout || error.message);
        event.diagnostic = detail;
        const failure = new Error(detail, { cause: error });
        failure.code = error.code;
        failure.signal = error.signal;
        rejectRun(failure);
      } else resolveRun(String(stdout || "").trim());
    });
  });
}
async function exists(file) { try { await lstat(file); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } }
async function optionalBytes(file) { try { return await readFile(file); } catch (error) { if (error.code === "ENOENT") return null; throw error; } }
async function loaded(job, cleanup = false) {
  try { return { loaded: true, text: await run("/bin/launchctl", ["print", `gui/${manifest.uid}/${job.label}`], { cleanup }) }; }
  catch (error) {
    if (/Could not find service|service not found/i.test(error.message)) return { loaded: false, text: "" };
    throw error;
  }
}
async function override(job, cleanup = false) {
  const result = await run("/bin/launchctl", ["print-disabled", `gui/${manifest.uid}`], { cleanup });
  // Keep only this manifest-owned label's lines, never unrelated user jobs.
  const rawLines = result.split(/\r?\n/).filter((line) => line.includes(job.label));
  const observation = { at: new Date().toISOString(), label: job.label, phase: cleanup ? "cleanup" : "acceptance", rawLines };
  report.overrideObservations.push(observation);
  job.overrideObservations ||= [];
  job.overrideObservations.push(observation);
  try {
    const parsed = parseOwnedOverride(result, job.label);
    observation.parsed = parsed;
    return parsed;
  } catch (error) { observation.error = safeText(error.message); throw error; }
}
function parseOwnedOverride(result, ownLabel) {
  assert.match(result, /\{[\s\S]*\}/, "launchd disabled query must return a parseable object");
  const lines = result.split(/\r?\n/).filter((line) => line.includes(ownLabel));
  if (lines.length === 0) return { disabled: false, entry: "absent", rawLine: null };
  assert.equal(lines.length, 1, "owned launchd label has multiple disabled entries");
  const escaped = ownLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = lines[0].match(new RegExp(`^\\s*"${escaped}"\\s*=>\\s*(true|false|enabled|disabled)\\s*[,;]?\\s*$`, "i"));
  assert.ok(match, "owned launchd disabled entry uses an unrecognized format: " + lines[0]);
  const entry = match[1].toLowerCase();
  return { disabled: ["true", "disabled"].includes(entry), entry, rawLine: lines[0] };
}
async function workerRuns(job) {
  let count = 0;
  const entries = [];
  for (const root of [job.oldRoot, job.newRoot]) {
    const bytes = await optionalBytes(join(root, "data", "offline-executions.jsonl"));
    if (!bytes) continue;
    for (const line of bytes.toString().trim().split("\n").filter(Boolean)) {
      const value = JSON.parse(line);
      assert.deepEqual(Object.keys(value).sort(), ["count", "executedAt"]);
      entries.push({ ...value, fixture: root === job.oldRoot ? "old" : "new" });
      count++;
    }
  }
  return { count, entries };
}
async function snapshot(job) {
  const live = await loaded(job);
  const disabled = await override(job);
  const bytes = await optionalBytes(job.plist);
  return { loaded: live.loaded, disabled: disabled.disabled, disabledOracle: disabled, bytes, liveText: live.text };
}
function xml(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
function hourMinute(date) { return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`; }
function safeFutureTime() { return hourMinute(new Date(Date.now() + 12 * 60 * 60 * 1000)); }
function definition(job, root, runAtLoad) {
  const [hour, minute] = job.config.schedule.time.split(":").map(Number);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
<key>Label</key><string>${xml(job.label)}</string>
<key>ProgramArguments</key><array><string>${xml(join(root, "runtime", "bin", "node"))}</string><string>${xml(join(root, "reminder-worker.mjs"))}</string></array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>StartCalendarInterval</key><dict><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>${minute}</integer></dict>
<key>RunAtLoad</key><${runAtLoad}/><key>KeepAlive</key><false/>
<key>StandardOutPath</key><string>${xml(join(root, "data", "worker.stdout"))}</string>
<key>StandardErrorPath</key><string>${xml(join(root, "data", "worker.stderr"))}</string>
</dict></plist>\n`;
}
async function fixture(id, state, { currentRoot = false } = {}) {
  const installationId = `accept${randomBytes(9).toString("hex")}`;
  const label = `org.anthropology-canteen.reminder.${installationId}`;
  const caseRoot = join(scratch, "cases", `${id}-${installationId}`);
  const job = {
    id, label, plist: join(caseRoot, "LaunchAgents", `${label}.plist`),
    oldRoot: join(caseRoot, "old"), newRoot: join(caseRoot, "current"), state,
    config: { version: 1, enabled: true, installationId, schedulerPath: "synthetic-previous-folder", schedule: { time: safeFutureTime() } },
  };
  assert.equal((await loaded(job)).loaded, false, "generated label unexpectedly already exists");
  assert.equal((await override(job)).entry, "absent", "generated label has an existing override");
  // Do not claim ownership if a label already exists. Record confirmed unique
  // ownership durably before any OS mutation, for --cleanup after interruption.
  manifest.jobs.push(job);
  await saveManifest();
  const offlineWorker = `import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const file = fileURLToPath(new URL('./data/offline-executions.jsonl', import.meta.url));
const count = existsSync(file) ? readFileSync(file, 'utf8').trim().split('\\n').filter(Boolean).length + 1 : 1;
appendFileSync(file, JSON.stringify({ executedAt: new Date().toISOString(), count }) + '\\n');\n`;
  for (const root of [job.oldRoot, job.newRoot]) {
    await mkdir(join(root, "data"), { recursive: true });
    await mkdir(join(root, "runtime", "bin"), { recursive: true });
    await symlink(process.execPath, join(root, "runtime", "bin", "node"));
    await writeFile(join(root, "reminder-worker.mjs"), offlineWorker);
  }
  await mkdir(dirname(job.plist), { recursive: true });
  const initialRoot = currentRoot ? job.newRoot : job.oldRoot;
  if (state !== "absent") {
    await writeFile(job.plist, definition(job, initialRoot, "false"), { mode: 0o600 });
    if (["loaded", "loaded-disabled"].includes(state)) await run("/bin/launchctl", ["bootstrap", `gui/${manifest.uid}`, job.plist]);
    await writeFile(job.plist, definition(job, initialRoot, "true"), { mode: 0o600 });
  }
  if (["disabled", "loaded-disabled"].includes(state)) await run("/bin/launchctl", ["disable", `gui/${manifest.uid}/${job.label}`]);
  const settings = { version: 3, openAlexApiKey: "synthetic-not-used", reminders: job.config };
  const marker = { platform: "macos", path: job.oldRoot, installedAt: "2000-01-01T00:00:00.000Z", label };
  await writeFile(join(job.newRoot, "data", "anthropology-canteen-settings.json"), `${JSON.stringify(settings)}\n`);
  await writeFile(join(job.newRoot, "data", "anthropology-canteen-reminder-scheduler.json"), `${JSON.stringify(marker)}\n`);
  await writeFile(join(job.newRoot, "data", "anthropology-canteen-settings.json.backup"), '{ "version": 3, "synthetic": "original settings backup" }\n');
  await writeFile(join(job.newRoot, "data", "anthropology-canteen-reminder-scheduler.json.backup"), '{ "synthetic": "original scheduler backup" }\n');
  job.initial = await snapshot(job);
  job.initialSettings = await readFile(join(job.newRoot, "data", "anthropology-canteen-settings.json"));
  job.initialMarker = await readFile(join(job.newRoot, "data", "anthropology-canteen-reminder-scheduler.json"));
  job.initialSettingsBackup = await readFile(join(job.newRoot, "data", "anthropology-canteen-settings.json.backup"));
  job.initialMarkerBackup = await readFile(join(job.newRoot, "data", "anthropology-canteen-reminder-scheduler.json.backup"));
  assert.equal(job.initial.loaded, ["loaded", "loaded-disabled"].includes(state));
  assert.equal(job.initial.disabled, ["disabled", "loaded-disabled"].includes(state));
  assert.equal((await workerRuns(job)).count, 0, "fixture setup unexpectedly executed worker");
  return job;
}
function schedulerOptions(job, extra = {}) { return { platform: "darwin", uid: String(manifest.uid), plistPath: job.plist, runCommand: run, ...extra }; }
async function assertNoExecution(job) {
  await delay(600, undefined, { signal: controller.signal });
  assert.equal((await workerRuns(job)).count, 0, "update/recovery/status unexpectedly executed offline worker");
}
async function assertRestored(job) {
  const after = await snapshot(job);
  assert.equal(after.loaded, job.initial.loaded, "loaded state not restored");
  assert.equal(after.disabled, job.initial.disabled, "disabled state not restored");
  assert.deepEqual(after.bytes, job.initial.bytes, "original plist bytes not restored");
  if (after.loaded) assert.ok(after.liveText.includes(join(job.oldRoot, "reminder-worker.mjs")), "loaded definition does not reference original worker");
  assert.deepEqual(await readFile(join(job.newRoot, "data", "anthropology-canteen-settings.json")), job.initialSettings);
  assert.deepEqual(await readFile(join(job.newRoot, "data", "anthropology-canteen-reminder-scheduler.json")), job.initialMarker);
  assert.deepEqual(await readFile(join(job.newRoot, "data", "anthropology-canteen-settings.json.backup")), job.initialSettingsBackup);
  assert.deepEqual(await readFile(join(job.newRoot, "data", "anthropology-canteen-reminder-scheduler.json.backup")), job.initialMarkerBackup);
  assert.equal(await exists(join(job.newRoot, "data", ".scheduler-update.json")), false, "completed rollback journal was not cleaned");
  await assertNoExecution(job);
  return { loaded: after.loaded, disabled: after.disabled, exactOriginalPlist: true, exactSettingsAndMarker: true, workerExecutions: 0 };
}
async function caseRun(id, category, action) {
  if (!selected(id)) return;
  if (controller.signal.aborted) throw controller.signal.reason;
  let item;
  try { const details = await action(); item = note(id, category, "pass", details); }
  catch (error) { item = note(id, category, "fail", { error: safeText(error.stack || error) }); }
  const job = manifest.jobs.findLast((entry) => entry.id === id);
  if (job?.productOperation) item.details.productOperation = job.productOperation;
  if (job?.productStatus) item.details.productStatus = job.productStatus;
  if (job?.productPreparedSnapshot) item.details.productPreparedSnapshot = job.productPreparedSnapshot;
  try { item.details.evidence = await saveCaseEvidence(id); }
  catch (error) { item.status = "fail"; item.details.evidenceError = safeText(error.message); }
  await saveJson(reportFile, report);
}
async function saveCaseEvidence(id) {
  const job = manifest.jobs.findLast((entry) => entry.id === id || (id === "scheduler-real-calendar-trigger" && entry.id === "real-calendar-trigger") || (id === "C-injected-launchctl-query-failure" && entry.id === "C-query-failure"));
  if (!job) return "No OS fixture was created.";
  const directory = join(dirname(reportFile), "evidence", "scheduler", id);
  await mkdir(directory, { recursive: true });
  if (job.initial?.bytes) await writeFile(join(directory, "original.plist"), job.initial.bytes);
  const description = { productSha: RELEASE_SHA, case: id, initialState: job.state, ...(job.initial ? { initialLoaded: job.initial.loaded, initialDisabled: job.initial.disabled, initialDisabledOracle: job.initial.disabledOracle } : {}), overrideObservations: job.overrideObservations || [], productStatus: job.productStatus, productOperation: job.productOperation, productPreparedSnapshot: job.productPreparedSnapshot, replay: "Run this harness from its recorded test SHA against the immutable product SHA with --case " + id + "; fixtures always generate fresh unique labels and paths." };
  try {
    const current = await optionalBytes(job.plist);
    if (current) await writeFile(join(directory, "observed.plist"), current);
    description.observedPlist = current ? "file" : "absent";
    description.plistBytesEqualOriginal = job.initial ? current?.equals(job.initial.bytes || Buffer.alloc(0)) ?? job.initial.bytes === null : null;
  } catch (error) { description.observedPlist = error.code === "EISDIR" ? "synthetic obstruction directory" : safeText(error.message); }
  // Explicit allowlist: no Keychain, credential, full fixture or package copy.
  for (const name of [".scheduler-update.json", "anthropology-canteen-settings.json", "anthropology-canteen-settings.json.backup", "anthropology-canteen-reminder-scheduler.json", "anthropology-canteen-reminder-scheduler.json.backup"]) {
    const bytes = await optionalBytes(join(job.newRoot, "data", name));
    if (bytes) await writeFile(join(directory, name === ".scheduler-update.json" ? "recovery-journal.json" : name), bytes);
  }
  description.workerExecutions = await workerRuns(job);
  await saveJson(join(directory, "observation.json"), description);
  return `evidence/scheduler/${id}`;
}
async function cleanupJob(job) {
  assert.match(job.label, /^org\.anthropology-canteen\.reminder\.accept[0-9a-f]{18}$/);
  for (const file of [job.plist, job.oldRoot, job.newRoot]) assert.ok(inside(file), "owned job path outside scratch");
  assert.equal(basename(job.plist), `${job.label}.plist`);
  const result = { id: job.id, label: job.label, status: "pass" };
  try {
    if ((await loaded(job, true)).loaded) await run("/bin/launchctl", ["bootout", `gui/${manifest.uid}/${job.label}`], { cleanup: true });
    const initialOverride = await override(job, true);
    result.initialDisabledOracle = initialOverride;
    if (initialOverride.disabled) await run("/bin/launchctl", ["enable", `gui/${manifest.uid}/${job.label}`], { cleanup: true });
    // Only this manifest-owned plist can be a synthetic obstruction directory.
    await chmod(dirname(job.plist), 0o700).catch(() => {});
    await rm(job.plist, { recursive: true, force: true });
    const remaining = await loaded(job, true);
    const finalOverride = await override(job, true);
    result.loaded = remaining.loaded;
    result.plistExists = await exists(job.plist);
    result.disabled = finalOverride.disabled;
    result.overrideEntry = finalOverride.entry;
    result.finalDisabledOracle = finalOverride;
    result.workerExecutions = await workerRuns(job);
    if (job.id !== "real-calendar-trigger") assert.equal(result.workerExecutions.count, 0, "late unexpected worker execution observed during final cleanup");
    assert.equal(result.loaded, false);
    assert.equal(result.plistExists, false);
    assert.equal(result.disabled, false);
  } catch (error) { result.status = "fail"; result.error = safeText(error.message); }
  return result;
}
async function cleanupAll() {
  if (cleaning) return cleaning;
  cleaning = (async () => {
    if (process.platform !== "darwin") {
      report.cleanup = manifest.jobs.length || manifest.keychains.length
        ? { status: "fail", note: "Recorded macOS resources cannot be cleaned from a non-macOS host." }
        : { status: "pass", note: "No macOS resources were created on this platform." };
      return;
    }
    assert.equal(manifest.uid, process.getuid(), "cleanup will not cross user identity");
    const jobs = [];
    for (const job of manifest.jobs) {
      try { jobs.push(await cleanupJob(job)); }
      catch (error) { jobs.push({ id: job.id, status: "fail", error: safeText(error.message) }); }
    }
    const keychains = [];
    for (const item of manifest.keychains) {
      try {
        assert.ok(inside(item.path));
        assert.match(basename(item.path), /^acceptance-[0-9a-f-]+\.keychain$/);
        if (await exists(item.path) || await exists(`${item.path}-db`)) await run("/usr/bin/security", ["delete-keychain", item.path], { cleanup: true, secret: true });
        const remaining = await exists(item.path) || await exists(`${item.path}-db`);
        assert.equal(remaining, false, "temporary keychain remains");
        keychains.push({ file: basename(item.path), status: "pass", exists: false });
      } catch (error) { keychains.push({ file: basename(item.path), status: "fail", error: safeText(error.message) }); }
    }
    let remainingProcesses = [];
    let processError;
    try {
      const ownedWorkerPaths = manifest.jobs.flatMap((job) => [job.oldRoot, job.newRoot].map((root) => join(root, "reminder-worker.mjs")));
      const findWorkers = async () => {
        const output = await run("/bin/ps", ["-axo", "pid=,command="], { cleanup: true });
        return output.split("\n").flatMap((line) => {
          const match = line.match(/^\s*(\d+)\s+(.*)$/);
          return match && ownedWorkerPaths.some((file) => match[2].includes(file)) ? [{ pid: Number(match[1]), command: safeText(match[2]) }] : [];
        });
      };
      remainingProcesses = await findWorkers();
      for (const worker of remainingProcesses) if (worker.pid !== process.pid) { try { process.kill(worker.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; } }
      if (remainingProcesses.length) await delay(500);
      remainingProcesses = await findWorkers();
    } catch (error) { processError = safeText(error.message); }
    report.cleanup = { status: jobs.some((j) => j.status === "fail") || keychains.some((k) => k.status === "fail") || remainingProcesses.length || processError ? "fail" : "pass", jobs, keychains, remainingProcesses, ...(processError ? { processError } : {}), evidenceRetained: "Synthetic fixture files and recovery journals are retained; only manifest-owned OS jobs, plist files and temporary Keychains are removed." };
  })();
  return cleaning;
}

async function checkKeychain() {
  const path = join(scratch, `acceptance-${randomUUID()}.keychain`);
  const service = `org.anthropology-canteen.acceptance.${randomUUID()}`;
  const account = "synthetic-acceptance-only";
  const password = randomBytes(24).toString("hex");
  const secret = randomBytes(24).toString("hex");
  manifest.keychains.push({ path, service, account });
  await saveManifest();
  let created = false;
  let readVerified = false;
  let primary;
  let searchBefore;
  try {
    searchBefore = await run("/usr/bin/security", ["list-keychains", "-d", "user"], { secret: true });
    await run("/usr/bin/security", ["create-keychain", "-p", password, path], { secret: true });
    created = true;
    await run("/usr/bin/security", ["set-keychain-settings", "-lut", "300", path], { secret: true });
    await run("/usr/bin/security", ["unlock-keychain", "-p", password, path], { secret: true });
    await run("/usr/bin/security", ["add-generic-password", "-a", account, "-s", service, "-w", secret, path], { secret: true });
    assert.equal(await run("/usr/bin/security", ["find-generic-password", "-a", account, "-s", service, "-w", path], { secret: true }), secret);
    readVerified = true;
    await run("/usr/bin/security", ["delete-generic-password", "-a", account, "-s", service, path], { secret: true });
    let missing = false;
    try { await run("/usr/bin/security", ["find-generic-password", "-a", account, "-s", service, "-w", path], { secret: true }); }
    catch (error) { if (error.code === 44) missing = true; else throw error; }
    assert.equal(missing, true, "deleted synthetic Keychain item remains or deletion cannot be verified");
    report.environment.keychain = "available";
  } catch (error) { primary = error; report.environment.keychain = "unavailable"; }
  finally {
    try {
      if (created || await exists(path) || await exists(`${path}-db`)) await run("/usr/bin/security", ["delete-keychain", path], { cleanup: true, secret: true });
      assert.equal(await exists(path) || await exists(`${path}-db`), false);
      if (searchBefore !== undefined) assert.equal(await run("/usr/bin/security", ["list-keychains", "-d", "user"], { cleanup: true, secret: true }), searchBefore, "temporary Keychain operation changed the user's search list");
    } catch (error) { note("environment-keychain-cleanup", "environment-native", "fail", { error: safeText(error.message) }); }
  }
  note("environment-keychain", "environment-native", primary ? readVerified || primary.code === "ERR_ASSERTION" ? "fail" : "pending" : "pass", { temporaryIndependentKeychain: true, personalItemsRead: false, credentialValuesLogged: false, ...(primary ? { reason: safeText(primary.message), syntheticItemReadBeforeFailure: readVerified } : { addReadDeleteVerified: true, originalSearchListPreserved: true }) });
}

async function updateCases() {
  for (const state of [...STATES, "absent"]) {
    for (const fault of faultsFor(state)) {
      const id = `A-${state}-${fault}`;
      await caseRun(id, fault === "none" ? "source-native" : "source-injection-native-observer", async () => {
        const job = await fixture(id, state);
        let printCount = 0;
        let injected = false;
        const options = schedulerOptions(job, {
          runCommand: async (command, args) => {
            if (command === "/bin/launchctl" && !job.productPreparedSnapshot) {
              const journal = JSON.parse(await readFile(join(job.newRoot, "data", ".scheduler-update.json"), "utf8"));
              if (journal.mac) job.productPreparedSnapshot = journal.mac;
            }
            if (command === "/bin/launchctl" && args[0] === "print") {
              printCount++;
              if (fault === "post-registration-query" && printCount === 2) { injected = true; throw new Error("Injected post-registration launchctl query error; all other commands are native"); }
            }
            const output = await run(command, args);
            if (fault === "registration" && !injected && command === "/bin/launchctl" && args[0] === "bootstrap") {
              injected = true;
              throw new Error("Injected registration acknowledgement failure after native bootstrap");
            }
            return output;
          },
          writeMarker: async (file, value) => {
            // Preserve the product's own unnormalized snapshot for comparison
            // with the independent native oracle. Never correct product input.
            job.productPreparedSnapshot = JSON.parse(await readFile(join(job.newRoot, "data", ".scheduler-update.json"), "utf8")).mac;
            await utilities.writeJsonAtomic(file, value);
            if (fault === "marker-write") { injected = true; throw new Error("Injected marker write acknowledgement failure"); }
            if (fault === "recovery-obstruction") {
              injected = true;
              await rm(job.plist);
              await mkdir(job.plist);
              throw new Error("Injected marker failure followed by a real filesystem obstruction at the owned plist");
            }
          },
        });
        let error;
        try {
          await scheduler.withSchedulerTransaction(job.newRoot, job.config, async ({ install }) => {
            await install(job.config);
            await utilities.writeJsonAtomic(join(job.newRoot, "data", "anthropology-canteen-settings.json"), { version: 3, reminders: { ...job.config, schedulerPath: job.newRoot } });
            if (fault === "settings-write") { injected = true; throw new Error("Injected settings write acknowledgement failure"); }
          }, options);
        } catch (failure) { error = failure; }
        job.productOperation = { requestedFault: fault, injected, ...(error ? { error: productError(error) } : { completed: true }) };
        // An earlier native failure may stop the product before our injection
        // point. Record it verbatim, including causes, instead of labelling it
        // only as a harness failure to reach the requested hook.
        job.productStatus = await scheduler.getSchedulerStatus(job.newRoot, job.config, schedulerOptions(job));
        assert.equal(job.productPreparedSnapshot?.disabled, job.initial.disabled, "prepared snapshot must match real disabled state");
        assert.equal(job.productPreparedSnapshot?.loaded, job.initial.loaded, "prepared snapshot must match real loaded state");
        if (fault === "none") {
          assert.equal(error, undefined);
          const after = await snapshot(job);
          assert.equal(after.loaded, ["loaded", "loaded-disabled", "absent"].includes(state));
          assert.equal(after.disabled, job.initial.disabled);
          assert.match(after.bytes.toString(), /<key>RunAtLoad<\/key>\s*<true\s*\/>/);
          assert.ok(after.bytes.toString().includes(xml(job.newRoot)));
          if (after.loaded) assert.ok(after.liveText.includes(join(job.newRoot, "reminder-worker.mjs")));
          await assertNoExecution(job);
          return { loaded: after.loaded, disabled: after.disabled, definitionUpdated: true, workerExecutions: 0 };
        }
        assert.ok(injected && error, "requested fault was not reached");
        if (fault !== "recovery-obstruction") return { ...(await assertRestored(job)), injectedAt: fault, reportedError: safeText(error.userMessage || error.message) };
        assert.equal(error.code, "SCHEDULER_ROLLBACK_FAILED");
        assert.match(error.userMessage || error.message, /恢复未完成/);
        assert.doesNotMatch(error.userMessage || error.message, /没有更改|已恢复/);
        const journalPath = join(job.newRoot, "data", ".scheduler-update.json");
        const journalBytes = await readFile(journalPath);
        const journal = JSON.parse(journalBytes);
        assert.equal(journal.mac.bytes, job.initial.bytes?.toString("base64") ?? null);
        assert.equal(journal.mac.loaded, job.initial.loaded);
        assert.equal(journal.mac.disabled, job.initial.disabled);
        const status = await scheduler.getSchedulerStatus(job.newRoot, job.config, schedulerOptions(job));
        assert.equal(status.status, "recovery-required");
        const beforeRetry = report.commandLog.length;
        await assert.rejects(scheduler.withSchedulerTransaction(job.newRoot, job.config, () => assert.fail("blocked update entered callback"), schedulerOptions(job)), /恢复未完成/);
        assert.equal(report.commandLog.length, beforeRetry, "blocked retry performed an OS command");
        const moduleUrl = pathToFileURL(join(source, "reminder-scheduler.mjs")).href;
        const check = `import assert from 'node:assert/strict'; import {withSchedulerTransaction,getSchedulerStatus} from ${JSON.stringify(moduleUrl)}; const root=process.argv[1]; assert.equal((await getSchedulerStatus(root, {})).status,'recovery-required'); await assert.rejects(withSchedulerTransaction(root,{},()=>assert.fail('must not overwrite')),/恢复未完成/);`;
        await run(process.execPath, ["--input-type=module", "-e", check, job.newRoot]);
        assert.deepEqual(await readFile(journalPath), journalBytes);
        await assertNoExecution(job);
        return { injectedAt: "marker failure plus real plist obstruction", reportedError: safeText(error.userMessage || error.message), recoveryJournalRetained: true, exactOriginalDefinitionInJournal: true, subsequentAndFreshProcessUpdateBlocked: true, workerExecutions: 0, evidenceDirectory: relative(scratch, dirname(dirname(job.plist))) };
      });
    }
  }
}

async function statusCases() {
  for (const [state, expected] of [["loaded", "current"], ["loaded-disabled", "disabled"], ["disabled", "disabled"], ["unloaded", "disabled"], ["absent", "missing"]]) {
    await caseRun(`C-${state}`, "source-native", async () => {
      const job = await fixture(`C-${state}`, state, { currentRoot: true });
      const before = await snapshot(job);
      const status = await scheduler.getSchedulerStatus(job.newRoot, job.config, schedulerOptions(job));
      job.productStatus = status;
      assert.equal(status.status, expected);
      assert.equal(status.installed, expected === "current");
      if (state === "unloaded") assert.ok(status.reasonCodes.includes("job-unloaded"));
      if (["disabled", "loaded-disabled"].includes(state)) assert.ok(status.reasonCodes.includes("job-disabled"));
      const after = await snapshot(job);
      assert.equal(after.loaded, before.loaded);
      assert.equal(after.disabled, before.disabled);
      assert.deepEqual(after.bytes, before.bytes);
      await assertNoExecution(job);
      return { actualStatus: status, queryLeftSystemStateUnchanged: true, workerExecutions: 0 };
    });
  }
  await caseRun("C-native-plist-read-denied", "source-native-system-fault", async () => {
    const job = await fixture("C-native-plist-read-denied", "loaded", { currentRoot: true });
    await chmod(job.plist, 0o000);
    try {
      await assert.rejects(readFile(job.plist), { code: "EACCES" });
      const status = await scheduler.getSchedulerStatus(job.newRoot, job.config, schedulerOptions(job));
      assert.equal(status.status, "unknown");
      assert.equal(status.installed, false);
      assert.equal((await loaded(job)).loaded, true);
      assert.equal((await override(job)).disabled, false);
      await assertNoExecution(job);
      return { actualStatus: status, actualFault: "mode 000 on this owned plist, confirmed EACCES", limitation: "This proves a real plist read denial, not a launchctl domain ACL denial.", taskStillLoaded: true, workerExecutions: 0 };
    } finally { await chmod(job.plist, 0o600); }
  });
  await caseRun("C-injected-launchctl-query-failure", "source-injection-native-observer", async () => {
    const job = await fixture("C-query-failure", "loaded", { currentRoot: true });
    let injected = false;
    const status = await scheduler.getSchedulerStatus(job.newRoot, job.config, schedulerOptions(job, { runCommand: async (command, args) => {
      if (command === "/bin/launchctl" && args[0] === "print") { injected = true; throw new Error("Injected launchctl query failure; not a native permission-denial claim"); }
      return run(command, args);
    } }));
    assert.equal(injected, true);
    assert.equal(status.status, "unknown");
    assert.equal(status.installed, false);
    assert.equal((await loaded(job)).loaded, true);
    assert.equal((await override(job)).disabled, false);
    await assertNoExecution(job);
    return { actualStatus: status, injection: "launchctl print failure only", realTaskUnchanged: true, workerExecutions: 0 };
  });
  await caseRun("C-injected-disabled-output-unknown", "source-injection-native-observer", async () => {
    const job = await fixture("C-injected-disabled-output-unknown", "loaded-disabled", { currentRoot: true });
    const before = await snapshot(job);
    let injected = 0;
    const options = schedulerOptions(job, { runCommand: async (command, args) => {
      if (command === "/bin/launchctl" && args[0] === "print-disabled") {
        injected++;
        return `disabled services = { "${job.label}" => unrecognized }`;
      }
      assert.ok(command !== "/bin/launchctl" || !["enable", "disable", "bootstrap", "bootout"].includes(args[0]), "unknown state must never mutate a task");
      return run(command, args);
    } });
    const status = await scheduler.getSchedulerStatus(job.newRoot, job.config, options);
    assert.equal(status.status, "unknown");
    assert.equal(status.installed, false);
    await assert.rejects(scheduler.installScheduler(job.newRoot, job.config, options), /无法可靠核对/);
    assert.ok(injected >= 2);
    const after = await snapshot(job);
    assert.equal(after.loaded, before.loaded);
    assert.equal(after.disabled, before.disabled);
    assert.deepEqual(after.bytes, before.bytes);
    await assertNoExecution(job);
    return { actualStatus: status, injection: "unknown print-disabled output; real commands otherwise", updateStoppedBeforeMutation: true, realStateUnchanged: true, workerExecutions: 0 };
  });
  if (selected("C-native-launchctl-query-denied")) note("C-native-launchctl-query-denied", "source-native-system-fault", "pending", { reason: "No safe way to deny this user's launchd query to one owned job without changing session permissions. Plist EACCES and explicitly injected query failure are recorded separately." });
}

async function timedCase() {
  await caseRun("scheduler-real-calendar-trigger", "source-native", async () => {
    const job = await fixture("real-calendar-trigger", "absent");
    // At least 45 seconds to allow registration to finish, without waiting a day.
    const target = new Date(Date.now() + 90000);
    target.setSeconds(0, 0);
    if (target.getTime() - Date.now() < 45000) target.setMinutes(target.getMinutes() + 1);
    job.config.schedule.time = hourMinute(target);
    const began = Date.now();
    await scheduler.installScheduler(job.newRoot, job.config, schedulerOptions(job));
    await assertNoExecution(job);
    const deadline = target.getTime() + 45000;
    let execution;
    while (Date.now() < deadline) {
      const observed = await workerRuns(job);
      if (observed.count) { execution = observed; break; }
      await delay(1000, undefined, { signal: controller.signal });
    }
    assert.ok(execution, "real calendar trigger did not execute within 45 seconds after target minute");
    assert.equal(execution.count, 1);
    const when = Date.parse(execution.entries[0].executedAt);
    assert.ok(when >= target.getTime() - 2000, "worker ran before scheduled minute");
    assert.ok(when <= deadline);
    assert.equal(execution.entries[0].fixture, "new");
    await delay(1200, undefined, { signal: controller.signal });
    assert.equal((await workerRuns(job)).count, 1, "trigger executed more than once");
    return { scheduledLocalTime: job.config.schedule.time, scheduledAt: target.toISOString(), observed: execution.entries[0], elapsedSeconds: Math.round((Date.now() - began) / 1000), trigger: "native StartCalendarInterval; no kickstart/start/manual worker invocation", networkCapableWorker: false };
  });
}

async function main() {
  await mkdir(scratch, { recursive: true });
  if (cleanupOnly) {
    if (await exists(manifestFile)) {
      manifest = JSON.parse(await readFile(manifestFile, "utf8"));
      assert.equal(manifest.version, 1);
      assert.equal(manifest.sourceSha, RELEASE_SHA);
      await cleanupAll();
    } else report.cleanup = { status: "pass", note: "No ownership manifest exists; no resources touched." };
    return;
  }
  assert.equal(await exists(manifestFile), false, "scratch was already used; use --cleanup first and a fresh scratch for a new run");
  await saveManifest();
  const actualSha = await run("git", ["-C", source, "rev-parse", "HEAD"]);
  assert.equal(actualSha, RELEASE_SHA, "source checkout does not match frozen candidate");
  await run("git", ["-C", source, "diff", "--exit-code", RELEASE_SHA, "--", "reminder-scheduler.mjs", "reminder-utils.mjs"]);
  report.environment.productSourceSha = actualSha;
  if (process.platform !== "darwin" || typeof process.getuid !== "function" || process.getuid() === 0) {
    report.environment.ordinaryUser = false;
    note("environment-launchd", "environment-native", "pending", { reason: "Native Darwin under a non-root user is required. No scheduler operations attempted." });
    for (const area of ["A-updates-and-rollback", "C-live-status", "scheduler-real-calendar-trigger", "environment-keychain"]) note(area, "source-native", "pending", { reason: "Native ordinary macOS user unavailable" });
    return;
  }
  report.environment.ordinaryUser = true;
  report.environment.uid = process.getuid();
  report.environment.osVersion = await run("/usr/bin/sw_vers", ["-productVersion"]);
  report.environment.osBuild = await run("/usr/bin/sw_vers", ["-buildVersion"]);
  report.environment.machineArchitecture = await run("/usr/bin/uname", ["-m"]);
  if (selected("environment-keychain") && !skipKeychain) await checkKeychain();
  else report.environment.keychain = "not requested in this targeted rerun; prior evidence is not repeated";
  let guiAvailable = false;
  try {
    await run("/bin/launchctl", ["print", `gui/${manifest.uid}`]);
    await run("/bin/launchctl", ["print-disabled", `gui/${manifest.uid}`]);
    guiAvailable = true;
  } catch (error) { report.environment.guiSessionReason = safeText(error.message); }
  report.environment.guiSession = guiAvailable;
  if (!guiAvailable) {
    for (const area of ["A-updates-and-rollback", "C-live-status", "scheduler-real-calendar-trigger"]) note(area, "source-native", "pending", { reason: report.environment.guiSessionReason });
    return;
  }
  scheduler = await import(pathToFileURL(join(source, "reminder-scheduler.mjs")));
  utilities = await import(pathToFileURL(join(source, "reminder-utils.mjs")));
  await updateCases();
  await statusCases();
  await timedCase();
  if (selectedCases) {
    const unreached = [...selectedCases].filter((id) => !report.cases.some((item) => item.id === id));
    assert.deepEqual(unreached, [], "selected cases were not reached");
  }
}

try { await main(); }
catch (error) { note(interrupted ? "harness-interrupted" : "harness-setup", "harness", "fail", { error: safeText(error.stack || error) }); }
finally {
  try { await cleanupAll(); }
  catch (error) { report.cleanup = { status: "fail", error: safeText(error.message), manifest: "scheduler-owned.json retained for --cleanup" }; }
  report.finishedAt = new Date().toISOString();
  report.summary = Object.fromEntries(["pass", "fail", "pending"].map((status) => [status, report.cases.filter((item) => item.status === status).length]));
  await saveJson(reportFile, report);
  process.exitCode = report.summary.fail || report.cleanup.status === "fail" ? 1 : 0;
}
