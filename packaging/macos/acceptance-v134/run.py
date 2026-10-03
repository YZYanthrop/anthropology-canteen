"""Published v1.3.4 acceptance only: no product build, packaging or publication."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import signal
import stat
import subprocess
import sys
import urllib.request
import zipfile

PRODUCT_SHA = "bb78dd9431a61617c3198b087ac556759ef85333"
REPO = "YZYanthrop/anthropology-canteen"
BRANCH = "refs/heads/codex/v1.3.4-macos-acceptance"
PACKAGES = {
    "arm64": ("Anthropology-Canteen-macOS-Apple-Silicon-arm64-v1.3.4.zip", "e0489e02e8d6fcff20c7db4bc662a4f061b8a11c430296b119287afc2a466a03", 46530677),
    "x64": ("Anthropology-Canteen-macOS-Intel-x64-v1.3.4.zip", "b9577c9a391eab64481c9a8c4b896d297ddd2501d8dcdbe4ccb44f7895cedef3", 47734858),
}
HERE = Path(__file__).resolve().parent


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def api(endpoint):
    req = urllib.request.Request(f"https://api.github.com/repos/{REPO}/{endpoint}", headers={"Accept": "application/vnd.github+json", "User-Agent": "canteen-v134-acceptance"})
    with urllib.request.urlopen(req, timeout=45) as response:
        return json.load(response)


def verify_release(release, arch):
    name, digest, size = PACKAGES[arch]
    require(release.get("tag_name") == "v1.3.4" and not release.get("draft") and not release.get("prerelease"), "Published release identity changed")
    assets = {item["name"]: item for item in release["assets"]}
    require(name in assets and name + ".sha256" in assets, "Missing published package or checksum")
    asset = assets[name]
    require(asset["size"] == size and asset.get("digest") == "sha256:" + digest, "Published asset metadata changed")
    for filename in (name, name + ".sha256"):
        require(assets[filename]["browser_download_url"] == f"https://github.com/{REPO}/releases/download/v1.3.4/{filename}", "Unexpected asset URL")
    return assets


def verify_zip(path, arch):
    name, digest, size = PACKAGES[arch]
    require(path.name == name and path.stat().st_size == size, "Downloaded ZIP identity/size mismatch")
    with path.open("rb") as handle:
        actual = hashlib.file_digest(handle, "sha256").hexdigest()
    require(actual == digest, "Downloaded ZIP SHA256 mismatch")
    sidecar = Path(str(path) + ".sha256").read_text(encoding="utf-8-sig").strip()
    require(re.fullmatch(re.escape(digest) + r"\s+\*?" + re.escape(name), sidecar, re.I), "Sidecar does not match pinned ZIP")
    return actual


def extract_zip(path, destination):
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        require(len(names) == len(set(names)), "Duplicate ZIP entries")
        roots = set()
        for info in archive.infolist():
            part = PurePosixPath(info.filename)
            require(part.parts and not part.is_absolute() and ".." not in part.parts and "\\" not in info.filename and ":" not in info.filename, "Unsafe ZIP path")
            require(not stat.S_ISLNK(info.external_attr >> 16), "ZIP symlink rejected")
            roots.add(part.parts[0])
            target = destination.joinpath(*part.parts)
            if info.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(info))
                target.chmod((info.external_attr >> 16) & 0o777 or 0o644)
        require(len(roots) == 1, "ZIP needs one root")
        return (destination / next(iter(roots))).resolve()


def command(args, log, timeout=180):
    """Keep child logs; terminate timed-out child group before reporting."""
    log.parent.mkdir(parents=True, exist_ok=True)
    with log.open("w", encoding="utf-8") as output:
        child = subprocess.Popen([str(item) for item in args], stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            return child.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=20)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=10)
            output.write("\nHARNESS TIMEOUT; examine cleanup report.\n")
            return 124


def read_report(path, suite, code):
    try:
        result = json.loads(path.read_text(encoding="utf-8"))
        require(isinstance(result.get("cases"), list) and result["cases"], "Empty report")
        require(all(case.get("status") in {"pass", "fail", "pending"} for case in result["cases"]), "Unknown status")
        if code and not any(case["status"] == "fail" for case in result["cases"]):
            result["cases"].append({"id": suite + ".process", "category": "harness", "status": "fail", "details": f"Exit {code}; partial report is not success"})
        return result
    except Exception as error:
        return {"cases": [{"id": suite, "category": "harness", "status": "fail", "details": f"Exit {code}: {error}"}]}


def cleanup_scheduler(source, scratch, reports, node):
    if not (scratch / "scheduler").exists():
        return 0
    return command([node, HERE / "scheduler.mjs", "--source", source, "--scratch", scratch / "scheduler", "--report", reports / "scheduler-cleanup.json", "--cleanup"], reports / "scheduler-cleanup.log", 90)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--arch", choices=PACKAGES, required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--scratch", type=Path, required=True)
    parser.add_argument("--reports", type=Path, required=True)
    parser.add_argument("--cleanup", action="store_true")
    parser.add_argument("--suites", nargs="+", choices=["black-box", "scheduler", "migration", "ui"], default=["black-box", "scheduler", "migration", "ui"])
    parser.add_argument("--scheduler-cases", help="Comma-separated scheduler case IDs for an affected-only rerun")
    parser.add_argument("--case", help="One exact case in one selected native/UI suite; for affected-only reruns")
    args = parser.parse_args()
    require(not args.case or (len(args.suites) == 1 and args.suites[0] != "black-box"), "--case requires exactly one native/UI suite")
    require(not args.scheduler_cases or ("scheduler" in args.suites and not args.case), "--scheduler-cases requires scheduler suite and excludes --case")
    source, scratch, reports = (item.resolve() for item in (args.source, args.scratch, args.reports))
    reports.mkdir(parents=True, exist_ok=True)
    if args.cleanup:
        return cleanup_scheduler(source, scratch, reports, shutil.which("node") or "node")
    require(sys.platform == "darwin", "Native macOS required; do not simulate platform")
    require(os.environ.get("GITHUB_REF") == BRANCH, "Only acceptance branch may execute")
    require(os.environ.get("GITHUB_REPOSITORY") == REPO, "Wrong repository")
    require(not scratch.exists(), "Fresh scratch required; preserve previous fault evidence")
    scratch.mkdir(parents=True)
    result = {"productSHA": PRODUCT_SHA, "testSHA": os.environ.get("GITHUB_SHA"), "architecture": args.arch, "runURL": f"https://github.com/{REPO}/actions/runs/{os.environ.get('GITHUB_RUN_ID')}", "environment": {"uname": platform.uname()._asdict(), "macOS": platform.mac_ver()[0], "uid": os.getuid(), "runnerImage": os.environ.get("ImageVersion")}, "cases": [], "fullyVerified": False, "notCovered": ["Finder double-click / Gatekeeper dialogs", "Real login/logout, sleep/wake, full OS reboot", "Real email or providers", "Full three-platform regression"]}
    node = shutil.which("node") or "node"
    result["selection"] = {"suites": args.suites, "case": args.case, "schedulerCases": args.scheduler_cases}
    prepared = False
    try:
        sha = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
        require(sha == PRODUCT_SHA, "Source checkout is not published SHA")
        tag = api("git/ref/tags/v1.3.4")["object"]
        if tag["type"] == "tag":
            tag = api("git/tags/" + tag["sha"])["object"]
        require(tag["type"] == "commit" and tag["sha"] == PRODUCT_SHA, "Remote tag mismatch; stop")
        release = api("releases/tags/v1.3.4")
        assets = verify_release(release, args.arch)
        save(reports / "published-release.json", release)
        name = PACKAGES[args.arch][0]
        for filename in (name, name + ".sha256"):
            req = urllib.request.Request(assets[filename]["browser_download_url"], headers={"User-Agent": "canteen-v134-acceptance"})
            with urllib.request.urlopen(req, timeout=120) as response, (scratch / filename).open("wb") as target:
                shutil.copyfileobj(response, target)
        digest = verify_zip(scratch / name, args.arch)
        package = extract_zip(scratch / name, scratch / "published")
        metadata = json.loads((package / "release.json").read_text(encoding="utf-8-sig"))
        require(all(metadata.get(key) == value for key, value in {"version": "1.3.4", "sourceCommit": PRODUCT_SHA, "platform": "darwin", "arch": args.arch, "fullyVerified": False, "status": "published-with-limitations"}.items()), "release.json mismatch")
        node = package / "runtime/bin/node"
        runtime = json.loads(subprocess.check_output([str(node), "-p", "JSON.stringify({platform:process.platform,arch:process.arch,version:process.version})"], text=True))
        require(runtime == {"platform": "darwin", "arch": args.arch, "version": "v24.14.0"}, "Embedded runtime mismatch")
        require(platform.machine() == {"arm64": "arm64", "x64": "x86_64"}[args.arch], "Runner architecture mismatch")
        modules = ["portable-server.mjs", "reminder-scheduler.mjs", "reminder-utils.mjs", "reminder-worker.mjs"]
        for module in modules:
            require((package / module).read_bytes() == (source / module).read_bytes(), "Published/source mismatch: " + module)
        result["cases"].append({"id": "baseline", "category": "published-black-box", "status": "pass", "details": {"sha256": digest, "release": metadata, "runtime": runtime, "modulesMatchSource": modules}})
        prepared = True
        if "black-box" in args.suites:
            code = command([sys.executable, source / "packaging/shared/candidate-smoke.py", scratch / name, "--release", "--platform", "darwin", "--arch", args.arch, "--source-sha", PRODUCT_SHA, "--report", reports / "published-black-box.json"], reports / "published-black-box.log", 240)
            result["cases"].append({"id": "published.start-page-save-restart", "category": "published-black-box", "status": "pass" if code == 0 and (reports / "published-black-box.json").exists() else "fail", "details": "Unmodified published ZIP; see published-black-box.json/log. No credentials, worker, scheduler or providers invoked."})
        for suite, timeout in (("scheduler", 720), ("migration", 300), ("ui", 240)):
            if suite not in args.suites:
                continue
            params = ["--package", package] if suite == "ui" else ["--source", source]
            selected_case = args.case or (args.scheduler_cases if suite == "scheduler" else None)
            if selected_case:
                params += ["--case", selected_case]
            code = command([node, HERE / (suite + ".mjs"), *params, "--scratch", scratch / suite, "--report", reports / (suite + ".json")], reports / (suite + ".log"), timeout)
            child = read_report(reports / (suite + ".json"), suite, code)
            result["cases"].extend(child["cases"])
            result[suite + "Environment"] = child.get("environment", {})
            result[suite + "Cleanup"] = child.get("cleanup", {})
    except Exception as error:
        result["cases"].append({"id": "harness", "category": "harness", "status": "fail", "details": str(error)})
        if not prepared:
            result["cases"].append({"id": "acceptance-not-started", "category": "harness", "status": "pending", "details": "Baseline/environment check failed; no product test accepted"})
    finally:
        try:
            cleanup_code = cleanup_scheduler(source, scratch, reports, node)
        except Exception as error:
            cleanup_code = 1
            save(reports / "cleanup-command-error.json", {"error": str(error)})
        result["cases"].append({"id": "scheduler.final-cleanup-command", "category": "harness", "status": "pass" if cleanup_code == 0 else "fail", "details": f"Exit {cleanup_code}; exact registered identities only; see cleanup report."})
        result["counts"] = {status: sum(case["status"] == status for case in result["cases"]) for status in ("pass", "fail", "pending")}
        save(reports / "summary.json", result)
        lines = [f"# macOS {args.arch} limited acceptance", "", f"Product: {PRODUCT_SHA}; tests: {result['testSHA']}", f"Run: {result['runURL']}", "", "| Case | Evidence category | Result |", "| --- | --- | --- |"]
        lines += [f"| {case['id']} | {case['category']} | {case['status']} |" for case in result["cases"]]
        lines += ["", "Not fully Verified. See JSON/logs and explicit pending / notCovered items."]
        (reports / "SUMMARY.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
        if os.environ.get("GITHUB_STEP_SUMMARY"):
            with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as handle:
                handle.write("\n".join(lines) + "\n")
    return 1 if result["counts"]["fail"] else 0


if __name__ == "__main__":
    sys.exit(main())
