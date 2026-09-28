import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm, readdir, open, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { installFileTransaction, migrationRecoveryStatus, writeJsonAtomic } from "../reminder-utils.mjs";
import { lockWindowsFixtureFile } from "./helpers/windows-files.mjs";

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

for (const restorationBlocked of [false, true]) {
  test(`Windows native file sharing prevents unsafe replacement (rollback blocked=${restorationBlocked})`, { skip: process.platform !== "win32" }, async () => {
    const directory = await mkdtemp(join(tmpdir(), "canteen-migration-native-"));
    const first = join(directory, "first.json");
    const second = join(directory, "second.json");
    await writeFile(first, "old-first");
    await writeFile(second, "old-second");
    let release;
    try {
      if (!restorationBlocked) release = await lockWindowsFixtureFile(directory, first);
      await assert.rejects(installFileTransaction([
        { destination: first, bytes: Buffer.from("new-first") },
        { destination: second, bytes: Buffer.from("new-second") },
      ], { checkpoint: async (event, index) => {
        if (restorationBlocked && event === "replace" && index === 1) {
          release = await lockWindowsFixtureFile(directory, first);
          throw new Error("interrupt after first replacement");
        }
      } }), (error) => error.recovery === (restorationBlocked ? "incomplete" : "restored"));
      assert.equal(await readFile(first, "utf8"), restorationBlocked ? "new-first" : "old-first");
      assert.equal(await readFile(second, "utf8"), "old-second");
      await release(); release = undefined;
      assert.equal((await migrationRecoveryStatus(directory)).blocked, restorationBlocked);
      if (restorationBlocked) {
        const backup = (await readdir(directory)).find((name) => name.startsWith("first.backup-"));
        assert.equal(await readFile(join(directory, backup), "utf8"), "old-first");
        await assert.rejects(writeJsonAtomic(first, {}), /恢复未完成/);
      }
    } finally { if (release) await release(); await rm(directory, { recursive: true, force: true }); }
  });
}

for (const operation of ["sync", "close"]) {
  test(`actual temporary handle ${operation} rejection leaves originals intact`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "canteen-migration-handle-"));
    const destination = join(directory, "record.json");
    await writeFile(destination, "original");
    try {
      await assert.rejects(installFileTransaction([{ destination, bytes: Buffer.from("new") }], {
        openFile: async (...args) => {
          const handle = await open(...args);
          return {
            writeFile: (bytes) => handle.writeFile(bytes),
            sync: async () => { if (operation === "sync") throw new Error("handle sync failed"); await handle.sync(); },
            close: async () => { await handle.close(); if (operation === "close") throw new Error("handle close failed"); },
          };
        },
      }), (error) => error.recovery === "restored");
      assert.equal(await readFile(destination, "utf8"), "original");
      assert.deepEqual(await readdir(directory), ["record.json"]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
}

test("rollback never overwrites newer external bytes and retains original backup", async () => {
  const directory = await mkdtemp(join(tmpdir(), "canteen-migration-concurrent-"));
  const first = join(directory, "first.json");
  const second = join(directory, "second.json");
  await writeFile(first, "original");
  try {
    await assert.rejects(installFileTransaction([
      { destination: first, bytes: Buffer.from("migrated") },
      { destination: second, bytes: Buffer.from("second") },
    ], { checkpoint: async (event, index) => {
      if (event === "replace" && index === 1) { await writeFile(first, "new-user-data"); throw new Error("interrupted"); }
    } }), (error) => error.recovery === "incomplete");
    assert.equal(await readFile(first, "utf8"), "new-user-data");
    const backup = (await readdir(directory)).find((name) => name.startsWith("first.backup-"));
    assert.equal(await readFile(join(directory, backup), "utf8"), "original");
    assert.equal((await migrationRecoveryStatus(directory)).blocked, true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("committed cleanup failure preserves completed data and blocks another migration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "canteen-migration-committed-"));
  const destination = join(directory, "record.json");
  await writeFile(destination, "original");
  try {
    await assert.rejects(installFileTransaction([{ destination, bytes: Buffer.from("completed") }], {
      checkpoint: async (event) => { if (event === "cleanup") throw new Error("cleanup denied"); },
    }), (error) => error.code === "MIGRATION_CLEANUP_REQUIRED" && error.recovery === "committed");
    assert.equal(await readFile(destination, "utf8"), "completed");
    assert.equal((await migrationRecoveryStatus(directory)).cleanupPending, true);
    await assert.rejects(installFileTransaction([{ destination, bytes: Buffer.from("again") }]), { code: "MIGRATION_CLEANUP_REQUIRED" });
    assert.equal(await readFile(destination, "utf8"), "completed");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
