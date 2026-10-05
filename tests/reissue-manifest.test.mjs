import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { metadata, packageRoot, validateMetadata } from "../packaging/shared/reissue-manifest.mjs";
const sha = "a".repeat(40);
test("r1 identity keeps product version separate and locks each native architecture", () => {
  for (const [platform, arch] of [["win32", "x64"], ["darwin", "arm64"], ["darwin", "x64"]]) {
    const value = metadata("1.3.4", sha, platform, arch);
    assert.equal(value.version, "1.3.4");
    assert.equal(value.releaseRevision, "r1");
    assert.equal(value.artifactVersion, "1.3.4-r1");
    assert.equal(value.fullyVerified, false);
    assert.equal(value.status, "prepared-for-release");
    assert.match(packageRoot(platform, arch), /-v1\.3\.4-r1$/);
    assert.doesNotThrow(() => validateMetadata(value, sha, platform, arch));
  }
});
test("r1 rejects wrong version, short source, wrong architecture and stale candidates", () => {
  assert.throws(() => metadata("1.3.5", sha, "darwin", "arm64"));
  assert.throws(() => metadata("1.3.4", "abc123", "darwin", "arm64"));
  assert.throws(() => metadata("1.3.4", sha, "win32", "arm64"));
  const good = metadata("1.3.4", sha, "darwin", "arm64");
  for (const [key, value] of [["version", "1.3.5"], ["releaseRevision", "r2"], ["sourceCommit", "b".repeat(40)], ["status", "unpublished-candidate"], ["fullyVerified", true], ["arch", "x64"]]) {
    assert.throws(() => validateMetadata({ ...good, [key]: value }, sha, "darwin", "arm64"));
  }
});

// Exercise the real CLI in an isolated synthetic Git repository, not this task's
// dirty checkout. No build, package runtime, network or scheduler is involved.
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "canteen-r1-manifest-"));
  mkdirSync(join(root, "packaging", "shared"), { recursive: true });
  for (const filename of ["reissue-manifest.mjs", "REISSUE-NOTICE.txt"]) {
    copyFileSync(new URL(`../packaging/shared/${filename}`, import.meta.url), join(root, "packaging", "shared", filename));
  }
  writeFileSync(join(root, "package.json"), JSON.stringify({ version: "1.3.4" }));
  writeFileSync(join(root, ".gitignore"), "/release/\n");
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true });
  git("init", "--quiet");
  git("config", "core.autocrlf", "false");
  git("config", "user.name", "Synthetic fixture");
  git("config", "user.email", "synthetic@example.invalid");
  git("add", ".");
  git("-c", "commit.gpgSign=false", "commit", "--quiet", "-m", "Synthetic fixture");
  return { root, sha: git("rev-parse", "HEAD").trim() };
}
function stage(root, platform, arch) {
  const directory = join(root, "release", packageRoot(platform, arch));
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, platform === "win32" ? "README-Windows.txt" : "README-macOS.txt"), "Synthetic readme\n");
  return directory;
}
function run(root, directory, platform, arch, more = []) {
  return spawnSync(process.execPath, [join(root, "packaging", "shared", "reissue-manifest.mjs"), "--stage", directory, "--platform", platform, "--arch", arch, ...more], { encoding: "utf8", windowsHide: true });
}
test("manifest CLI stamps the exact clean commit on all three staging roots", () => {
  const f = fixture();
  try {
    for (const [platform, arch] of [["win32", "x64"], ["darwin", "arm64"], ["darwin", "x64"]]) {
      const directory = stage(f.root, platform, arch);
      const result = run(f.root, directory, platform, arch);
      assert.equal(result.status, 0, result.stderr);
      validateMetadata(JSON.parse(readFileSync(join(directory, "release.json"), "utf8")), f.sha, platform, arch);
      assert.match(readFileSync(join(directory, "RELEASE-NOTICE.txt"), "utf8"), /REISSUE r1 — prepared artifact/);
    }
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
test("manifest CLI rejects dirty or untracked sources and stale/incorrect staging before writing identity", () => {
  for (const defect of ["tracked", "untracked", "wrong-root", "candidate", "missing-readme", "wrong-version", "unknown-argument"]) {
    const f = fixture();
    try {
      let directory = stage(f.root, "win32", "x64");
      if (defect === "tracked") writeFileSync(join(f.root, "package.json"), '{"version":"1.3.4","dirty":true}');
      if (defect === "untracked") writeFileSync(join(f.root, "untracked-product.mjs"), "// synthetic change");
      if (defect === "wrong-root") { directory = join(f.root, "release", "wrong-root"); mkdirSync(directory); }
      if (defect === "candidate") writeFileSync(join(directory, "candidate.json"), "{}");
      if (defect === "missing-readme") rmSync(join(directory, "README-Windows.txt"));
      if (defect === "wrong-version") {
        writeFileSync(join(f.root, "package.json"), '{"version":"1.3.5"}');
        execFileSync("git", ["-C", f.root, "-c", "commit.gpgSign=false", "commit", "-am", "Wrong synthetic version", "--quiet"], { windowsHide: true });
      }
      const result = run(f.root, directory, "win32", "x64", defect === "unknown-argument" ? ["--source", "arbitrary"] : []);
      assert.notEqual(result.status, 0, defect);
      assert.equal(existsSync(join(directory, "release.json")), false, defect);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }
});
