import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export function packageRoot(platform, arch) {
  assert.ok((platform === "win32" && arch === "x64") || (platform === "darwin" && ["arm64", "x64"].includes(arch)), "Unsupported r1 platform/architecture");
  const target = platform === "win32" ? "Windows-x64" : `macOS-${arch === "arm64" ? "Apple-Silicon-arm64" : "Intel-x64"}`;
  return `Anthropology-Canteen-${target}-v1.3.4-r1`;
}
export function metadata(version, sha, platform, arch) {
  assert.equal(version, "1.3.4", "Reissue is scoped to product 1.3.4");
  assert.match(sha, /^[a-f0-9]{40}$/, "Full frozen source SHA required");
  packageRoot(platform, arch);
  return { version, releaseRevision: "r1", artifactVersion: "1.3.4-r1", sourceCommit: sha, platform, arch,
    status: "prepared-for-release", fullyVerified: false, verificationScope: "three-platform-limited-reissue" };
}
export function validateMetadata(value, sha, platform, arch) {
  for (const [key, expected] of Object.entries(metadata("1.3.4", sha, platform, arch))) {
    assert.equal(value[key], expected, `Reissue metadata mismatch: ${key}`);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { stage: { type: "string" }, platform: { type: "string" }, arch: { type: "string" } } });
  assert.ok(values.stage, "Required --stage directory");
  const expectedRoot = packageRoot(values.platform, values.arch);
  const stage = resolve(values.stage);
  assert.equal(stage.split(/[\\/]/).at(-1), expectedRoot, "Reissue staging directory name mismatch");
  assert.ok(lstatSync(stage).isDirectory() && !lstatSync(stage).isSymbolicLink(), "Stage must be an existing ordinary directory");
  assert.ok(!existsSync(join(stage, "candidate.json")) && !existsSync(join(stage, "CANDIDATE-NOTICE.txt")), "Remove stale candidate markers before r1 staging");
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const sha = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["-C", repo, "status", "--porcelain", "--untracked-files=normal"], { encoding: "utf8" });
  assert.equal(dirty.trim(), "", "Frozen source must have no tracked or untracked changes (ignored build output is allowed)");
  const version = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version;
  const value = metadata(version, sha, values.platform, values.arch);
  const readme = join(stage, values.platform === "win32" ? "README-Windows.txt" : "README-macOS.txt");
  const text = readFileSync(readme, "utf8").replace("macOS 候选版仅按本轮报告进行有限范围验收，尚未宣称完整原生认证或整个版本 Verified。升级前请保留旧版文件夹和资料备份。", "本包为 1.3.4 三平台修订发行 r1；准确来源见 release.json，验证范围与限制见 RELEASE-NOTICE.txt。");
  // Read every required input before mutating the staging directory.
  readFileSync(join(repo, "packaging/shared/REISSUE-NOTICE.txt"), "utf8");
  writeFileSync(join(stage, "release.json"), JSON.stringify(value, null, 2) + "\n");
  copyFileSync(join(repo, "packaging/shared/REISSUE-NOTICE.txt"), join(stage, "RELEASE-NOTICE.txt"));
  writeFileSync(readme, text);
}
