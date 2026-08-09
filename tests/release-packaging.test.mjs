import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("product version and provider User-Agents stay aligned", async () => {
  const metadata = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(metadata.version, "1.2.0");

  for (const file of [
    "../app/lib/scholar-search.ts",
    "../app/api/search/route.ts",
    "../app/api/feed/route.ts",
  ]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    const versions = [
      ...source.matchAll(/AnthropologyCanteen\/(\d+\.\d+\.\d+)/g),
    ].map((match) => match[1]);
    assert.ok(versions.length > 0, `${file} has no product User-Agent`);
    assert.deepEqual([...new Set(versions)], [metadata.version]);
  }
});

test("Windows packaging is reproducible, private, and smoke-tested", async () => {
  const build = await readFile(
    new URL("../packaging/windows/build-portable.ps1", import.meta.url),
    "utf8",
  );
  const smoke = await readFile(
    new URL("../packaging/windows/smoke-test.ps1", import.meta.url),
    "utf8",
  );
  const launcher = await readFile(
    new URL("../Anthropology Canteen.vbs", import.meta.url),
    "utf8",
  );
  const readme = await readFile(
    new URL("../packaging/windows/README-Windows.txt", import.meta.url),
    "utf8",
  );
  const importLauncher = await readFile(
    new URL("../import-data-from-old-version.cmd", import.meta.url),
    "utf8",
  );

  assert.match(build, /\$NodeVersion = "24\.14\.0"/);
  assert.match(build, /node-v\$NodeVersion-win-x64\.zip/);
  assert.match(build, /SHASUMS256\.txt/);
  assert.match(build, /Get-FileHash.+SHA256/);
  assert.match(build, /Anthropology-Canteen-Windows-x64-v\$ProductVersion/);
  assert.match(build, /Assert-BlankPortableTree/);
  assert.match(build, /Assert-ChildPath/);
  assert.match(build, /Compress-Archive/);
  assert.match(build, /runtime\\LICENSE/);
  assert.match(build, /packaging\\shared\\import-data\.mjs/);
  assert.match(build, /tools\\import-data\.mjs/);
  assert.match(readme, /@PRODUCT_VERSION@/);

  assert.match(smoke, /blank version 7 structure/);
  assert.match(smoke, /did not persist after restart/);
  assert.match(smoke, /api\/browser-session/);
  assert.match(smoke, /approximately eight seconds/);
  assert.match(smoke, /ZIP contains a prohibited/);
  assert.match(smoke, /FullName\.Replace/);
  assert.doesNotMatch(smoke, /\$Home\b/);
  assert.match(smoke, /cscript\.exe/);
  assert.match(smoke, /process\.arch/);
  assert.match(smoke, /v24\.14\.0/);
  assert.match(smoke, /The packaged data importer failed/);
  assert.match(smoke, /\$RejectedImportExitCode = \$LASTEXITCODE/);
  assert.match(smoke, /\$RejectedImportExitCode -ne 1/);
  assert.match(smoke, /\$global:LASTEXITCODE = 0/);
  assert.match(smoke, /failed packaged import changed existing data/);

  assert.match(importLauncher, /runtime\\node\.exe/);
  assert.match(importLauncher, /tools\\import-data\.mjs/);
  assert.doesNotMatch(importLauncher, /Copy-Item|ConvertFrom-Json/);

  assert.match(launcher, /%PORT%/);
  assert.match(launcher, /%ANTHROPOLOGY_CANTEEN_SKIP_OPEN%/);
  assert.match(launcher, /skipOpen <> "1"/);
  assert.match(launcher, /--auto-close/);
});

test("normal tags prepare all platform and source artifacts without publishing", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/portable-release.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /tags:\n\s+- "v\*\.\*\.\*"/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /Existing normal release tag/);
  assert.match(workflow, /ref: refs\/tags\/\$\{\{ env\.RELEASE_TAG \}\}/);
  assert.match(workflow, /\^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$/);
  assert.match(workflow, /RELEASE_TAG.*v\$\{VERSION\}/);
  assert.match(workflow, /source_sha=\$SOURCE_SHA/);
  assert.match(workflow, /ref: \$\{\{ needs\.validate-tag\.outputs\.source_sha \}\}/);
  assert.match(workflow, /Windows x64 native package and smoke test/);
  assert.match(workflow, /Join-Path \$PSHOME "pwsh\.exe"/);
  assert.match(workflow, /Windows portable smoke test failed/);
  assert.doesNotMatch(workflow, /\$global:LASTEXITCODE = 0/);
  assert.match(workflow, /runner: macos-15\n/);
  assert.match(workflow, /runner: macos-15-intel/);
  assert.match(workflow, /git archive --format=zip/);
  assert.equal(workflow.match(/uses: actions\/upload-artifact@v6/g)?.length, 3);
  assert.match(workflow, /permissions:\n\s+contents: read/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.doesNotMatch(
    workflow,
    /contents: write|git push|gh release|create-release|softprops\/action-gh-release|release-action/,
  );
});
