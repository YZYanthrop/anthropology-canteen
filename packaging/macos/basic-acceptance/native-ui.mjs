// Real native task -> unchanged candidate API -> unchanged compiled page.
// The task's external offline payload deliberately makes definitionValid=false.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
const execute = promisify(execFile);
const CASE_ID = "C-native-api-ui-disabled";
const CATEGORY = "candidate-native-api-ui";

export function offlineWorkerSource(log) {
  return [
    "import {appendFileSync,existsSync,readFileSync} from 'node:fs';",
    `const file = ${JSON.stringify(log)};`,
    "const count = existsSync(file) ? readFileSync(file,'utf8').trim().split(String.fromCharCode(10)).filter(Boolean).length + 1 : 1;",
    "appendFileSync(file,JSON.stringify({executedAt:new Date().toISOString(),count})+String.fromCharCode(10));",
    "",
  ].join(String.fromCharCode(10));
}

export function parseDisabledState(text, label) {
  assert.match(text.trim(), /^(?:disabled services\s*=\s*)?\{[\s\S]*\}$/);
  const lines = text.split(/\r?\n/).filter((line) => line.includes(`"${label}"`));
  if (!lines.length) return { disabled: false, entry: "absent", rawLine: null };
  assert.equal(lines.length, 1, "ambiguous override rows");
  assert.equal(text.split(`"${label}"`).length - 1, 1, "duplicate override entries");
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = lines[0].match(new RegExp(`"${escaped}"\\s*=>\\s*(enabled|disabled|true|false)(?=\\s|$|})`));
  assert.ok(match, "unknown override value");
  return { disabled: ["disabled", "true"].includes(match[1]), entry: match[1], rawLine: lines[0] };
}

export function classifyBrowserRequest(url, method, base) {
  if (method !== "GET") return "block-write";
  const actual = new URL(url), local = new URL(base);
  if (actual.origin === local.origin && !actual.username && !actual.password) return "allow-real-read";
  if (actual.protocol === "https:" && local.hostname === "127.0.0.1" && actual.hostname === local.hostname && actual.port === local.port && !actual.username && !actual.password && actual.pathname === "/favicon.svg") return "block-loopback-https-favicon";
  return "block-other-origin";
}

export function validateOwnedManifest(m, { scratch, home, uid, sourceSHA }) {
  // Manifests are durable ownership evidence, not permission to delete arbitrary paths.
  const p = path.posix;
  const normalize = (s) => String(s).replaceAll("\\", "/");
  scratch = normalize(scratch); home = normalize(home);
  assert.equal(m.version, 1); assert.equal(m.kind, "basic-native-ui");
  assert.equal(m.uid, uid); assert.ok(uid > 0); assert.equal(m.sourceSHA, sourceSHA);
  assert.equal(normalize(m.scratch), scratch);
  assert.equal(p.dirname(normalize(m.workRoot)), scratch);
  assert.match(p.basename(m.workRoot), /^native-ui-[a-zA-Z0-9]+$/);
  assert.match(m.installationId, /^nativeui[a-f0-9]{16}$/);
  assert.equal(m.label, `org.anthropology-canteen.reminder.${m.installationId}`);
  assert.match(m.credentialRef, /^native-ui-[a-f0-9-]{36}$/);
  assert.equal(normalize(m.productRoot), `${normalize(m.workRoot)}/candidate-product`);
  assert.equal(normalize(m.worker), `${normalize(m.workRoot)}/offline-worker.mjs`);
  assert.equal(normalize(m.executionLog), `${normalize(m.workRoot)}/offline-executions.jsonl`);
  assert.equal(normalize(m.plist), `${home}/Library/LaunchAgents/${m.label}.plist`);
  for (const process of m.processes) {
    assert.ok(Number.isSafeInteger(process.pid) && process.pid > 1);
    assert.ok(["server", "browser"].includes(process.kind));
    assert.equal(normalize(process.needle), process.kind === "server" ? `${normalize(m.productRoot)}/portable-server.mjs` : `${normalize(m.workRoot)}/browser-profile`);
  }
  return m;
}

