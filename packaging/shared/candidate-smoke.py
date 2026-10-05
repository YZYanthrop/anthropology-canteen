"""Final ZIP identity/privacy and offline black-box checks; r1 recomputes SHA256.
No scheduled jobs are created, no mail is sent, and only synthetic data is used.
"""
import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import socket
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid
import zipfile

WARNING = "macOS 版为实验性版本，尚未完成 v1.3.4 的 macOS 原生验收，后台提醒、资料迁移及失败恢复仍存在未验证风险。升级前请保留旧版文件夹和资料备份。"


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


@contextmanager
def inspection_workspace(report):
    # Retain only synthetic failure material; never copy the complete runtime or
    # a personal source folder. Active child processes are stopped by their own
    # finally blocks before this context handles a failure.
    with tempfile.TemporaryDirectory(prefix="canteen-candidate-") as temp:
        workspace = Path(temp).resolve()
        try:
            yield workspace
        except Exception as error:
            evidence = report.with_suffix(".failure-evidence")
            evidence.mkdir(parents=True, exist_ok=True)
            files = []
            for source in workspace.rglob("*"):
                if source.is_file() and (source.name == "server.log" or "data" in source.relative_to(workspace).parts):
                    relative = source.relative_to(workspace)
                    target = evidence / relative
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(source.read_bytes())
                    files.append(str(relative))
            (evidence / "failure.json").write_text(json.dumps({"status": "failed", "error": str(error).replace(str(workspace), "<synthetic-workspace>"), "files": files,
                "scope": "Synthetic final-ZIP acceptance failure; not a passing report"}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("zip", type=Path)
    parser.add_argument("--platform", choices=["win32", "darwin"], required=True)
    parser.add_argument("--arch", choices=["x64", "arm64"], required=True)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--inspect-only", action="store_true")
    parser.add_argument("--release", action="store_true", help="Check published-with-limitations release markers")
    parser.add_argument("--version", choices=["1.3.4"], default="1.3.4")
    parser.add_argument("--internal-validation", action="store_true", help="Check unpublished internal candidate, never release assets")
    parser.add_argument("--reissue", action="store_true", help="Check final 1.3.4-r1 prepared release bytes")
    args = parser.parse_args()
    require(sum([args.reissue, args.release, args.internal_validation]) <= 1, "Conflicting package modes")
    require(not (args.internal_validation and args.release), "Internal validation cannot check or impersonate a release")
    require(not args.release or args.version == "1.3.4", "Release exception is scoped to v1.3.4")
    require(re.fullmatch(r"[0-9a-f]{40}", args.source_sha), "Invalid source commit")
    checks = []
    sidecar = Path(str(args.zip) + ".sha256").read_text(encoding="utf-8-sig").strip()
    require(re.fullmatch(r"[0-9a-fA-F]{64}\s+\*?" + re.escape(args.zip.name), sidecar), "Invalid sidecar filename/format")
    if args.reissue:
        with args.zip.open("rb") as handle:
            digest = hashlib.file_digest(handle, "sha256").hexdigest()
        require(digest == sidecar.split()[0].lower(), "Reissue ZIP SHA256 mismatch")
        checks.append("Final ZIP SHA256 matches original sidecar")
    else:
        checks.append("SHA sidecar filename/format only; digest not recomputed")
    with inspection_workspace(args.report) as destination:
        # Use canonical paths because macOS /var aliases /private/var.
        with zipfile.ZipFile(args.zip) as archive:
            entries = archive.infolist()
            names = [entry.filename for entry in entries]
            require(len(set(names)) == len(names), "Duplicate ZIP entries")
            roots = {PurePosixPath(name).parts[0] for name in names if name}
            require(len(roots) == 1, "ZIP must contain one root")
            for entry in entries:
                path = PurePosixPath(entry.filename)
                require(not path.is_absolute() and ".." not in path.parts and "\\" not in entry.filename and ":" not in entry.filename, "Unsafe ZIP path")
                require(not stat.S_ISLNK(entry.external_attr >> 16), "Symlink in ZIP")
                forbidden = re.compile(r"^(data|node_modules|\.git|\.cache|\.pnpm-store|\.next|\.vinext|\.wrangler|\.env.*|.*\.pid)$", re.I)
                require(not any(forbidden.fullmatch(part) for part in path.parts[1:]), "Private/generated ZIP entry")
                require(not re.search(r"anthropology-canteen-(data|settings|reminder-state)\.json$", entry.filename, re.I), "Private data file")
                target = destination.joinpath(*path.parts)
                if entry.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                data = archive.read(entry)  # ZIP CRC checked while reading, no additional hashing.
                if target.suffix.lower() in {".js", ".mjs", ".json", ".txt", ".html", ".css", ".ps1", ".cmd", ".vbs", ".command", ".sh"}:
                    text = data.decode("utf-8", errors="replace")
                    require(not re.search(r"(?:[A-Z]:[\\/]+Users[\\/]+|/Users/|/home/)[A-Za-z0-9_.-]+", text), "Personal path in package text")
                    require(not re.search(r"ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----", text), "Secret marker in package text")
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
                if os.name != "nt":
                    target.chmod((entry.external_attr >> 16) & 0o777 or 0o644)
        root = destination / next(iter(roots))
        metadata = json.loads((root / ("release.json" if args.release or args.reissue else "candidate.json")).read_text(encoding="utf-8-sig"))
        for key, value in {"version": args.version, "sourceCommit": args.source_sha, "platform": args.platform, "arch": args.arch, "status": "prepared-for-release" if args.reissue else "published-with-limitations" if args.release else "unpublished-candidate", "fullyVerified": False}.items():
            require(metadata.get(key) == value, "Candidate metadata mismatch: " + key)
        if args.reissue:
            target = "Windows-x64" if args.platform == "win32" and args.arch == "x64" else "macOS-" + {"arm64": "Apple-Silicon-arm64", "x64": "Intel-x64"}[args.arch]
            require(args.platform != "win32" or args.arch == "x64", "Unsupported Windows architecture")
            expected_root = "Anthropology-Canteen-" + target + "-v1.3.4-r1"
            require(root.name == expected_root and args.zip.name == expected_root + ".zip", "Reissue root/filename mismatch")
            for key, value in {"releaseRevision": "r1", "artifactVersion": "1.3.4-r1", "verificationScope": "three-platform-limited-reissue"}.items():
                require(metadata.get(key) == value, "Reissue metadata mismatch: " + key)
        warning = WARNING if not args.internal_validation else "macOS 候选版仅按本轮报告进行有限范围验收，尚未宣称完整原生认证或整个版本 Verified。升级前请保留旧版文件夹和资料备份。"
        if args.reissue:
            warning = "REISSUE r1 — prepared artifact"
        require(warning in (root / ("RELEASE-NOTICE.txt" if args.release or args.reissue else "CANDIDATE-NOTICE.txt")).read_text(encoding="utf-8-sig"), "Missing experimental warning")
        if args.internal_validation:
            require("INTERNAL VALIDATION ONLY" in (root / "CANDIDATE-NOTICE.txt").read_text(encoding="utf-8-sig"), "Missing internal-only marker")
            require(not (root / "release.json").exists() and not (root / "RELEASE-NOTICE.txt").exists(), "Internal candidate contains release markers")
        if args.release or args.reissue:
            require(not (root / "candidate.json").exists() and not (root / "CANDIDATE-NOTICE.txt").exists() and not root.name.endswith("-candidate"), "Stale candidate markers")
        node = root / ("runtime/node.exe" if args.platform == "win32" else "runtime/bin/node")
        required = [node, root / "portable-server.mjs", root / "dist/server/index.js", root / "reminder-worker.mjs", root / "tools/import-data.mjs", root / "LICENSE"]
        if args.platform == "darwin":
            required += [root / "Anthropology Canteen.command", root / "tools/anthropology-canteen-keychain"]
            require(all(path.stat().st_mode & 0o111 for path in required[-2:] + [node]) if os.name != "nt" else True, "Missing executable permission")
        require(all(path.is_file() for path in required), "Missing package file")
        require(not (root / "data").exists(), "Initial archive contains data")
        checks += ["ZIP structure, CRC, blank data, text privacy", "Source/version/platform metadata and experimental notice"]
        if not args.inspect_only:
            require(sys.platform == args.platform, "Native host platform mismatch")
            flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
            runtime = json.loads(subprocess.check_output([str(node), "-p", "JSON.stringify({platform:process.platform,arch:process.arch,version:process.version})"], creationflags=flags, text=True))
            require(runtime == {"platform": args.platform, "arch": args.arch, "version": "v24.14.0"}, "Embedded runtime mismatch")
            with socket.socket() as reservation:
                reservation.bind(("127.0.0.1", 0))
                port = reservation.getsockname()[1]
            base = "http://127.0.0.1:" + str(port)
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            token = ""

            def request(path, body=None):
                headers = {"X-Anthropology-Canteen-Session": token}
                payload = None
                if body is not None:
                    headers["Content-Type"] = "application/json"
                    payload = json.dumps(body).encode()
                req = urllib.request.Request(base + path, data=payload, headers=headers, method="PATCH" if body is not None else "GET")
                return opener.open(req, timeout=5)

            old_files = {}
            for round_number in range(6 if args.reissue else 2):
                if round_number == 2:
                    original_root = root
                    upgrade_parent = destination / "upgrade"
                    upgrade_parent.mkdir()
                    old_root = upgrade_parent / root.name.removesuffix("-r1")
                    old_data = old_root / "data"
                    old_data.mkdir(parents=True)
                    old_value = json.loads((root / "data/anthropology-canteen-data.json").read_text(encoding="utf-8-sig"))
                    old_value["states"] = {"r1-upgrade": {"saved": True, "read": True}}
                    old_value["subscriptions"] = {
                        "scholar": [{"label": "Synthetic upgrade scholar", "subscriptionId": "manual:r1-upgrade", "followedAt": "2026-01-01T00:00:00.000Z"}],
                        "journal": [{"label": "Synthetic upgrade journal", "issn": "1234-5678", "followedAt": "2026-01-01T00:00:00.000Z"}],
                        "keyword": [{"root": "migration", "variants": ["migrations"], "followedAt": "2026-01-01T00:00:00.000Z"}],
                    }
                    fixtures = {
                        "anthropology-canteen-data.json": old_value,
                        "anthropology-canteen-settings.json": {"version": 3, "openAlexApiKey": "synthetic-r1-key", "semanticScholarApiKey": "synthetic-r1-semantic-key", "reminders": {"enabled": False}},
                        "anthropology-canteen-reminder-state.json": {"version": 2, "baselineComplete": True, "baselines": {}, "items": {"r1-upgrade": {"sentAt": "2026-01-02T00:00:00.000Z"}}},
                    }
                    for filename, value in fixtures.items():
                        file = old_data / filename
                        file.write_text(json.dumps(value), encoding="utf-8")
                        old_files[file] = file.read_bytes()
                    root = upgrade_parent / original_root.name
                    shutil.copytree(original_root, root, ignore=lambda _path, names: ["data"] if "data" in names else [])
                if round_number == 3:
                    newer = root.parent / "synthetic-newer-source" / "data"
                    newer.mkdir(parents=True)
                    other = dict(old_value, states={"must-not-overwrite": {"saved": True}}, savedAt="2099-01-01T00:00:00.000Z")
                    (newer / "anthropology-canteen-data.json").write_text(json.dumps(other), encoding="utf-8")
                if round_number == 4:
                    # A blank target follows the product's newest-saved-data rule.
                    root = upgrade_parent / "multiple-sources" / original_root.name
                    root.parent.mkdir()
                    for source_name, value in [("old-v1.3.4", old_value), ("later-v1.3.4", other)]:
                        source = root.parent / source_name / "data"
                        source.mkdir(parents=True)
                        file = source / "anthropology-canteen-data.json"
                        file.write_text(json.dumps(value), encoding="utf-8")
                        old_files[file] = file.read_bytes()
                    shutil.copytree(original_root, root, ignore=lambda _path, names: ["data"] if "data" in names else [])
                if round_number == 5:
                    # Existing data must not pick an ambiguous reminder identity.
                    root = destination / "ambiguous-backfill" / original_root.name
                    root.parent.mkdir()
                    shutil.copytree(original_root, root, ignore=lambda _path, names: ["data"] if "data" in names else [])
                    identity = str(uuid.uuid4())
                    ambiguous_settings = {"version": 3, "openAlexApiKey": "", "semanticScholarApiKey": "", "reminders": {
                        "enabled": False, "installationId": identity, "credentialRef": identity,
                        "provider": "custom", "sender": "synthetic@example.invalid", "recipient": "synthetic@example.invalid",
                        "host": "127.0.0.1", "port": 1, "security": "tls", "username": "synthetic@example.invalid",
                    }}
                    for name in ["old-a-v1.3.4", "old-b-v1.3.4", root.name]:
                        target_data = root.parent / name / "data"
                        target_data.mkdir(parents=True)
                        values = {"anthropology-canteen-data.json": old_value, "anthropology-canteen-settings.json": ambiguous_settings}
                        if name != root.name:
                            values["anthropology-canteen-reminder-state.json"] = fixtures["anthropology-canteen-reminder-state.json"]
                        for filename, value in values.items():
                            file = target_data / filename
                            file.write_text(json.dumps(value), encoding="utf-8")
                            old_files[file] = file.read_bytes()
                env = dict(os.environ, PORT=str(port))
                with open(destination / "server.log", "ab") as log:
                    process = subprocess.Popen([str(node), str(root / "portable-server.mjs")], cwd=root, env=env, stdout=log, stderr=log, creationflags=flags)
                    try:
                        for attempt in range(120):
                            if process.poll() is not None:
                                detail = (destination / "server.log").read_text(encoding="utf-8", errors="replace")[-4000:]
                                detail = detail.replace(str(destination), "<temporary-candidate>")
                                raise RuntimeError("Portable server exited before readiness (exit " + str(process.returncode) + "): " + detail)
                            try:
                                with request("/api/runtime-status") as response:
                                    status = json.load(response)
                                token = status["sessionToken"]
                                require(status["app"] == "anthropology-canteen", "Wrong server")
                                break
                            except (OSError, KeyError):
                                time.sleep(0.25)
                        else:
                            raise RuntimeError("Portable server readiness timed out")
                        with request("/api/local-data") as response:
                            data = json.load(response)
                        require(data["version"] == 8, "Wrong data schema")
                        if round_number == 0:
                            require(all(not values for values in data["subscriptions"].values()) and not data["states"], "Initial data is not blank")
                            with request("/api/local-settings") as response:
                                settings = json.load(response)
                            require(settings["version"] == 3 and all(settings[key] is False for key in ["openAlexConfigured", "semanticScholarConfigured", "remindersConfigured", "remindersEnabled"]), "Initial settings not blank")
                            with request("/") as response:
                                require("no-store" in response.headers.get("Cache-Control", ""), "HTML caching mismatch")
                                html = response.read().decode()
                            assets = set(re.findall(r'(?:src|href)="(/[^"?#]+\.(?:js|css))"', html))
                            require(any(p.endswith(".js") for p in assets) and any(p.endswith(".css") for p in assets), "Missing compiled assets")
                            for asset in assets:
                                with request(asset) as response:
                                    response.read()
                            with request("/api/local-data", {"patch": {"states": {"candidate-smoke": {"saved": True}}}}) as response:
                                require(json.load(response)["states"]["candidate-smoke"]["saved"], "Synthetic write failed")
                        elif round_number == 1:
                            require(data["states"]["candidate-smoke"]["saved"], "Synthetic state did not persist")
                        elif round_number in (2, 3):
                            require(data["states"].get("r1-upgrade", {}).get("saved") is True, "Old v1.3.4 synthetic state was not migrated/persisted")
                            require(data["states"]["r1-upgrade"]["read"] is True, "Read state lost on revision upgrade")
                            require(data["subscriptions"]["scholar"][0]["subscriptionId"] == "manual:r1-upgrade", "Scholar identity lost on revision upgrade")
                            require(data["subscriptions"]["journal"][0]["issn"] == "1234-5678", "Journal subscription lost on revision upgrade")
                            require(data["subscriptions"]["keyword"][0]["root"] == "migration", "Keyword subscription lost on revision upgrade")
                            for kind in ("scholar", "journal", "keyword"):
                                require(data["subscriptions"][kind][0]["followedAt"] == "2026-01-01T00:00:00.000Z", "Follow date lost on same-version revision upgrade: " + kind)
                            require("must-not-overwrite" not in data["states"], "Existing new data overwritten by another source")
                            migrated_settings = json.loads((root / "data/anthropology-canteen-settings.json").read_text(encoding="utf-8-sig"))
                            require(migrated_settings["version"] == 3 and migrated_settings["openAlexApiKey"] == "synthetic-r1-key" and migrated_settings["semanticScholarApiKey"] == "synthetic-r1-semantic-key" and migrated_settings["reminders"]["enabled"] is False, "Synthetic settings lost on revision upgrade")
                            ledger = json.loads((root / "data/anthropology-canteen-reminder-state.json").read_text(encoding="utf-8-sig"))
                            require(ledger["version"] == 2 and ledger["items"]["r1-upgrade"]["sentAt"] == "2026-01-02T00:00:00.000Z", "Sent ledger lost on revision upgrade")
                        elif round_number == 4:
                            require(data["states"].get("must-not-overwrite", {}).get("saved") is True and "r1-upgrade" not in data["states"], "Multiple-source selection did not choose newest saved data")
                        elif round_number == 5:
                            with request("/api/reminders/status") as response:
                                reminder_status = json.load(response)
                            require(reminder_status["reminderMigration"] == {"outcome": "manual-import-required", "reason": "ambiguous-source"}, "Ambiguous source lacks accurate manual-import prompt")
                            require(not (root / "data/anthropology-canteen-reminder-state.json").exists(), "Ambiguous source copied delivery history")
                            require(not (root / "data/anthropology-canteen-reminder-secret.json").exists(), "Ambiguous source copied credentials")
                        for file, original in old_files.items():
                            require(file.read_bytes() == original, "Old source or protected current data modified")
                    finally:
                        if process.poll() is None:
                            process.terminate()
                            try:
                                process.wait(timeout=10)
                            except subprocess.TimeoutExpired:
                                process.kill()
                                process.wait(timeout=10)
            if args.reissue:
                explicit_root = destination / "explicit-import" / original_root.name
                shutil.copytree(original_root, explicit_root, ignore=lambda _path, names: ["data"] if "data" in names else [])
                subprocess.run([str(node), str(explicit_root / "tools/import-data.mjs"), "--source", str(old_data), "--target-root", str(explicit_root)], check=True, capture_output=True, timeout=30, creationflags=flags)
                imported = json.loads((explicit_root / "data/anthropology-canteen-data.json").read_text(encoding="utf-8-sig"))
                require(imported == old_value, "Explicit v1.3.4 to r1 import lost data fields")
                for filename in ("anthropology-canteen-settings.json", "anthropology-canteen-reminder-state.json"):
                    require((explicit_root / "data" / filename).read_bytes() == (old_data / filename).read_bytes(), "Explicit import lost companion: " + filename)
                for file, original in old_files.items():
                    require(file.read_bytes() == original, "Explicit import changed old source")
                checks += ["Old v1.3.4 to r1 automatic migration and explicit import; all subscription kinds/follow dates/read and saved states/settings/sent ledger preserved; old sources untouched; restart and nonempty-target protection", "Multiple-source newest-data selection and ambiguous reminder-identity manual-import prompt without overwriting current data"]
            checks += ["Native embedded runtime", "Final ZIP server startup, local assets, blank schemas 8/3", "Synthetic saved-state persistence after restart"]
    if args.reissue:
        with args.zip.open("rb") as handle:
            require(hashlib.file_digest(handle, "sha256").hexdigest() == digest, "Final ZIP bytes changed during acceptance")
    report = {"evidenceCategory": "archive-inspection" if args.inspect_only else "unchanged-final-zip-black-box", "nativeRuntimeExecuted": not args.inspect_only, "releaseRevision": "r1" if args.reissue else None, "packageSHA256": digest if args.reissue else None, "sourceCommit": args.source_sha, "package": args.zip.name, "platform": args.platform, "arch": args.arch, "status": "limited-checks-passed", "checks": checks, "fullyVerified": False, "notCovered": ["OS launcher interaction", "Native scheduler/credential/recovery cases are separate acceptance reports", "Windows alternate administrator, task-read ACL denial and real UAC require separate native evidence", "Mail delivery and live providers"]}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
