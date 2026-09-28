// Interactive fixture: explicitly prepare, then ask the user to deny the UAC prompt.
import assert from "node:assert/strict";
import { copyFile, link, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { getSchedulerStatus, installScheduler, taskName } from "../reminder-scheduler.mjs";

const productRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(productRoot, "outputs", "v1.3.4-verification");
const manifest = join(output, "cancel-fixture.json");
assert.equal(process.platform, "win32");
if (process.argv[2] === "--prepare") {
  await mkdir(output, { recursive: true });
  const root = await mkdtemp(join(output, "uac-cancel-"));
  for (const name of ["tools", "runtime", "data"]) await mkdir(join(root, name));
  await link(process.execPath, join(root, "runtime", "node.exe"));
  await writeFile(join(root, "reminder-worker.mjs"), 'import {writeFileSync} from "node:fs"; writeFileSync(new URL("worker-ran",import.meta.url),"unexpected");');
  for (const name of ["register-windows-reminder.ps1", "elevate-windows-reminder.ps1", "inspect-windows-reminder.ps1", "windows-reminder-task-common.ps1"])
    await copyFile(join(productRoot, "tools", name), join(root, "tools", name));
  const config = { installationId: randomUUID(), enabled: false, schedule: { time: "23:59" } };
  await writeFile(join(root, "data", "anthropology-canteen-settings.json"), JSON.stringify({ version: 3, reminders: config }));
  await writeFile(join(root, "data", "anthropology-canteen-reminder-scheduler.json"), JSON.stringify({ synthetic: true }));
  assert.equal((await getSchedulerStatus(root, config)).status, "missing");
  await writeFile(manifest, JSON.stringify({ root, config, taskName: taskName(config) }, null, 2));
  console.log("Prepared unique fixture; no task registered. Next run requires choosing No in UAC.");
} else {
  assert.equal(process.argv[2], "--run");
  const { root, config } = JSON.parse(await readFile(manifest, "utf8"));
  assert.ok(resolve(root).startsWith(resolve(output) + "\\uac-cancel-"));
  const directory = join(root, "data");
  const beforeNames = await readdir(directory);
  const before = await Promise.all(beforeNames.map((name) => readFile(join(directory, name))));
  assert.equal((await getSchedulerStatus(root, config)).status, "missing");
  await assert.rejects(installScheduler(root, config), (error) => error.code === "SCHEDULER_ELEVATION_CANCELLED");
  assert.equal((await getSchedulerStatus(root, config)).status, "missing");
  assert.deepEqual(await readdir(directory), beforeNames);
  for (const [index, name] of beforeNames.entries()) assert.deepEqual(await readFile(join(directory, name)), before[index]);
  assert.ok(!(await readdir(root)).includes("worker-ran"));
  await writeFile(join(output, "windows-uac-cancel-result.json"), JSON.stringify({ passed: true, taskAbsent: true, originalFilesUnchanged: true, noWorkerInvocation: true }, null, 2));
  console.log("Real UAC cancellation preserved every fixture file and left no task or worker invocation.");
}
