// Evidence reproducer only: no OS command is executed and no worker is launched.
// Exit 1 means the recorded defect was reproduced, not a passing release gate.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getSchedulerStatus, installScheduler, schedulerCommandError } from "../../reminder-scheduler.mjs";

const source = fileURLToPath(new URL("../../", import.meta.url));
const reports = resolve(source, "outputs/r1-execution/macos-missing-diagnostic");
await mkdir(reports, { recursive: true });
const scratch = await mkdtemp(join(reports, "synthetic-"));
const sourceSHA = execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8", windowsHide: true }).trim();
const productDiff = execFileSync("git", ["diff", "--", "reminder-scheduler.mjs"], { cwd: source, encoding: "utf8", windowsHide: true });
assert.equal(productDiff, "", "Only reproduce against unchanged committed product source");
const config = { installationId: "r1diagnostic0000000000000000000000", schedule: { time: "23:59" } };
const cases = [];
for (const multiline of [false, true]) {
  const root = join(scratch, multiline ? "native-multiline" : "single-line-control");
  await mkdir(root);
  const commands = [];
  const raw = `${multiline ? "Bad request.\n" : ""}Could not find service "synthetic-owned-label" in domain for user gui: 501`;
  const runCommand = async (command, args) => {
    commands.push({ command, args: args.map((value) => value.replaceAll(scratch, "<synthetic-root>")) });
    assert.equal(command, "/bin/launchctl", "No unexpected command can run");
    if (args[0] === "print") throw schedulerCommandError({ error: Object.assign(new Error("synthetic native exit"), { code: 113 }), stderr: raw });
    if (args[0] === "print-disabled") return "disabled services = { }";
    // Stop before mutation even if classification succeeds. No command is executed.
    if (args[0] === "bootstrap") throw Object.assign(new Error("Synthetic bootstrap barrier reached"), { code: "REPRO_BOOTSTRAP_BARRIER" });
    throw new Error(`Forbidden OS mutation: ${args[0]}`);
  };
  const options = { platform: "darwin", uid: "501", plistPath: join(root, "owned.plist"), runCommand };
  const status = await getSchedulerStatus(root, config, options);
  let installError;
  try { await installScheduler(root, config, options); }
  catch (error) { installError = { code: error.code, message: error.message }; }
  const wrapped = schedulerCommandError({ error: Object.assign(new Error("synthetic native exit"), { code: 113 }), stderr: raw });
  cases.push({ multiline, raw, wrapped: { code: wrapped.code, message: wrapped.message }, status, bootstrapReached: commands.some(({ args }) => args[0] === "bootstrap"), installError, commands });
}
assert.equal(cases[0].status.status, "missing", "Single-line control must reach missing");
assert.equal(cases[0].bootstrapReached, true, "Single-line control must reach synthetic bootstrap barrier");
const defectReproduced = cases[1].status.status === "unknown" && !cases[1].bootstrapReached && cases[1].installError?.code === "SCHEDULER_COMMAND_FAILED";
const report = { sourceSHA, evidenceLayer: "same-source diagnostic injection; not native validation", nativeEvidenceRun: 37321169428, defectReproduced, cases, osCommandsExecuted: 0, workerExecutions: 0, networkRequests: 0, syntheticEvidenceRetained: true };
await writeFile(join(scratch, "result.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ sourceSHA, defectReproduced, cases: cases.map(({ multiline, status, bootstrapReached, installError }) => ({ multiline, status: status.status, bootstrapReached, installError })), report: join(scratch, "result.json"), osCommandsExecuted: 0 }, null, 2));
process.exitCode = defectReproduced ? 1 : 0;
