import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const importer = fileURLToPath(
  new URL("../packaging/macos/import-data.mjs", import.meta.url),
);

function validLocalData(states = {}, version = 7) {
  return {
    version,
    subscriptions: { journal: [], scholar: [], keyword: [] },
    states,
  };
}

test("macOS importer CLI entry runs from a path containing spaces", async () => {
  const root = await mkdtemp(join(tmpdir(), "anthropology canteen importer "));
  const scriptDirectory = join(root, "folder with spaces");
  const script = join(scriptDirectory, "import data.mjs");
  await mkdir(scriptDirectory, { recursive: true });
  await writeFile(script, await readFile(importer));

  try {
    const result = spawnSync(process.execPath, [script], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Usage: import-data\.mjs/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("macOS import validates JSON, backs up targets, and copies only approved neighbors", async () => {
  const root = await mkdtemp(join(tmpdir(), "anthropology-canteen-mac-import-"));
  const source = join(root, "old-data");
  const target = join(root, "new-version");
  const targetData = join(target, "data");
  await mkdir(source, { recursive: true });
  await mkdir(targetData, { recursive: true });
  await writeFile(
    join(source, "anthropology-canteen-data.json"),
    JSON.stringify(validLocalData({ imported: { saved: true } }, 2)),
  );
  await writeFile(
    join(source, "anthropology-canteen-settings.json"),
    JSON.stringify({ version: 2, openAlexApiKey: "imported-key" }),
  );
  await writeFile(join(source, "unrelated.json"), JSON.stringify({ secret: true }));
  await writeFile(
    join(targetData, "anthropology-canteen-data.json"),
    JSON.stringify({ version: 7, states: { original: { read: true } } }),
  );
  await writeFile(
    join(targetData, "anthropology-canteen-settings.json"),
    JSON.stringify({ version: 2, openAlexApiKey: "original-key" }),
  );

  try {
    const result = spawnSync(
      process.execPath,
      [importer, "--source", source, "--target-root", target],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const imported = JSON.parse(
      await readFile(join(targetData, "anthropology-canteen-data.json"), "utf8"),
    );
    const settings = JSON.parse(
      await readFile(join(targetData, "anthropology-canteen-settings.json"), "utf8"),
    );
    assert.equal(imported.states.imported.saved, true);
    assert.equal(imported.version, 2);
    assert.equal(settings.openAlexApiKey, "imported-key");
    const names = await readdir(targetData);
    assert.ok(names.some((name) => /^anthropology-canteen-data\.backup-/.test(name)));
    assert.ok(names.some((name) => /^anthropology-canteen-settings\.backup-/.test(name)));
    assert.equal(names.includes("unrelated.json"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("macOS import rejects invalid neighboring settings before changing existing data", async () => {
  const root = await mkdtemp(join(tmpdir(), "anthropology-canteen-mac-invalid-"));
  const source = join(root, "old-data");
  const target = join(root, "new-version");
  const targetData = join(target, "data");
  await mkdir(source, { recursive: true });
  await mkdir(targetData, { recursive: true });
  const original = '{"version":7,"states":{"keep":{"saved":true}}}';
  await writeFile(
    join(source, "anthropology-canteen-data.json"),
    JSON.stringify(validLocalData()),
  );
  await writeFile(join(source, "anthropology-canteen-settings.json"), "not-json");
  await writeFile(join(targetData, "anthropology-canteen-data.json"), original);

  try {
    const result = spawnSync(
      process.execPath,
      [importer, "--source", source, "--target-root", target],
      { encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not valid JSON/);
    assert.equal(
      await readFile(join(targetData, "anthropology-canteen-data.json"), "utf8"),
      original,
    );
    assert.deepEqual(await readdir(targetData), ["anthropology-canteen-data.json"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("macOS import leaves destination settings unchanged when the source has none", async () => {
  const root = await mkdtemp(join(tmpdir(), "anthropology-canteen-mac-no-settings-"));
  const source = join(root, "old-data");
  const target = join(root, "new-version");
  const targetData = join(target, "data");
  await mkdir(source, { recursive: true });
  await mkdir(targetData, { recursive: true });
  await writeFile(
    join(source, "anthropology-canteen-data.json"),
    JSON.stringify(validLocalData()),
  );
  await writeFile(
    join(targetData, "anthropology-canteen-settings.json"),
    '{"version":2,"openAlexApiKey":"keep-this-key"}',
  );

  try {
    const result = spawnSync(
      process.execPath,
      [importer, "--source", source, "--target-root", target],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      await readFile(join(targetData, "anthropology-canteen-settings.json"), "utf8"),
      '{"version":2,"openAlexApiKey":"keep-this-key"}',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("macOS import rejects unsupported data and settings schemas", async () => {
  const root = await mkdtemp(join(tmpdir(), "anthropology-canteen-mac-schema-"));
  const source = join(root, "old-data");
  const target = join(root, "new-version");
  const targetData = join(target, "data");
  const destination = join(targetData, "anthropology-canteen-data.json");
  const sourceData = join(source, "anthropology-canteen-data.json");
  const sourceSettings = join(source, "anthropology-canteen-settings.json");
  const original = JSON.stringify(validLocalData({ keep: { saved: true } }));
  await mkdir(source, { recursive: true });
  await mkdir(targetData, { recursive: true });
  await writeFile(destination, original);

  try {
    await writeFile(sourceData, "{}");
    let result = spawnSync(
      process.execPath,
      [importer, "--source", source, "--target-root", target],
      { encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /supported data version/);
    assert.equal(await readFile(destination, "utf8"), original);

    await writeFile(sourceData, JSON.stringify(validLocalData()));
    for (const settings of [
      {},
      { version: 1, openAlexApiKey: "wrong-version" },
      { version: 2, openAlexApiKey: 42 },
      { version: 2, unexpectedSecret: "do-not-import" },
    ]) {
      await writeFile(sourceSettings, JSON.stringify(settings));
      result = spawnSync(
        process.execPath,
        [importer, "--source", source, "--target-root", target],
        { encoding: "utf8" },
      );
      assert.notEqual(result.status, 0);
      assert.equal(await readFile(destination, "utf8"), original);
    }
    assert.deepEqual(await readdir(targetData), ["anthropology-canteen-data.json"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("macOS import refuses to modify data while the target PID is alive", async () => {
  const root = await mkdtemp(join(tmpdir(), "anthropology-canteen-mac-live-pid-"));
  const source = join(root, "old-data");
  const target = join(root, "new-version");
  const targetData = join(target, "data");
  const destination = join(targetData, "anthropology-canteen-data.json");
  const original = JSON.stringify(validLocalData({ keep: { saved: true } }));
  await mkdir(source, { recursive: true });
  await mkdir(targetData, { recursive: true });
  await writeFile(
    join(source, "anthropology-canteen-data.json"),
    JSON.stringify(validLocalData({ imported: { read: true } })),
  );
  await writeFile(destination, original);
  await writeFile(
    join(targetData, "anthropology-canteen-server.pid"),
    String(process.pid),
  );

  try {
    const result = spawnSync(
      process.execPath,
      [importer, "--source", source, "--target-root", target],
      { encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /appears to be running/);
    assert.equal(await readFile(destination, "utf8"), original);
    assert.doesNotThrow(() => process.kill(process.pid, 0));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("macOS packaging definitions are statically verifiable on Windows", async () => {
  const build = await readFile(
    new URL("../packaging/macos/build-portable.sh", import.meta.url),
    "utf8",
  );
  const launcher = await readFile(
    new URL("../packaging/macos/launch-background.sh", import.meta.url),
    "utf8",
  );
  const importLauncher = await readFile(
    new URL(
      "../packaging/macos/import-data-from-old-version.command",
      import.meta.url,
    ),
    "utf8",
  );
  const workflow = await readFile(
    new URL("../.github/workflows/macos-portable.yml", import.meta.url),
    "utf8",
  );
  const smoke = await readFile(
    new URL("../packaging/macos/smoke-test.sh", import.meta.url),
    "utf8",
  );
  const portableServer = await readFile(
    new URL("../portable-server.mjs", import.meta.url),
    "utf8",
  );
  const projectState = await readFile(
    new URL("../docs/PROJECT_STATE.md", import.meta.url),
    "utf8",
  );

  assert.match(build, /NODE_VERSION="24\.14\.0"/);
  assert.match(build, /darwin-arm64/);
  assert.match(build, /darwin-x64/);
  assert.match(build, /Apple-Silicon-arm64/);
  assert.match(build, /Intel-x64/);
  assert.match(build, /SHASUMS256\.txt/);
  assert.match(build, /zip -q -r -X/);
  assert.doesNotMatch(build, /zip -q -r -y/);
  assert.match(build, /find "\$STAGE_ROOT" -type l/);
  assert.match(build, /--retry 3/);
  assert.match(build, /--connect-timeout 15/);
  assert.match(build, /--max-time 300/);
  assert.match(build, /shasum -a 256 "\$ZIP_NAME"/);
  assert.match(build, /RUNTIME-NOTICE\.txt/);
  assert.doesNotMatch(build, /osacompile|Anthropology Canteen\.app/);
  assert.match(launcher, /--auto-close/);
  assert.match(launcher, /api\/runtime-status/);
  assert.match(launcher, /attempt < 90/);
  assert.match(launcher, /ANTHROPOLOGY_CANTEEN_SKIP_OPEN:-0/);
  assert.match(launcher, /!= "1"/);
  assert.match(importLauncher, /^read -p "Old data path: "/m);
  assert.doesNotMatch(importLauncher, /IFS= read -p "Old data path: "/);
  assert.doesNotMatch(importLauncher, /read -r -p "Old data path: "/);
  assert.match(workflow, /runner: macos-15\n/);
  assert.match(workflow, /runner: macos-15-intel/);
  assert.match(workflow, /runs-on: windows-latest/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request:\s+paths:/);
  assert.match(workflow, /artifact_name=\$\{ROOT\}-beta/);
  assert.doesNotMatch(workflow, /name: .*v1\.1\.1-beta/);
  assert.equal(workflow.match(/uses: pnpm\/action-setup@v6/g)?.length, 2);
  assert.doesNotMatch(workflow, /git push|gh release|create-release/);
  assert.match(smoke, /blank\.version !== 7/);
  assert.match(smoke, /process\.arch/);
  assert.match(smoke, /api\/browser-session/);
  assert.match(smoke, /did not persist across restart/);
  assert.match(smoke, /ZIP did not preserve/);
  assert.match(smoke, /NODE="\$EXTRACTED_ROOT\/runtime\/bin\/node"/);
  assert.match(smoke, /--target-root "\$EXTRACTED_ROOT"/);
  assert.doesNotMatch(smoke, /--target-root "\$PACKAGE_ROOT"/);
  assert.match(
    smoke,
    /ANTHROPOLOGY_CANTEEN_SKIP_OPEN=1 PORT="\$ENTRY_PORT" "\$EXTRACTED_ROOT\/Anthropology Canteen\.command"/,
  );
  assert.match(smoke, /anthropology-canteen-server\.pid/);
  assert.match(smoke, /kill -0 "\$ENTRY_PID"/);
  assert.match(smoke, /portable-server\.mjs/);
  assert.ok(
    smoke.indexOf('ENTRY_PID="$(/bin/cat "$PID_FILE")"') <
      smoke.indexOf("user launcher runtime status is invalid"),
  );
  assert.match(smoke, /CLOSE_ELAPSED.*-ge 6/);
  assert.match(portableServer, /8_000/);
  assert.match(portableServer, /90_000/);
  assert.match(projectState, /close the last Anthropology Canteen page/);
  assert.doesNotMatch(projectState, /鈥|渃/);
});
