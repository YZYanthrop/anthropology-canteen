// Native Windows tasks with explicit source persistence faults; no mail worker.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, copyFile, link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { offlineWorkerSource } from "../../macos/basic-acceptance/native-ui.mjs";
const execute = promisify(execFile);
const args = Object.fromEntries(process.argv.slice(2).filter((_, i) => i % 2 === 0).map((v, i) => [v.slice(2), process.argv.slice(2)[i * 2 + 1]]));
assert.equal(process.platform, "win32");
const source = resolve(args.source), scratch = resolve(args.scratch), reportPath = resolve(args.report);
assert.match(args["product-sha"], /^[a-f0-9]{40}$/);
const here = dirname(fileURLToPath(import.meta.url));
const report = { productSHA: args["product-sha"], cases: [], environment: { platform: process.platform, arch: process.arch, node: process.version }, cleanup: {} };
const owned = [];
const file = join(scratch, "owned.json"), executionLog = join(scratch, "executions.jsonl");
const exists = async (p) => { try { await access(p); return true; } catch (e) { if (e.code === "ENOENT") return false; throw e; } };
async function native(name, mode = "Read", extra = []) {
  const result = await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(here, "native-state.ps1"), "-TaskName", name, "-OwnedRoot", scratch, "-Mode", mode, ...extra], { timeout: 45000, windowsHide: true });
  return JSON.parse(result.stdout.trim().replace(/^\uFEFF/, ""));
}
async function runCommand(command, commandArgs) {
  assert.ok(!commandArgs.some(v => String(v).endsWith("elevate-windows-reminder.ps1")), "Native cloud suite must not prompt for UAC; use the separate coordinated local fixture");
  return (await execute(command, commandArgs, { timeout: 45000, windowsHide: true })).stdout.trim();
}
async function remember(config) { const name = `Anthropology Canteen Reminder ${config.installationId.slice(0, 12)}`; owned.push(name); await writeFile(file, JSON.stringify({ sourceSHA: args["product-sha"], scratch, names: owned })); return name; }
async function fixture(root) {
  for (const name of ["tools", "runtime", "data"]) await mkdir(join(root, name), { recursive: true });
  try { await link(process.execPath, join(root, "runtime/node.exe")); } catch (error) { if (error.code !== "EXDEV") throw error; await copyFile(process.execPath, join(root, "runtime/node.exe")); }
  await writeFile(join(root, "reminder-worker.mjs"), offlineWorkerSource(executionLog));
  for (const name of ["register-windows-reminder.ps1", "inspect-windows-reminder.ps1", "windows-reminder-task-common.ps1", "elevate-windows-reminder.ps1"]) await copyFile(join(source, "tools", name), join(root, "tools", name));
}
async function note(id, category, body) { try { const details = await body(); report.cases.push({ id, category, status: "pass", details }); } catch (e) { report.cases.push({ id, category, status: "fail", details: { error: e.stack || e.message } }); } }
await mkdir(scratch, { recursive: true });
try {
  assert.equal((await execute("git", ["-C", source, "rev-parse", "HEAD"])).stdout.trim(), args["product-sha"]);
  const scheduler = await import(pathToFileURL(join(source, "reminder-scheduler.mjs")));
  const utilities = await import(pathToFileURL(join(source, "reminder-utils.mjs")));
  const later = new Date(Date.now() + 12 * 3600000);
  for (const state of ["current", "task-disabled", "daily-disabled", "logon-disabled", "absent"]) {
    for (const fault of ["none", "marker-write", "settings-write", "recovery-obstruction"]) {
      const id = `A-native-${state}-${fault}`;
      await note(id, fault === "none" ? "source-native" : "source-injection-native-observer", async () => {
        const root = join(scratch, randomUUID()), oldRoot = join(root, "old"), newRoot = join(root, "new");
        await fixture(oldRoot); await fixture(newRoot);
        const config = { installationId: randomUUID(), enabled: true, schedule: { time: `${String(later.getHours()).padStart(2,"0")}:${String(later.getMinutes()).padStart(2,"0")}` } };
        const name = await remember(config);
        const settings = join(newRoot, "data/anthropology-canteen-settings.json"), marker = join(newRoot, "data/anthropology-canteen-reminder-scheduler.json");
        const originals = { settings: JSON.stringify({ version: 3, reminders: config }), marker: JSON.stringify({ synthetic: "original-marker" }) };
        await writeFile(settings, originals.settings); await writeFile(marker, originals.marker);
        if (state !== "absent") {
          await scheduler.installScheduler(oldRoot, config, { runCommand });
          if (state !== "current") await native(name, { "task-disabled": "TaskDisabled", "daily-disabled": "DailyDisabled", "logon-disabled": "LogonDisabled" }[state]);
        }
        const before = await native(name);
        const oldStatus = await scheduler.getSchedulerStatus(oldRoot, config, { runCommand });
        assert.equal(oldStatus.status, state === "absent" ? "missing" : state === "current" ? "current" : "disabled");
        assert.equal((await native(name)).xml, before.xml, "status read changed the task");
        let injected = false, error;
        try {
          await scheduler.withSchedulerTransaction(newRoot, config, async ({ install }) => {
            await install(config);
            await utilities.writeJsonAtomic(settings, { version: 3, reminders: { ...config, schedulerPath: newRoot } });
            if (fault === "settings-write") { injected = true; throw new Error("injected settings acknowledgement failure"); }
          }, { runCommand, writeMarker: async (path, value) => {
            await utilities.writeJsonAtomic(path, value);
            if (fault === "marker-write") { injected = true; throw new Error("injected marker acknowledgement failure"); }
            if (fault === "recovery-obstruction") { injected = true; await rm(settings); await mkdir(settings); throw new Error("injected failure and owned settings obstruction"); }
          } });
        } catch (e) { error = e; }
        if (fault !== "none") { assert.ok(injected, error?.message || "fault not reached"); assert.ok(error); }
        else assert.equal(error, undefined);
        const after = await native(name);
        if (fault === "none") {
          assert.equal(after.exists, true); assert.equal(resolve(after.root), newRoot); assert.equal(after.enabled, state === "absent" ? true : before.enabled);
          if (before.exists) assert.deepEqual(after.triggers, before.triggers);
          await scheduler.installScheduler(newRoot, config, { runCommand });
          assert.deepEqual((await native(name)).triggers, after.triggers, "repeat must preserve trigger flags");
        } else {
          assert.equal(after.exists, before.exists);
          if (before.exists) assert.equal(after.xml, before.xml, "original native task XML must be restored exactly");
          if (fault === "recovery-obstruction") {
            assert.match(error.message, /恢复未完成/);
            const journal = JSON.parse(await readFile(join(newRoot, "data/.scheduler-update.json"), "utf8"));
            assert.equal(Buffer.from(journal.files["anthropology-canteen-settings.json"], "base64").toString(), originals.settings);
            await assert.rejects(scheduler.installScheduler(newRoot, config, { runCommand }), /恢复未完成/);
            const code = `import assert from 'node:assert/strict';import {withSchedulerTransaction} from ${JSON.stringify(pathToFileURL(join(source,"reminder-scheduler.mjs")).href)};await assert.rejects(withSchedulerTransaction(process.argv[1],{},()=>assert.fail('must not mutate')),/恢复未完成/);`;
            await execute(process.execPath, ["--input-type=module", "-e", code, newRoot], { timeout: 15000, windowsHide: true });
          } else {
            assert.equal(await readFile(settings, "utf8"), originals.settings); assert.equal(await readFile(marker, "utf8"), originals.marker);
          }
        }
        assert.equal(await exists(executionLog), false, "update or recovery executed offline worker");
        await native(name, "Remove");
        return { originalTaskRestored: fault !== "none", originalState: state, injectionReached: injected, noWorkerExecution: true, userSid: after.userSid, runLevel: after.runLevel || "absent" };
      });
    }
  }
  await note("windows-real-calendar-trigger", "source-native", async () => {
    assert.equal(await exists(executionLog), false);
    const root = join(scratch, "timer"); await fixture(root);
    const name = await remember({ installationId: randomUUID() });
    const before = new Date().toISOString();
    await native(name, "Once", ["-NodePath", join(root,"runtime/node.exe"), "-WorkerPath", join(root,"reminder-worker.mjs")]);
    for (let i=0;i<90 && !(await exists(executionLog));i++) await delay(1000);
    assert.equal(await exists(executionLog), true, "OS timer did not execute within 90 seconds");
    const lines = (await readFile(executionLog,"utf8")).trim().split("\n"); assert.equal(lines.length,1);
    assert.ok(JSON.parse(lines[0]).executedAt >= before); assert.equal(JSON.parse(lines[0]).count, 1); await native(name,"Remove");
    return { executions:1, scheduledByOS:true, manuallyStarted:false, startedAt:before, workerRecord:JSON.parse(lines[0]) };
  });
} catch (e) { report.cases.push({ id:"harness",category:"harness",status:"fail",details:e.stack||e.message }); }
finally {
  const cleanup = [];
  for (const name of owned) { try { const result=await native(name,"Remove"); assert.equal(result.exists,false); cleanup.push({name,absent:true}); } catch(e) { cleanup.push({name,error:e.message}); } }
  report.cleanup={status:cleanup.some(x=>x.error)?"fail":"pass",tasks:cleanup,syntheticRecoveryEvidenceRetained:true};
  report.cases.push({id:"windows-scheduler.final-cleanup",category:"harness-cleanup",status:report.cleanup.status,details:report.cleanup});
  await mkdir(dirname(reportPath),{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2)+"\n");
  process.exitCode=report.cases.some(c=>c.status!=="pass")?1:0;
  console.log(JSON.stringify({cases:report.cases.map(({id,status})=>({id,status})),cleanup:report.cleanup.status}));
}