// Browser/server shutdown is asynchronous. A disappearing command signature
// is not permission to kill another process; wait read-only for the owned PID
// to disappear, and still reject any persistent identity mismatch.
export async function awaitOwnedCommand(pid, needle, inspect, pause = delay) {
  assert.ok(Number.isSafeInteger(pid) && pid > 1);
  assert.ok(typeof needle === "string" && needle.length > 0);
  for (let attempt = 0; attempt < 40; attempt++) {
    const command = await inspect(pid);
    if (!command || command.includes(needle)) return command;
    if (attempt < 39) await pause(100);
  }
  throw new Error(`Process identity differs for PID ${pid}; refusing termination`);
}

async function exists(file) { try { await access(file); return true; } catch (e) { if (e.code === "ENOENT") return false; throw e; } }
async function run(command, args) { return (await execute(command, args, { timeout: 15000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim(); }
async function jobLoaded(m) { try { await run("/bin/launchctl", ["print", `gui/${m.uid}/${m.label}`]); return true; } catch (e) { if (/Could not find service|service not found/i.test(e.stderr || e.message)) return false; throw e; } }
async function disabledState(m) { return parseDisabledState(await run("/bin/launchctl", ["print-disabled", `gui/${m.uid}`]), m.label); }
async function reservePort() { const server = createServer(); await new Promise((yes, no) => { server.once("error", no); server.listen(0, "127.0.0.1", yes); }); const port = server.address().port; await new Promise((yes, no) => server.close((e) => e ? no(e) : yes())); return port; }
const xml = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
async function hashes(root, relative = "") {
  const values = {};
  for (const item of await readdir(path.join(root, relative), { withFileTypes: true })) {
    if (!relative && item.name === "data") continue;
    const name = path.join(relative, item.name);
    if (item.isDirectory()) Object.assign(values, await hashes(root, name));
    else { assert.ok(item.isFile(), "candidate must not contain symlinks"); values[name] = createHash("sha256").update(await readFile(path.join(root, name))).digest("hex"); }
  }
  return values;
}

async function main() {
  const flags = process.argv.slice(2), cleanupOnly = flags.includes("--cleanup");
  const arg = (name) => { const index = flags.indexOf(name); assert.ok(index >= 0 && flags[index + 1], `Missing ${name}`); return flags[index + 1]; };
  const sourceSHA = arg("--product-sha"); assert.match(sourceSHA, /^[0-9a-f]{40}$/);
  const scratch = path.resolve(arg("--scratch")), reportFile = path.resolve(arg("--report"));
  const manifestFile = path.join(scratch, "native-ui-owned.json");
  const report = { productSHA: sourceSHA, category: CATEGORY, cases: [], environment: { platform: process.platform, arch: process.arch, node: process.version, uid: process.getuid?.() }, cleanup: {}, scope: "Real native loaded+disabled task and real candidate API/UI; external offline task payload means definitionValid=false. No native current/mail integration claim." };
  let manifest, browserContext, server, logStream;
  const saveManifest = async () => writeFile(manifestFile, JSON.stringify(manifest, null, 2));
  const opts = { scratch, home: os.homedir(), uid: process.getuid?.(), sourceSHA };
  async function processCommand(pid) { try { return await run("/bin/ps", ["-p", String(pid), "-o", "command="]); } catch (e) { if (e.code === 1) return ""; throw e; } }
  async function recordBrowsers() {
    if (!manifest) return;
    const needle = path.join(manifest.workRoot, "browser-profile");
    const processes = await run("/bin/ps", ["-axo", "pid=,command="]);
    for (const line of processes.split("\n")) {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      if (match && match[2].includes(`--user-data-dir=${needle}`) && !manifest.processes.some((p) => p.pid === Number(match[1]))) manifest.processes.push({ kind: "browser", pid: Number(match[1]), needle });
    }
    await saveManifest();
  }
  async function cleanup() {
    if (!manifest) { report.cleanup = { status: "pass", note: "No owned resources" }; return; }
    validateOwnedManifest(manifest, opts);
    const errors = [];
    try { await recordBrowsers(); } catch (e) { errors.push(e.message); }
    if (browserContext) await browserContext.close().catch((e) => errors.push(e.message));
    if (server?.exitCode === null) server.kill("SIGTERM");
    for (const owned of manifest.processes) {
      try {
        let command = await awaitOwnedCommand(owned.pid, owned.needle, processCommand);
        if (command) {
          assert.ok(command.includes(owned.needle), "PID was reused: refusing termination");
          process.kill(owned.pid, "SIGTERM");
          for (let n = 0; n < 40 && command; n++) { await delay(100); command = await processCommand(owned.pid); }
          if (command) { assert.ok(command.includes(owned.needle)); process.kill(owned.pid, "SIGKILL"); await delay(200); }
          assert.equal(await processCommand(owned.pid), "", "owned process remains");
        }
      } catch (e) { if (e.code !== "ESRCH") errors.push(e.message); }
    }
    try {
      if (await jobLoaded(manifest)) await run("/bin/launchctl", ["bootout", `gui/${manifest.uid}/${manifest.label}`]);
      if ((await disabledState(manifest)).disabled) await run("/bin/launchctl", ["enable", `gui/${manifest.uid}/${manifest.label}`]);
      await rm(manifest.plist, { force: true });
      assert.equal(await jobLoaded(manifest), false); assert.equal(await exists(manifest.plist), false);
      report.cleanup.override = await disabledState(manifest);
      assert.equal(report.cleanup.override.disabled, false);
      const executions = await exists(manifest.executionLog) ? (await readFile(manifest.executionLog, "utf8")).trim() : "";
      report.cleanup.workerExecutions = executions ? executions.split("\n").length : 0;
      assert.equal(report.cleanup.workerExecutions, 0, "unexpected offline worker execution");
    } catch (e) { errors.push(e.message); }
    if (logStream) await new Promise((done) => logStream.end(done));
    report.cleanup = { ...report.cleanup, status: errors.length ? "fail" : "pass", errors, tasksAndPlistRemoved: !errors.length, processes: manifest.processes.map(({ kind, pid }) => ({ kind, pid })), credentials: "No Keychain item created; only random nonexistent test identity queried", syntheticEvidence: "retained in owned scratch; report/screenshot/log uploaded, no candidate copy uploaded" };
    if (errors.length) report.cases.push({ id: "native-ui.cleanup-error", category: CATEGORY, status: "fail", details: errors });
  }
  let interrupted = false;
  const signal = () => { interrupted = true; if (server) server.kill("SIGTERM"); if (browserContext) browserContext.close().catch(() => undefined); };
  process.on("SIGTERM", signal); process.on("SIGINT", signal);
  try {
    await mkdir(path.dirname(reportFile), { recursive: true });
    if (cleanupOnly) {
      if (await exists(manifestFile)) manifest = validateOwnedManifest(JSON.parse(await readFile(manifestFile, "utf8")), opts);
      return;
    }
    if (process.platform !== "darwin" || !(process.getuid?.() > 0)) { report.cases.push({ id: CASE_ID, category: CATEGORY, status: "pending", details: "Ordinary native macOS user required" }); return; }
    assert.equal(await exists(manifestFile), false, "fresh native UI scratch required");
    await run("/bin/launchctl", ["print", `gui/${process.getuid()}`]);
    const packageRoot = await realpath(arg("--package"));
    assert.equal(await exists(path.join(packageRoot, "data")), false);
    const meta = JSON.parse(await readFile(path.join(packageRoot, "candidate.json"), "utf8"));
    assert.equal(meta.version, "1.3.4"); assert.equal(meta.sourceCommit, sourceSHA); assert.equal(meta.arch, process.arch); assert.equal(meta.status, "unpublished-candidate");
    await mkdir(scratch, { recursive: true });
    const workRoot = await mkdtemp(path.join(scratch, "native-ui-"));
    const installationId = "nativeui" + randomBytes(8).toString("hex");
    const label = `org.anthropology-canteen.reminder.${installationId}`;
    const proposed = { version: 1, kind: "basic-native-ui", sourceSHA, uid: process.getuid(), scratch, workRoot, installationId, label, credentialRef: "native-ui-" + randomUUID(), productRoot: path.join(workRoot, "candidate-product"), worker: path.join(workRoot, "offline-worker.mjs"), executionLog: path.join(workRoot, "offline-executions.jsonl"), plist: path.join(os.homedir(), "Library/LaunchAgents", label + ".plist"), processes: [] };
    validateOwnedManifest(proposed, opts);
    assert.equal(await exists(proposed.plist), false); assert.equal(await jobLoaded(proposed), false); assert.equal((await disabledState(proposed)).entry, "absent");
    // Ownership is committed only after absence checks, before any task mutation.
    manifest = proposed;
    await saveManifest();
    await cp(packageRoot, manifest.productRoot, { recursive: true, force: false, errorOnExist: true });
    const beforeHashes = await hashes(packageRoot);
    assert.deepEqual(await hashes(manifest.productRoot), beforeHashes);
    const node = path.join(manifest.productRoot, "runtime/bin/node");
    await writeFile(manifest.worker, offlineWorkerSource(manifest.executionLog));
    await run(node, ["--check", manifest.worker]);
    const target = new Date(Date.now() + 12 * 3600000), hour = target.getHours(), minute = target.getMinutes();
    const config = { enabled: true, installationId, credentialRef: manifest.credentialRef, provider: "custom", sender: "sender@example.invalid", recipient: "reader@example.invalid", host: "smtp.example.invalid", username: "sender@example.invalid", port: 465, security: "tls", schedule: { cadence: "daily", time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` }, schedulerPath: manifest.productRoot };
    const dataDir = path.join(manifest.productRoot, "data"); await mkdir(dataDir);
    const data = { version: 8, revision: 0, subscriptions: { scholar: [], journal: [], keyword: [] }, states: {}, articleArchive: {}, translations: {}, scholarProfiles: {}, feed: { items: [], scholars: [], updatedAt: new Date().toISOString(), source: "live", warnings: [], coverage: [] } };
    await writeFile(path.join(dataDir, "anthropology-canteen-data.json"), JSON.stringify(data));
    await writeFile(path.join(dataDir, "anthropology-canteen-settings.json"), JSON.stringify({ version: 3, reminders: config }));
    await writeFile(path.join(dataDir, "anthropology-canteen-reminder-state.json"), JSON.stringify({ version: 2, items: {}, baselines: {}, baselineComplete: false }));
    const helper = path.join(manifest.productRoot, "tools/anthropology-canteen-keychain");
    await assert.rejects(execute(helper, ["get", "org.anthropology-canteen.smtp", manifest.credentialRef], { timeout: 15000 }), (e) => /Keychain operation failed:\s*-25300\b/.test(e.stderr || e.message), "synthetic credential identity must be absent");
    await mkdir(path.dirname(manifest.plist), { recursive: true });
    await writeFile(manifest.plist, `<?xml version="1.0"?><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(manifest.worker)}</string></array><key>WorkingDirectory</key><string>${xml(manifest.productRoot)}</string><key>StartCalendarInterval</key><dict><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>${minute}</integer></dict><key>RunAtLoad</key><false/><key>KeepAlive</key><false/></dict></plist>`);
    await run("/bin/launchctl", ["bootstrap", `gui/${manifest.uid}`, manifest.plist]);
    await run("/bin/launchctl", ["disable", `gui/${manifest.uid}/${label}`]);
    assert.equal(await jobLoaded(manifest), true); const beforeOS = await disabledState(manifest); assert.equal(beforeOS.disabled, true);
    const base = `http://127.0.0.1:${await reservePort()}`;
    const env = { ...process.env, PORT: new URL(base).port }; for (const k of ["NODE_OPTIONS", "OPENALEX_API_KEY", "SEMANTIC_SCHOLAR_API_KEY"]) delete env[k];
    logStream = createWriteStream(path.join(path.dirname(reportFile), "native-ui-server.log"));
    server = spawn(node, [path.join(manifest.productRoot, "portable-server.mjs")], { cwd: manifest.productRoot, env, stdio: ["ignore", "pipe", "pipe"] });
    server.stdout.pipe(logStream, { end: false }); server.stderr.pipe(logStream, { end: false });
    await new Promise((yes, no) => { server.once("spawn", yes); server.once("error", no); });
    manifest.processes.push({ kind: "server", pid: server.pid, needle: path.join(manifest.productRoot, "portable-server.mjs") }); await saveManifest();
    let token;
    for (let n = 0; n < 100; n++) { assert.ok(!interrupted); assert.equal(server.exitCode, null); try { const v = await (await fetch(base + "/api/runtime-status", { signal: AbortSignal.timeout(1000) })).json(); token = v.sessionToken; if (token) break; } catch { /* readiness retry */ } await delay(200); }
    assert.ok(token, "candidate server readiness");
    const api = await (await fetch(base + "/api/reminders/status", { headers: { "X-Anthropology-Canteen-Session": token } })).json();
    assert.equal(api.scheduler.status, "disabled"); assert.equal(api.scheduler.installed, false); assert.equal(api.scheduler.definitionValid, false); assert.ok(api.scheduler.reasonCodes.includes("job-disabled")); assert.equal(api.credentialStatus, "missing");
    const { chromium } = await import(process.env.ACCEPTANCE_PLAYWRIGHT_MODULE ? pathToFileURL(path.resolve(process.env.ACCEPTANCE_PLAYWRIGHT_MODULE)).href : "playwright-core");
    browserContext = await chromium.launchPersistentContext(path.join(workRoot, "browser-profile"), { executablePath: process.env.ACCEPTANCE_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, viewport: { width: 1440, height: 1000 }, serviceWorkers: "block", args: ["--disable-background-networking", "--disable-component-update", "--no-first-run"] });
    await recordBrowsers();
    const page = await browserContext.newPage(); page.setDefaultTimeout(15000);
    const blocked = [], observed = [], pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    page.on("response", async (response) => { if (response.url() === base + "/api/reminders/status") { try { const body = await response.json(); observed.push({ scheduler: body.scheduler, credentialStatus: body.credentialStatus }); } catch { /* asserted below */ } } });
    await browserContext.route("**/*", async (route) => {
      const req = route.request(), kind = classifyBrowserRequest(req.url(), req.method(), base), url = new URL(req.url());
      if (kind !== "allow-real-read") { blocked.push({ kind, path: url.pathname }); await route.abort("blockedbyclient"); return; }
      if (url.pathname.startsWith("/api/") && !["/api/runtime-status", "/api/local-data", "/api/local-settings", "/api/reminders/status", "/api/browser-session"].includes(url.pathname)) { blocked.push({ kind: "block-unexpected-api", path: url.pathname }); await route.abort("blockedbyclient"); return; }
      await route.continue();
    });
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "邮件提醒", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "邮件提醒设置" });
    await dialog.getByText("后台提醒已停用", { exact: true }).waitFor({ state: "visible" });
    const button = dialog.getByRole("button", { name: "重新开启后台提醒", exact: true }); await button.waitFor({ state: "visible" });
    assert.equal(await button.isDisabled(), true, "synthetic identity has no credential or test-email verification");
    assert.equal(await dialog.getByText("邮件提醒正在运行", { exact: true }).count(), 0);
    assert.equal(await dialog.getByRole("button", { name: "立即检查一次", exact: true }).count(), 0);
    assert.ok(observed.length); assert.ok(observed.every((v) => v.scheduler.status === "disabled" && v.scheduler.reasonCodes.includes("job-disabled") && v.credentialStatus === "missing"));
    assert.deepEqual(blocked.filter((r) => r.kind !== "block-loopback-https-favicon"), []); assert.deepEqual(pageErrors, []);
    assert.equal(await jobLoaded(manifest), true); assert.equal((await disabledState(manifest)).disabled, true); assert.equal(await exists(manifest.executionLog), false);
    assert.deepEqual(await hashes(manifest.productRoot), beforeHashes, "candidate code changed");
    await page.screenshot({ path: path.join(path.dirname(reportFile), "C-native-api-ui-disabled.png"), fullPage: true });
    report.cases.push({ id: CASE_ID, category: CATEGORY, status: "pass", details: { realNativeState: { loaded: true, disabled: beforeOS }, realAPI: { scheduler: api.scheduler, credentialStatus: api.credentialStatus }, realPageResponses: observed, title: "后台提醒已停用", reenableButtonDisabled: true, definitionValid: false, reason: "External offline task payload; no code replacement in candidate", blocked, workerExecutions: 0, candidateFilesUnchanged: true } });
  } catch (e) {
    report.cases.push({ id: CASE_ID, category: CATEGORY, status: "fail", details: { error: e.stack || e.message } });
    if (browserContext) await browserContext.pages().at(-1)?.screenshot({ path: path.join(path.dirname(reportFile), "native-ui-failure.png"), fullPage: true }).catch(() => undefined);
  } finally {
    try { await cleanup(); } catch (e) { report.cleanup = { status: "fail", error: e.stack || e.message }; }
    process.off("SIGTERM", signal); process.off("SIGINT", signal);
    await mkdir(path.dirname(reportFile), { recursive: true }); await writeFile(reportFile, JSON.stringify(report, null, 2) + "\n");
    process.exitCode = report.cleanup.status === "fail" || report.cases.some((c) => c.status === "fail") ? 1 : 0;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
