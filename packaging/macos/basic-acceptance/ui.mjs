// Compiled, unmodified release UI with synthetic status responses. This is NOT
// a native scheduler/UI end-to-end test. Every browser API request is intercepted.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";


const CATEGORY = "candidate-ui-synthetic-status";
const scenarios = [
  { id: "C-ui-current", status: "current", title: "邮件提醒正在运行", buttons: ["立即检查一次", "停用提醒"], active: true },
  { id: "C-ui-disabled", status: "disabled", reasons: ["job-disabled"], title: "后台提醒已停用", buttons: ["重新开启后台提醒"] },
  { id: "C-ui-unloaded", status: "disabled", reasons: ["job-unloaded"], title: "后台提醒已停用", buttons: ["重新开启后台提醒"] },
  { id: "C-ui-missing", status: "missing", title: "后台提醒任务不存在", buttons: ["重新创建后台提醒"] },
  { id: "C-ui-query-failed", status: "unknown", title: "无法核对后台提醒", buttons: ["重新核对后台提醒"], retryFailure: true },
  { id: "C-ui-stale", status: "stale", title: "后台提醒需要更新", buttons: ["更新后台提醒到当前文件夹"] },
  { id: "C-ui-recovery-required", status: "recovery-required", title: "后台提醒恢复未完成", buttons: ["更新后台提醒到当前文件夹"], disabled: true },
];

function argsFrom(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    assert.ok(["--package", "--scratch", "--report", "--chrome", "--case", "--product-sha"].includes(argv[index]), `Unknown argument: ${argv[index]}`);
    assert.ok(argv[index + 1], `Missing value: ${argv[index]}`);
    args[argv[index].slice(2)] = argv[index + 1];
  }
  for (const required of ["package", "scratch", "report", "product-sha"]) assert.ok(args[required], `Required --${required}`);
  if (args.case) assert.ok(scenarios.some(({ id }) => id === args.case), `Unknown --case: ${args.case}`);
  return args;
}

const args = argsFrom(process.argv.slice(2));
const PRODUCT_SHA = args["product-sha"];
assert.match(PRODUCT_SHA, /^[0-9a-f]{40}$/);
const selectedScenarios = args.case ? scenarios.filter(({ id }) => id === args.case) : scenarios;
const reportPath = path.resolve(args.report);
const report = {
  productSHA: PRODUCT_SHA,
  category: CATEGORY,
  scope: "Unmodified compiled candidate UI; API status/configuration/data are synthetic. No claim of native system-to-UI integration.",
  selectedCases: selectedScenarios.map(({ id }) => id),
  cases: [],
  environment: { platform: process.platform, arch: process.arch, osRelease: os.release(), node: process.version },
  cleanup: { browser: "not-started", server: "not-started", temporaryPackage: "not-created", keychainAndLaunchd: "not-used" },
};
let browser;
let child;
let productRoot;
let workRoot;
let logStream;
let serverExit;
let stopping;
let interruption;
const interrupted = () => {
  interruption = new Error("Acceptance interrupted; owned resources will be cleaned up");
  if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  // Closing the owned browser rejects a pending action and returns control to
  // the surrounding try/finally; throwing from an OS signal handler would not.
  if (browser) void browser.close().catch(() => undefined);
};
process.once("SIGINT", interrupted);
process.once("SIGTERM", interrupted);

