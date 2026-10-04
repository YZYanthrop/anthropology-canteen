"""Limited final-ZIP checks. No scheduler, credentials, providers, or ZIP rehash."""
import argparse
import json
import os
from pathlib import Path, PurePosixPath
import re
import socket
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile

WARNING = "macOS 版为实验性版本，尚未完成 v1.3.4 的 macOS 原生验收，后台提醒、资料迁移及失败恢复仍存在未验证风险。升级前请保留旧版文件夹和资料备份。"


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("zip", type=Path)
    parser.add_argument("--platform", choices=["win32", "darwin"], required=True)
    parser.add_argument("--arch", choices=["x64", "arm64"], required=True)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--inspect-only", action="store_true")
    parser.add_argument("--release", action="store_true", help="Check published-with-limitations release markers")
    parser.add_argument("--version", choices=["1.3.4", "1.3.5"], default="1.3.4")
    args = parser.parse_args()
    require(not args.release or args.version == "1.3.4", "Release exception is scoped to v1.3.4")
    require(re.fullmatch(r"[0-9a-f]{40}", args.source_sha), "Invalid source commit")
    checks = []
    sidecar = Path(str(args.zip) + ".sha256").read_text(encoding="utf-8-sig").strip()
    require(re.fullmatch(r"[0-9a-fA-F]{64}\s+\*?" + re.escape(args.zip.name), sidecar), "Invalid sidecar filename/format")
    checks.append("SHA sidecar filename/format only; digest not recomputed")
    with tempfile.TemporaryDirectory(prefix="canteen-candidate-") as temp:
        # macOS /var is a symlink to /private/var. Node resolves the module path,
        # so pass the same canonical path when checking the direct entry point.
        destination = Path(temp).resolve()
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
        metadata = json.loads((root / ("release.json" if args.release else "candidate.json")).read_text(encoding="utf-8-sig"))
        for key, value in {"version": args.version, "sourceCommit": args.source_sha, "platform": args.platform, "arch": args.arch, "status": "published-with-limitations" if args.release else "unpublished-candidate", "fullyVerified": False}.items():
            require(metadata.get(key) == value, "Candidate metadata mismatch: " + key)
        warning = WARNING if args.version == "1.3.4" else "macOS 候选版仅按本轮报告进行有限范围验收，尚未宣称完整原生认证或整个版本 Verified。升级前请保留旧版文件夹和资料备份。"
        require(warning in (root / ("RELEASE-NOTICE.txt" if args.release else "CANDIDATE-NOTICE.txt")).read_text(encoding="utf-8-sig"), "Missing experimental warning")
        if args.release:
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

            for round_number in range(2):
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
                        else:
                            require(data["states"]["candidate-smoke"]["saved"], "Synthetic state did not persist")
                    finally:
                        if process.poll() is None:
                            process.terminate()
                            try:
                                process.wait(timeout=10)
                            except subprocess.TimeoutExpired:
                                process.kill()
                                process.wait(timeout=10)
            checks += ["Native embedded runtime", "Final ZIP server startup, local assets, blank schemas 8/3", "Synthetic saved-state persistence after restart"]
    report = {"sourceCommit": args.source_sha, "package": args.zip.name, "platform": args.platform, "arch": args.arch, "status": "limited-checks-passed", "checks": checks, "fullyVerified": False, "notCovered": ["OS launcher interaction", "macOS reminder scheduling, migration and recovery", "Windows alternate administrator, task-read ACL denial, cancellation with existing task", "Mail delivery and live providers"]}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
