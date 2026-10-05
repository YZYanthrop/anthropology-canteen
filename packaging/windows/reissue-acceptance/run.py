"""Fresh Windows r1 package, native OS, and source-fault acceptance; never publication."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
import uuid

HERE = Path(__file__).resolve().parent
TOOLS = HERE.parents[1]
spec = importlib.util.spec_from_file_location("mac_helpers", TOOLS / "macos/acceptance-v134/run.py")
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
require, save, read_report = helper.require, helper.save, helper.read_report
STATES = ["current", "task-disabled", "daily-disabled", "logon-disabled", "absent"]
FAULTS = ["none", "marker-write", "settings-write", "recovery-obstruction"]
REQUIRED = {f"A-native-{state}-{fault}" for state in STATES for fault in FAULTS} | {
    "windows-real-calendar-trigger", "windows-scheduler.final-cleanup", "windows-independent.final-cleanup", "package.black-box-upgrade", "package.native-smoke",
    "windows-helper.rollback-and-status", "windows-inspection.synthetic-contract", "windows-migration.source-and-native-files",
    "B-process-interruption", "migration-interruption.final-cleanup", "C-windows-native-api-ui-disabled", "windows-native-ui.final-cleanup",
} | {"C-ui-" + state for state in ["current", "disabled", "unloaded", "missing", "query-failed", "stale", "recovery-required"]}


def command(args, log, timeout=180):
    """Own the spawned child tree on Windows; final receipts independently clean OS state."""
    log.parent.mkdir(parents=True, exist_ok=True)
    with log.open("w", encoding="utf-8") as output:
        child = subprocess.Popen([str(value) for value in args], stdout=output, stderr=subprocess.STDOUT,
                                 creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            return child.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            if child.poll() is None:
                subprocess.run(["taskkill.exe", "/PID", str(child.pid), "/T", "/F"], stdout=output, stderr=subprocess.STDOUT,
                               timeout=30, creationflags=subprocess.CREATE_NO_WINDOW, check=False)
            child.wait(timeout=15)
            output.write("\nHARNESS TIMEOUT; separate cleanup receipts remain required.\n")
            return 124


def cleanup(source, scratch, reports):
    receipts = [scratch / "scheduler/owned.json", scratch / "native-ui/owned.json", reports / "smoke-owned.json"]
    pointer = reports / "rollback-owned-root.json"
    if pointer.exists():
        root = Path(json.loads(pointer.read_text(encoding="utf-8"))["root"]).resolve()
        require(root.is_relative_to(source / "outputs/slice-a/native"), "Rollback cleanup root outside fixture")
        receipts.append(root / "owned.json")
    results = []
    for index, receipt in enumerate(receipts):
        if not receipt.exists():
            continue
        output = reports / f"independent-cleanup-{index}.json"
        code = command(["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", HERE / "cleanup.ps1",
                        "-Manifest", receipt, "-ProductRoot", source, "-Report", output], reports / f"independent-cleanup-{index}.log", 120)
        result = json.loads(output.read_text(encoding="utf-8-sig")) if output.exists() else {"status": "fail", "error": "no cleanup report"}
        if code:
            result["status"] = "fail"
        results.append(result)
    status = "fail" if any(value.get("status") != "pass" for value in results) else "pass"
    save(reports / "independent-cleanup.json", {"status": status, "receipts": results})
    return {"id": "windows-independent.final-cleanup", "status": status, "category": "harness-cleanup", "details": results}


def gate(cases):
    ids = [c["id"] for c in cases]
    require(len(ids) == len(set(ids)), "Duplicate acceptance IDs")
    observed = {c["id"]: c["status"] for c in cases}
    return [f"{cid}: {observed.get(cid, 'not reached')}" for cid in sorted(REQUIRED) if observed.get(cid) != "pass"] + [cid for cid, status in observed.items() if status == "fail" and cid not in REQUIRED]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["source", "package", "scratch", "reports"]:
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--product-sha", required=True)
    parser.add_argument("--cleanup-only", action="store_true")
    args = parser.parse_args()
    require(sys.platform == "win32", "Native Windows required")
    require(os.environ.get("GITHUB_REF") == "refs/heads/codex/v1.3.4-reissue" and os.environ.get("GITHUB_REPOSITORY") == "YZYanthrop/anthropology-canteen", "Wrong execution branch/repository")
    source, archive, scratch, reports = [p.resolve() for p in (args.source, args.package, args.scratch, args.reports)]
    require(re.fullmatch(r"[a-f0-9]{40}", args.product_sha), "Full product SHA required")
    if args.cleanup_only:
        reports.mkdir(parents=True, exist_ok=True)
        return int(cleanup(source, scratch, reports)["status"] != "pass")
    require(not scratch.exists(), "Fresh scratch required")
    scratch.mkdir(parents=True)
    reports.mkdir(parents=True, exist_ok=True)
    report = {"productSHA": args.product_sha, "testSHA": os.environ.get("GITHUB_SHA"), "releaseRevision": "r1", "version": "1.3.4", "platform": "win32", "arch": "x64", "environment": {"platform": platform.platform(), "runnerImage": os.environ.get("ImageVersion")}, "cases": [], "fullyVerified": False,
              "notCovered": ["Alternate administrator", "Unsafe scheduler query ACL", "Real login/logout, sleep/wake, reboot", "Real email/provider calls"], "realUACCancellation": "separate coordinated local fixture required"}
    def add(cid, category, code, details):
        report["cases"].append({"id": cid, "category": category, "status": "pass" if code == 0 else "fail", "details": details})
    def child(name, cmd, timeout=900):
        code = command(cmd, reports / (name + ".log"), timeout)
        value = read_report(reports / (name + ".json"), name, code)
        report["cases"] += value["cases"]
        report[name + "Cleanup"] = value.get("cleanup", {})
        return value
    try:
        require(subprocess.check_output(["git", "-C", source, "rev-parse", "HEAD"], text=True).strip() == args.product_sha, "Wrong frozen product checkout")
        subprocess.run(["git", "-C", source, "diff", "--exit-code", "HEAD"], check=True, capture_output=True)
        digest = hashlib.file_digest(archive.open("rb"), "sha256").hexdigest()
        report["archive"] = {"name": archive.name, "sha256": digest, "size": archive.stat().st_size}
        code = command([sys.executable, TOOLS / "shared/candidate-smoke.py", archive, "--reissue", "--platform", "win32", "--arch", "x64", "--source-sha", args.product_sha, "--report", reports / "package-black-box.json"], reports / "package-black-box.log", 360)
        add("package.black-box-upgrade", "package-black-box", code, "Fresh unchanged ZIP; identity/privacy/page/save/restart and old v1.3.4 to r1 automatic + explicit import")
        require(code == 0, "ZIP black-box baseline failed; do not proceed to OS mutations")
        package = helper.extract_zip(archive, scratch / "package")
        node = package / "runtime/node.exe"
        for name in ["portable-server.mjs", "reminder-scheduler.mjs", "reminder-utils.mjs", "reminder-worker.mjs", "tools/register-windows-reminder.ps1", "tools/windows-reminder-task-common.ps1"]:
            require((package / name).read_bytes() == (source / name).read_bytes(), "Source/package mismatch: " + name)
        shell = "powershell.exe"
        prefix = [shell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"]
        code = command([*prefix, TOOLS / "windows/smoke-test.ps1", "-PackageRoot", package, "-ZipPath", archive, "-ReceiptPath", reports / "smoke-owned.json", "-CleanupReport", reports / "smoke-cleanup.json"], reports / "native-smoke.log", 600)
        add("package.native-smoke", "package-native-smoke", code, "Fresh ZIP launcher/persistence/import/DPAPI/offline worker/privacy; exact cleanup checked by harness")
        sid = subprocess.check_output([shell, "-NoProfile", "-Command", "[Security.Principal.WindowsIdentity]::GetCurrent().User.Value"], text=True).strip()
        native_root = source / "outputs/slice-a/native" / ("reissue-" + str(uuid.uuid4()))
        native_root.parent.mkdir(parents=True, exist_ok=True)
        save(reports / "rollback-owned-root.json", {"root": str(native_root)})
        code = command([*prefix, source / "tests/windows-reminder-rollback.native.ps1", "-ProductRoot", source, "-TestRoot", native_root, "-NodePath", node, "-OriginalUserSid", sid], reports / "helper-rollback.log", 900)
        details = json.loads((native_root / "result.json").read_text(encoding="utf-8-sig")) if (native_root / "result.json").exists() else {}
        save(reports / "helper-rollback.json", details)
        if not details.get("passed") or not details.get("temporaryTasksRemoved") or len(details.get("checks", [])) != 31:
            code = 1
        add("windows-helper.rollback-and-status", "source-injection-native-observer", code, details)
        code = command([*prefix, source / "tests/windows-reminder-status.native.ps1"], reports / "inspection-synthetic.log", 60)
        add("windows-inspection.synthetic-contract", "synthetic-inspection-not-native", code, "Nine explicitly synthetic flags/query cases; native state observations are recorded separately")
        code = command([node, "--test", "--test-reporter=tap", source / "tests/migration-recovery.test.mjs", source / "tests/migration-discovery.test.mjs", source / "tests/reminder-migration.test.mjs"], reports / "migration-source-native.log", 600)
        tap = (reports / "migration-source-native.log").read_text(encoding="utf-8", errors="replace")
        if not re.search(r"# fail 0\b", tap) or not re.search(r"# skipped 0\b", tap):
            code = 1
        add("windows-migration.source-and-native-files", "source-injection-and-named-native-filesystem", code, {"log": "migration-source-native.log", "nativeCases": ["Windows native file sharing (restored/incomplete)", "Windows native parent listing denial", "Windows denied source companion", "Windows DPAPI migration"], "otherCases": "explicit source injections; not mislabeled as native faults"})
        value = child("migration-interruption", [node, TOOLS / "macos/acceptance-v134/migration.mjs", "--source", source, "--scratch", scratch / "migration-interruption", "--report", reports / "migration-interruption.json", "--product-sha", args.product_sha, "--case", "B-process-interruption"])
        add("migration-interruption.final-cleanup", "harness-cleanup", 0 if value.get("cleanup", {}).get("status") == "pass" else 1, value.get("cleanup", {}))
        child("scheduler", [node, HERE / "scheduler.mjs", "--source", source, "--scratch", scratch / "scheduler", "--report", reports / "scheduler.json", "--product-sha", args.product_sha], 1500)
        child("ui", [node, TOOLS / "macos/basic-acceptance/ui.mjs", "--package", package, "--scratch", scratch / "ui", "--report", reports / "ui.json", "--product-sha", args.product_sha, "--package-mode", "r1", "--platform", "win32"], 360)
        child("native-ui", [node, HERE / "native-ui.mjs", "--package", package, "--scratch", scratch / "native-ui", "--report", reports / "native-ui.json", "--product-sha", args.product_sha], 360)
        require(hashlib.file_digest(archive.open("rb"), "sha256").hexdigest() == digest, "ZIP bytes changed during acceptance")
    except Exception as error:
        add("harness", "harness", 1, str(error))
    report["cases"].append(cleanup(source, scratch, reports))
    report["requiredIDs"] = sorted(REQUIRED)
    report["unmetRequirements"] = gate(report["cases"])
    report["automatedRequirementsPassed"] = not report["unmetRequirements"]
    report["releaseGatePassed"] = False  # Separate current-S real UAC cancellation remains a release gate.
    save(reports / "summary.json", report)
    print(json.dumps({"automatedRequirementsPassed": report["automatedRequirementsPassed"], "unmetRequirements": report["unmetRequirements"]}))
    return int(not report["automatedRequirementsPassed"])

if __name__ == "__main__":
    sys.exit(main())