async function exists(filename) {
  try { await access(filename); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

function syntheticData() {
  // A newly isolated browser context has no legacy browser data. A fresh feed
  // deliberately takes the boot cache path, so normal startup needs no PUT,
  // PATCH, feed POST, provider lookup, or other background write in this fixture.
  return {
    version: 8, revision: 0,
    subscriptions: { scholar: [], journal: [], keyword: [] }, states: {}, articleArchive: {}, translations: {}, scholarProfiles: {},
    feed: { items: [], scholars: [], updatedAt: new Date().toISOString(), source: "live", warnings: [], coverage: [] },
  };
}

function syntheticStatus(scenario) {
  return {
    version: 1, platform: "darwin", sessionToken: "synthetic-ui-session",
    config: {
      enabled: true, provider: "custom", sender: "sender@example.invalid", recipient: "reader@example.invalid",
      host: "smtp.example.invalid", port: 465, security: "tls", username: "sender@example.invalid", format: "concise",
      schedule: { cadence: "daily", time: "08:00", weekday: 1, monthDay: 1 },
    },
    credentialConfigured: true, credentialStatus: "configured", tested: true,
    scheduler: {
      installed: scenario.status === "current", status: scenario.status,
      needsMigration: ["stale", "recovery-required"].includes(scenario.status), stalePath: "",
      ambiguousTaskCount: 0, ambiguousTaskIds: [], reasonCodes: scenario.reasons || [],
    },
    state: { version: 2 },
  };
}

async function reservePort() {
  const socket = createServer();
  await new Promise((resolve, reject) => { socket.once("error", reject); socket.listen(0, "127.0.0.1", resolve); });
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function eventually(check, message) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(50);
  }
  assert.fail(message);
}

async function visible(locator) {
  await locator.waitFor({ state: "visible" });
}

async function buttonState(button, disabled) {
  await visible(button);
  await eventually(async () => await button.isDisabled() === disabled, `Button did not reach disabled=${disabled}`);
  return button.isDisabled();
}

async function waitForServer(baseUrl) {
  for (let attempt = 0; attempt < 120; attempt++) {
    assert.equal(serverExit, undefined, `Candidate server exited before readiness: ${JSON.stringify(serverExit)}`);
    try {
      const response = await fetch(`${baseUrl}/api/runtime-status`, { signal: AbortSignal.timeout(1000) });
      const value = await response.json();
      assert.equal(value.app, "anthropology-canteen");
      return;
    } catch { await delay(250); }
  }
  throw new Error("Candidate server readiness timed out");
}

async function stopServer() {
  if (!child) return;
  if (child.exitCode === null && child.signalCode === null && !serverExit?.error) {
    child.kill("SIGTERM");
    for (let attempt = 0; attempt < 100 && child.exitCode === null && child.signalCode === null; attempt++) await delay(100);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      for (let attempt = 0; attempt < 50 && child.exitCode === null && child.signalCode === null; attempt++) await delay(100);
    }
    assert.ok(child.exitCode !== null || child.signalCode !== null, "Server process remained after SIGKILL");
  }
  report.cleanup.server = "stopped";
  report.cleanup.serverPID = child.pid;
  report.cleanup.serverExit = serverExit;
  if (logStream) await new Promise((resolve) => logStream.end(resolve));
}

async function cleanup() {
  if (stopping) return stopping;
  stopping = (async () => {
    if (browser) {
      try { await browser.close(); report.cleanup.browser = "closed"; }
      catch (error) { report.cleanup.browser = "failed"; report.cases.push({ id: "UI-browser-cleanup", category: CATEGORY, status: "fail", details: error.message }); }
    }
    try { await stopServer(); }
    catch (error) { report.cleanup.server = "failed"; report.cases.push({ id: "UI-server-cleanup", category: CATEGORY, status: "fail", details: error.message }); }
    if (workRoot) {
      if (report.cases.some((entry) => entry.status === "fail")) {
        report.cleanup.temporaryPackage = "retained-synthetic-evidence";
        report.cleanup.evidencePath = workRoot;
      } else {
        try {
          // mkdtemp supplied this exact owned child; do not recursively remove --scratch.
          assert.equal(path.dirname(workRoot), await realpath(args.scratch));
          assert.ok(path.basename(workRoot).startsWith("ui-acceptance-"));
          await rm(workRoot, { recursive: true, force: false });
          report.cleanup.temporaryPackage = "removed";
        } catch (error) {
          report.cleanup.temporaryPackage = "failed";
          report.cases.push({ id: "UI-files-cleanup", category: CATEGORY, status: "fail", details: error.message });
        }
      }
    }
  })();
  return stopping;
}

