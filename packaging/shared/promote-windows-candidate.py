"""Repackage the unchanged Windows product with final release provenance."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import re
import subprocess
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("candidate", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()
repo = Path(__file__).resolve().parents[2]
def git(*arguments):
    return subprocess.check_output(["git", "-C", str(repo), *arguments], text=True).strip()
assert not git("status", "--porcelain", "--untracked-files=no"), "Tracked worktree must be clean"
sha = git("rev-parse", "HEAD")
assert re.fullmatch(r"[a-f0-9]{40}", sha)
base = "8a74e9059ad9832e5fef1d345cbb92e2581e9e0d"
changed = git("diff", "--name-only", base, sha).splitlines()
assert all(name.startswith(("docs/", "packaging/", ".github/")) or name in {"README.md", "CHANGELOG.md", "tests/release-packaging.test.mjs"} for name in changed), "Product changed; rebuild required"
name = "Anthropology-Canteen-Windows-x64-v1.3.4"
args.output.mkdir(parents=True, exist_ok=True)
target = args.output / (name + ".zip")
assert not target.exists() and not Path(str(target)+".sha256").exists(), "Do not overwrite existing final packages"
with zipfile.ZipFile(args.candidate) as source:
    old = name + "-candidate"
    metadata = json.loads(source.read(old + "/candidate.json"))
    assert metadata == dict(version="1.3.4", sourceCommit=base, platform="win32", arch="x64", status="unpublished-candidate", fullyVerified=False)
    with zipfile.ZipFile(target, "x", compression=zipfile.ZIP_DEFLATED) as final:
        for entry in source.infolist():
            assert entry.filename.startswith(old + "/"), "Unexpected archive root"
            relative = entry.filename[len(old)+1:]
            assert ".." not in Path(relative).parts and not relative.startswith("data/"), "Unsafe/private path"
            if relative in {"candidate.json", "CANDIDATE-NOTICE.txt"}:
                continue
            item = copy.copy(entry)
            item.filename = name + "/" + relative
            final.writestr(item, source.read(entry))
        metadata.update(sourceCommit=sha, status="published-with-limitations")
        final.writestr(name + "/release.json", json.dumps(metadata, indent=2))
        final.writestr(name + "/RELEASE-NOTICE.txt", (repo / "packaging/shared/RELEASE-NOTICE.txt").read_bytes())
# Only the new final ZIP is hashed, exactly once. The source ZIP is not rehashed.
with target.open("rb") as stream:
    digest = hashlib.file_digest(stream, "sha256").hexdigest()
Path(str(target)+".sha256").write_text(digest+"  "+target.name+"\n", encoding="utf-8")
print(target)
