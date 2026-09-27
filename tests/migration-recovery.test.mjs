import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm, readdir, open, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { installFileTransaction, migrationRecoveryStatus, writeJsonAtomic } from "../reminder-utils.mjs";

// Written before Slice B implementation. Execution belongs to unified verification.
for (const stage of ["write", "sync", "close", "backup", "replace"]) {
  test(`migration ${stage} failure restores originals and tracks every temporary`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "canteen-migration-fault-"));
    const destination = join(directory, "original.json");
    await writeFile(destination, "original");
    try {
      await assert.rejects(installFileTransaction([{ destination, bytes: Buffer.from("new") }], {
        checkpoint: async (event) => { if (event === stage) throw new Error(`fault-${stage}`); },
      }), (error) => error.recovery === "restored" && error.message.includes(`fault-${stage}`));
      assert.equal(await readFile(destination, "utf8"), "original");
      assert.deepEqual(await readdir(directory), ["original.json"]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
}

test("failed rollback retains backups, blocks writes and survives a fresh process", async () => {
  const directory = await mkdtemp(join(tmpdir(), "canteen-migration-unrestored-"));
  const first = join(directory, "first.json");
  const second = join(directory, "second.json");
  await writeFile(first, "old-first");
  await writeFile(second, "old-second");
  try {
    await assert.rejects(installFileTransaction([
      { destination: first, bytes: Buffer.from("new-first") },
      { destination: second, bytes: Buffer.from("new-second") },
    ], { checkpoint: async (event, index) => {
      if ((event === "replace" && index === 1) || event === "restore") throw new Error("injected failure");
    } }), (error) => error.recovery === "incomplete");
    const status = await migrationRecoveryStatus(directory);
    assert.equal(status.blocked, true);
    assert.ok((await readdir(directory)).some((name) => name.includes(".backup-migration-")));
    await assert.rejects(writeJsonAtomic(first, { overwritten: true }), /恢复未完成/);
    const moduleUrl = new URL("../reminder-utils.mjs", import.meta.url).href;
    await promisify(execFile)(process.execPath, ["--input-type=module", "-e",
      `import assert from 'node:assert/strict'; import { migrationRecoveryStatus, writeJsonAtomic } from ${JSON.stringify(moduleUrl)};
       assert.equal((await migrationRecoveryStatus(process.argv[1])).blocked,true);
       await assert.rejects(writeJsonAtomic(process.argv[2], {}), /恢复未完成/);`, directory, first]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("cleanup failure reports restored data without destroying recovery evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "canteen-migration-cleanup-"));
  const destination = join(directory, "record.json");
  await writeFile(destination, "old");
  try {
    await assert.rejects(installFileTransaction([{ destination, bytes: Buffer.from("new") }], {
      checkpoint: async (event) => { if (["replace", "cleanup"].includes(event)) throw new Error("fault"); },
    }), (error) => error.recovery === "restored" && error.cleanupFailed === true);
    assert.equal(await readFile(destination, "utf8"), "old");
    const status = await migrationRecoveryStatus(directory);
    assert.equal(status.blocked, false);
    assert.equal(status.cleanupPending, true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("changed targets are rejected before replacement and source bytes remain intact", async () => {
  const directory = await mkdtemp(join(tmpdir(), "canteen-migration-new-data-"));
  const destination = join(directory, "record.json");
  await writeFile(destination, "new-user-data");
  try {
    await assert.rejects(installFileTransaction([{ destination, bytes: Buffer.from("old-source"), expectedBytes: null }]), /changed/);
    assert.equal(await readFile(destination, "utf8"), "new-user-data");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a post-rename failure is recovered by comparing bytes, including originally absent files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "canteen-migration-after-rename-"));
  const destination = join(directory, "record.json");
  try {
    await assert.rejects(installFileTransaction([{ destination, bytes: Buffer.from("new") }], {
      renameFile: async (source, target) => { await rename(source, target); throw new Error("post rename"); },
    }), (error) => error.recovery === "restored");
    await assert.rejects(readFile(destination), { code: "ENOENT" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("handle write failure after creation cleans its registered temporary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "canteen-migration-open-"));
  try {
    await assert.rejects(installFileTransaction([{ destination: join(directory, "record.json"), bytes: Buffer.from("new") }], {
      openFile: async (...args) => {
        const handle = await open(...args);
        return { writeFile: async () => { throw new Error("disk full"); }, sync: () => handle.sync(), close: () => handle.close() };
      },
    }), /disk full/);
    assert.deepEqual(await readdir(directory), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