async function exercise(scenario, baseUrl) {
  const localOrigin = new URL(baseUrl);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const requests = [];
  const blockedExternal = [];
  const blockedLoopbackHttpsAssets = [];
  const blockedMutations = [];
  const unexpectedApi = [];
  const pageErrors = [];
  let reminderReads = 0;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.protocol === "https:" && localOrigin.hostname === "127.0.0.1" &&
        url.hostname === localOrigin.hostname && url.port === localOrigin.port &&
        !url.username && !url.password && url.pathname === "/favicon.svg" && request.method() === "GET") {
      // app/layout.tsx defaults metadataBase to HTTPS when forwarded protocol
      // is absent. This is still the same loopback endpoint, not external
      // traffic. Keep the original package unchanged and abort, never forward
      // or rewrite this request; favicon loading is outside these status cases.
      blockedLoopbackHttpsAssets.push({ url: url.href, action: "aborted", reason: "same-loopback-host-and-port-https-favicon" });
      await route.abort("blockedbyclient");
      return;
    }
    if (url.origin !== baseUrl) {
      blockedExternal.push(url.origin + url.pathname);
      await route.abort("blockedbyclient");
      return;
    }
    if (!url.pathname.startsWith("/api/")) { await route.continue(); return; }
    requests.push({ method: request.method(), path: url.pathname });
    if (request.method() !== "GET") {
      blockedMutations.push({ method: request.method(), path: url.pathname,
        kind: url.pathname.startsWith("/api/reminders/") ? "reminder-operation-attempt" : "unexpected-non-reminder-fixture-write" });
      await route.fulfill({ status: 405, json: { message: "Acceptance blocks every API mutation" } });
      return;
    }
    if (url.pathname === "/api/runtime-status") await route.fulfill({ json: { app: "anthropology-canteen", sessionToken: "synthetic-ui-session" } });
    else if (url.pathname === "/api/local-data") await route.fulfill({ json: syntheticData() });
    else if (url.pathname === "/api/local-settings") await route.fulfill({ json: { version: 3, openAlexConfigured: false, semanticScholarConfigured: false, remindersConfigured: true, remindersEnabled: true } });
    else if (url.pathname === "/api/reminders/status") {
      reminderReads++;
      await route.fulfill(scenario.retryFailure && reminderReads > 1
        ? { status: 503, json: { message: "Synthetic system status read failure" } }
        : { json: syntheticStatus(scenario) });
    } else if (url.pathname === "/api/browser-session") {
      await route.fulfill({ contentType: "text/event-stream", body: 'event: ready\ndata: {"app":"anthropology-canteen"}\n\n' });
    } else {
      unexpectedApi.push(url.pathname);
      await route.fulfill({ status: 404, json: { message: "Unrecognized acceptance API" } });
    }
  });
  let failure;
  let buttonStates = [];
  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await eventually(() => ["/api/runtime-status", "/api/local-data", "/api/local-settings", "/api/reminders/status", "/api/browser-session"]
      .every((expected) => requests.some(({ path: requestPath }) => requestPath === expected)), "Initial candidate UI reads/SSE did not complete");
    await buttonState(page.getByRole("button", { name: "检查更新", exact: true }), false);
    const opener = page.getByRole("button", { name: scenario.active ? "邮件提醒已开" : "邮件提醒", exact: true });
    await visible(opener);
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "邮件提醒设置" });
    await visible(dialog);
    await visible(dialog.getByText(scenario.title, { exact: true }));
    for (const name of scenario.buttons) {
      const button = dialog.getByRole("button", { name, exact: true });
      const disabled = await buttonState(button, Boolean(scenario.disabled));
      buttonStates.push({ name, disabled });
    }
    if (scenario.active) await visible(dialog.getByText("后台提醒已开启", { exact: true }));
    else {
      assert.equal(await dialog.getByText("后台提醒已开启", { exact: true }).count(), 0);
      assert.equal(await dialog.getByText("邮件提醒正在运行", { exact: true }).count(), 0);
      assert.equal(await dialog.getByRole("button", { name: "立即检查一次", exact: true }).count(), 0);
    }
    if (scenario.status === "disabled") await visible(dialog.getByText("任务或触发条件已停用。只有你选择重新开启后才会修改。", { exact: true }));
    if (scenario.retryFailure) {
      await visible(dialog.getByText("无法读取系统任务状态。请检查系统权限后重新核对；旧记录不能证明提醒正常。", { exact: true }));
      assert.equal(await dialog.getByRole("button", { name: "开启自动邮件提醒", exact: true }).count(), 0);
      const recipient = dialog.getByRole("textbox", { name: "收件邮箱（常用邮箱）", exact: true });
      await recipient.fill("unsaved@example.invalid");
      const failedResponse = page.waitForResponse((response) => response.url().endsWith("/api/reminders/status") && response.status() === 503);
      // Only the read-only refresh is clicked. No mail, immediate check, or scheduler action is clicked.
      await dialog.getByRole("button", { name: "重新核对后台提醒", exact: true }).click();
      await (await failedResponse).finished();
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await recipient.inputValue(), "unsaved@example.invalid");
      await visible(dialog.getByText(scenario.title, { exact: true }));
      assert.equal(await dialog.getByText("后台提醒已开启", { exact: true }).count(), 0);
    }
    await page.screenshot({ path: path.join(path.dirname(reportPath), `${scenario.id}.png`), fullPage: true });
    assert.deepEqual(blockedMutations, [], "Unexpected write in the read-only fixture; see kind/path before attributing it to a reminder operation");
    assert.deepEqual(blockedExternal, [], "UI attempted an external request (blocked before transmission)");
    assert.deepEqual(unexpectedApi, [], "UI called an API outside the declared synthetic fixture");
    assert.deepEqual(pageErrors, [], "Compiled candidate browser errors");
  } catch (error) {
    failure = error.message;
    await page.screenshot({ path: path.join(path.dirname(reportPath), `${scenario.id}-failure.png`), fullPage: true }).catch(() => undefined);
  } finally {
    await context.close();
  }
  report.cases.push({
    id: scenario.id, category: CATEGORY, status: failure ? "fail" : "pass",
    details: { ...(failure ? { error: failure } : {}), syntheticSchedulerStatus: scenario.status, syntheticReasonCodes: scenario.reasons || [],
      expectedTitle: scenario.title, buttonStates, reminderReads, requests, blockedExternal, blockedLoopbackHttpsAssets, blockedMutations, unexpectedApi, pageErrors,
      nativeSchedulerOrCredentialOperation: false },
  });
}

