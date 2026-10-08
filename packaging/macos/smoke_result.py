"""Terminal evidence for the complete original-package native smoke path."""
import hashlib
import json
import os
from pathlib import Path
import sys

REQUIRED = ["archive-runtime-privacy", "keychain-roundtrip", "launchagent-install-remove", "offline-worker", "launcher", "server-persistence", "import", "sse-autoclose"]


def validate(value, source, arch, digest):
    expected = {"status": "pass", "productSHA": source, "arch": arch, "zipSHA256": digest, "checks": REQUIRED}
    if any(value.get(k) != v for k, v in expected.items()):
        raise ValueError("Missing, incomplete or mismatched native smoke completion evidence")


def main():
    package, archive, arch, report = sys.argv[1:]
    root = Path(package)
    metadata = next((root/n for n in ["release.json", "candidate.json"] if (root/n).exists()), None)
    source = json.loads(metadata.read_text())["sourceCommit"] if metadata else ""
    with Path(archive).open("rb") as stream: digest = hashlib.file_digest(stream, "sha256").hexdigest()
    value = {"status": "pass", "productSHA": source, "arch": arch, "zipSHA256": digest,
             "checks": os.environ["SMOKE_CHECKS"].split(","), "testSHA": os.environ.get("GITHUB_SHA"), "runID": os.environ.get("GITHUB_RUN_ID")}
    validate(value, source, arch, digest)
    target = Path(report); temporary = target.with_suffix(".writing")
    temporary.write_text(json.dumps(value, indent=2)+"\n", encoding="utf-8");temporary.replace(target)


if __name__ == "__main__": main()
