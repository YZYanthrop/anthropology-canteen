import assert from "node:assert/strict";
import test from "node:test";
import { classifyBrowserRequest, parseDisabledState, validateOwnedManifest, offlineWorkerSource, awaitOwnedCommand } from "../packaging/macos/basic-acceptance/native-ui.mjs";

const label = "org.anthropology-canteen.reminder.nativeui0123456789abcdef";

test("native UI oracle distinguishes both launchctl formats and rejects ambiguous target state", () => {
  for (const [entry, disabled] of [["disabled", true], ["enabled", false], ["true", true], ["false", false]]) {
    assert.deepEqual(parseDisabledState(`disabled services = {\n\t"${label}" => ${entry}\n}`, label), {
      disabled, entry, rawLine: `\t"${label}" => ${entry}`,
    });
  }
  assert.deepEqual(parseDisabledState('disabled services = {\n "unrelated" => disabled\n}', label), { disabled: false, entry: "absent", rawLine: null });
  for (const bad of ["permission denied", `disabled services = {\n "${label}" => unknown\n}`, `disabled services = {\n "${label}" => disabled\n "${label}" => enabled\n}`]) {
    assert.throws(() => parseDisabledState(bad, label));
  }
});

test("native UI network guard permits real same-origin GET only and never reroutes HTTPS icons", () => {
  const base = "http://127.0.0.1:43123";
  assert.equal(classifyBrowserRequest(`${base}/api/reminders/status`, "GET", base), "allow-real-read");
  assert.equal(classifyBrowserRequest(`${base}/api/browser-session`, "GET", base), "allow-real-read");
  assert.equal(classifyBrowserRequest(`${base}/api/reminders/enable`, "POST", base), "block-write");
  assert.equal(classifyBrowserRequest("https://127.0.0.1:43123/favicon.svg", "GET", base), "block-loopback-https-favicon");
  for (const url of ["https://example.invalid/a", "https://127.0.0.1:43124/favicon.svg", "https://127.0.0.1.evil.invalid:43123/favicon.svg", "https://127.0.0.1:43123/api/reminders/status"]) {
    assert.equal(classifyBrowserRequest(url, "GET", base), "block-other-origin");
  }
  assert.equal(classifyBrowserRequest("https://127.0.0.1:43123/favicon.svg", "POST", base), "block-write");
});

test("cleanup ownership rejects path escapes, identity mismatches and unsafe process signatures", () => {
  const scratch = "/tmp/canteen-basic-native-ui";
  const workRoot = `${scratch}/native-ui-123abc`;
  const home = "/Users/runner";
  const sourceSHA = "a".repeat(40);
  const manifest = {
    version: 1, kind: "basic-native-ui", uid: 501, sourceSHA, scratch, workRoot,
    installationId: "nativeui0123456789abcdef", label,
    credentialRef: "native-ui-01234567-89ab-4cde-8fab-0123456789ab",
    productRoot: `${workRoot}/candidate-product`,
    worker: `${workRoot}/offline-worker.mjs`, executionLog: `${workRoot}/offline-executions.jsonl`,
    plist: `${home}/Library/LaunchAgents/${label}.plist`,
    processes: [{ kind: "server", pid: 1234, needle: `${workRoot}/candidate-product/portable-server.mjs` }],
  };
  const options = { scratch, home, uid: 501, sourceSHA };
  assert.equal(validateOwnedManifest(manifest, options), manifest);
  for (const patch of [
    { workRoot: "/tmp/someone-else" }, { productRoot: `${workRoot}/../outside` },
    { plist: `${home}/Library/LaunchAgents/personal.plist` }, { label: "com.apple.anything" },
    { uid: 0 }, { sourceSHA: "b".repeat(40) }, { credentialRef: "personal@example.invalid" },
    { processes: [{ kind: "server", pid: 1, needle: "/usr/bin/login" }] },
    { processes: [{ kind: "browser", pid: 1234, needle: "/Users/runner/personal-browser" }] },
  ]) assert.throws(() => validateOwnedManifest({ ...manifest, ...patch }, options));
});


test("offline task payload is executable and records only timestamp/count without product worker", async () => {
  const { mkdtemp, writeFile, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const root = await mkdtemp(join(tmpdir(), "canteen-offline-payload-"));
  try {
    const log = join(root, "executions.jsonl"), worker = join(root, "offline.mjs");
    await writeFile(worker, offlineWorkerSource(log));
    await promisify(execFile)(process.execPath, [worker]);
    await promisify(execFile)(process.execPath, [worker]);
    const rows = (await readFile(log, "utf8")).trim().split(String.fromCharCode(10)).map((line) => JSON.parse(line));
    assert.deepEqual(rows.map((row) => row.count), [1, 2]);
    assert.ok(rows.every((row) => Object.keys(row).sort().join(",") === "count,executedAt" && !Number.isNaN(Date.parse(row.executedAt))));
  } finally { await rm(root, { recursive: true, force: true }); }
});


test("cleanup tolerates an exiting PID but never accepts a persistently different process", async () => {
  const needle = "/tmp/owned/portable-server.mjs";
  let calls = 0;
  const transitional = ["(node)", ""];
  assert.equal(await awaitOwnedCommand(42, needle, async () => transitional[calls++], async () => {}), "");
  assert.equal(calls, 2);
  assert.equal(await awaitOwnedCommand(42, needle, async () => `node ${needle}`, async () => {}), `node ${needle}`);
  calls = 0;
  await assert.rejects(awaitOwnedCommand(42, needle, async () => { calls++; return "/usr/bin/unrelated"; }, async () => {}), /identity differs.*42.*refusing termination/);
  assert.equal(calls, 40);
});