try {
  await mkdir(path.dirname(reportPath), { recursive: true });
  let chrome;
  const choices = [args.chrome, process.env.ACCEPTANCE_CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].filter(Boolean);
  for (const choice of choices) { if (await exists(choice)) { chrome = choice; break; } }
  if (process.platform !== "darwin" || !chrome) {
    report.cases = selectedScenarios.map(({ id }) => ({ id, category: CATEGORY, status: "pending", details: process.platform !== "darwin" ? "Native macOS runner unavailable" : "Google Chrome executable unavailable" }));
  } else {
    const packageRoot = await realpath(args.package);
    assert.equal(await exists(path.join(packageRoot, "data")), false, "UI input must be a fresh candidate ZIP extraction without data");
    const release = JSON.parse(await readFile(path.join(packageRoot, "candidate.json"), "utf8"));
    assert.equal(release.sourceCommit, PRODUCT_SHA);
    assert.equal(release.version, "1.3.4");
    assert.equal(release.status, "unpublished-candidate");
    assert.equal(release.fullyVerified, false);
    assert.equal(release.platform, "darwin");
    assert.equal(release.arch, process.arch);
    report.environment.release = release;
    report.environment.chromePath = chrome;
    report.environment.serverModuleSHA256 = createHash("sha256").update(await readFile(path.join(packageRoot, "portable-server.mjs"))).digest("hex");
    await mkdir(args.scratch, { recursive: true });
    workRoot = await mkdtemp(path.join(await realpath(args.scratch), "ui-acceptance-"));
    productRoot = path.join(workRoot, "candidate-product");
    await cp(packageRoot, productRoot, { recursive: true, errorOnExist: true, force: false });
    const port = await reservePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const env = { ...process.env, PORT: String(port) };
    for (const name of ["OPENALEX_API_KEY", "SEMANTIC_SCHOLAR_API_KEY", "NODE_OPTIONS"]) delete env[name];
    logStream = createWriteStream(path.join(path.dirname(reportPath), "ui-candidate-server.log"));
    child = spawn(path.join(productRoot, "runtime/bin/node"), [path.join(productRoot, "portable-server.mjs")], { cwd: productRoot, env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.pipe(logStream, { end: false });
    child.stderr.pipe(logStream, { end: false });
    child.once("exit", (code, signal) => { serverExit = { code, signal }; });
    child.once("error", (error) => { serverExit = { error: error.message }; });
    await waitForServer(baseUrl);
    if (interruption) throw interruption;
    const playwrightModule = process.env.ACCEPTANCE_PLAYWRIGHT_MODULE;
    const { chromium } = await import(playwrightModule ? pathToFileURL(path.resolve(playwrightModule)).href : "playwright-core");
    browser = await chromium.launch({ executablePath: chrome, headless: true, args: ["--disable-background-networking", "--disable-component-update", "--no-first-run"] });
    report.environment.chromeVersion = browser.version();
    for (const scenario of selectedScenarios) {
      if (interruption) throw interruption;
      await exercise(scenario, baseUrl);
    }
    if (interruption) throw interruption;
    assert.equal(createHash("sha256").update(await readFile(path.join(productRoot, "portable-server.mjs"))).digest("hex"), report.environment.serverModuleSHA256, "Candidate server module changed");
  }
} catch (error) {
  report.cases.push({ id: "UI-harness", category: CATEGORY, status: "fail", details: error.stack || error.message });
  for (const scenario of selectedScenarios) if (!report.cases.some(({ id }) => id === scenario.id)) report.cases.push({ id: scenario.id, category: CATEGORY, status: "pending", details: "Harness did not reach this scenario; see UI-harness failure" });
} finally {
  process.removeListener("SIGINT", interrupted);
  process.removeListener("SIGTERM", interrupted);
  await cleanup();
  report.completedAt = new Date().toISOString();
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  process.exitCode = report.cases.some(({ status }) => status === "fail") ? 1 : 0;
  console.log(JSON.stringify({ report: reportPath, cases: report.cases.map(({ id, status }) => ({ id, status })), cleanup: report.cleanup }));
}
