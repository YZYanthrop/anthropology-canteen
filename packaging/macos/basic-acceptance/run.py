"""v1.3.4 candidate acceptance; immutable ZIP and source, separated evidence."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("previous_acceptance_tools", HERE.parent / "acceptance-v134/run.py")
old = importlib.util.module_from_spec(spec)
spec.loader.exec_module(old)
require, save, command = old.require, old.save, old.command
extract_zip, read_report = old.extract_zip, old.read_report
REPO = "YZYanthrop/anthropology-canteen"
BRANCH = "refs/heads/codex/v1.3.4-macos-basic"
STATES = ["loaded", "unloaded", "disabled", "loaded-disabled", "absent"]
FAULTS = ["none", "marker-write", "settings-write", "post-registration-query", "recovery-obstruction"]
SCHEDULER_IDS = {f"A-{state}-{fault}" for state in STATES for fault in FAULTS} | {
    "C-" + state for state in STATES
} | {"C-native-plist-read-denied", "C-injected-launchctl-query-failure", "C-injected-disabled-output-unknown", "scheduler-real-calendar-trigger"}
UI_IDS = {"C-ui-" + state for state in ["current", "disabled", "unloaded", "missing", "query-failed", "stale", "recovery-required"]}
SUITES = ["black-box", "scheduler", "ui", "native-ui"]
REUSE_BASELINE = "bb78dd9431a61617c3198b087ac556759ef85333"
# Changes to any of these invalidate the cited B/D/Keychain results.
REUSE_FILES = ["reminder-mail.mjs", "reminder-worker.mjs", "reminder-utils.mjs", "packaging/shared/import-data.mjs", "portable-server.mjs", "packaging/macos/keychain-helper.swift"]


def package_name(arch):
    display = {"arm64": "Apple-Silicon-arm64", "x64": "Intel-x64"}[arch]
    return f"Anthropology-Canteen-macOS-{display}-v1.3.4-candidate.zip"


def validate_execution(value, test_sha):
    require(re.fullmatch(r"[0-9a-f]{40}", test_sha or ""), "Invalid test SHA")
    mode = value.get("mode")
    require(mode in {"build", "reuse"}, "Unknown execution mode")
    sha = test_sha if mode == "build" and value.get("productSHA") == "self" else value.get("productSHA")
    require(isinstance(sha, str) and re.fullmatch(r"[0-9a-f]{40}", sha), "Need exact product SHA")
    suites = value.get("suites")
    require(isinstance(suites, list) and bool(suites) and len(suites) == len(set(suites)) and set(suites) <= set(SUITES), "Invalid selected suites")
    cases = value.get("schedulerCases")
    require(cases is None or (isinstance(cases, str) and "scheduler" in suites and set(cases.split(",")) <= SCHEDULER_IDS), "Invalid scheduler case selection")
    run = value.get("candidateRunId")
    if mode == "build":
        require(sha == test_sha and run is None and suites == SUITES and cases is None, "Initial build must test the same frozen commit and full required scope")
    else:
        require(isinstance(run, str) and re.fullmatch(r"[1-9][0-9]*", run), "Retest requires original candidate run ID")
    return {**value, "productSHA": sha}


def verify_zip(path, arch):
    require(path.name == package_name(arch), "Candidate filename/version mismatch")
    sidecar = Path(str(path) + ".sha256").read_text(encoding="utf-8-sig").strip()
    match = re.fullmatch(r"([a-fA-F0-9]{64})\s+\*?" + re.escape(path.name), sidecar)
    require(match, "Candidate sidecar filename/format mismatch")
    with path.open("rb") as handle:
        digest = hashlib.file_digest(handle, "sha256").hexdigest()
    require(digest == match[1].lower(), "Candidate SHA256 mismatch")
    return digest


def verify_metadata(metadata, arch, sha):
    for key, value in {"version": "1.3.4", "sourceCommit": sha, "platform": "darwin", "arch": arch, "fullyVerified": False, "status": "unpublished-candidate"}.items():
        require(metadata.get(key) == value, "Candidate metadata mismatch: " + key)


def required_ids(suites, selected):
    required = {"candidate.baseline"}
    if "black-box" in suites:
        required.add("candidate.start-page-save-restart")
    if "scheduler" in suites:
        required |= set(selected.split(",")) if selected else SCHEDULER_IDS
        required.add("scheduler.final-cleanup")
    if "ui" in suites:
        required |= UI_IDS
    if "native-ui" in suites:
        required |= {"C-native-api-ui-disabled", "native-ui.final-cleanup"}
    return sorted(required)


def gate(cases, required):
    ids = [case["id"] for case in cases]
    failures = ["duplicate case IDs"] if len(ids) != len(set(ids)) else []
    observed = {case["id"]: case["status"] for case in cases}
    failures += [f"{cid}: {observed.get(cid, 'not reached')}" for cid in required if observed.get(cid) != "pass"]
    failures += [f"{cid}: failed" for cid, status in observed.items() if status == "fail" and cid not in required]
    return failures


def cleanup(source, scratch, reports, sha, node):
    cases = []
    for suite in ["scheduler", "native-ui"]:
        if not (scratch / suite).exists():
            continue
        params = ["--source", source] if suite == "scheduler" else []
        code = command([node, HERE / f"{suite}.mjs", *params, "--scratch", scratch / suite, "--report", reports / f"{suite}-cleanup.json", "--product-sha", sha, "--cleanup"], reports / f"{suite}-cleanup.log", 120)
        cases.append({"id": suite + ".final-cleanup", "category": "harness-cleanup", "status": "pass" if code == 0 else "fail", "details": "See exact manifest cleanup report; enabled override residue is separately disclosed"})
    return cases


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workflow-config", type=Path)
    parser.add_argument("--arch", choices=["arm64", "x64"])
    parser.add_argument("--source", type=Path)
    parser.add_argument("--candidate", type=Path)
    parser.add_argument("--product-sha")
    parser.add_argument("--scratch", type=Path)
    parser.add_argument("--reports", type=Path)
    parser.add_argument("--cleanup", action="store_true")
    parser.add_argument("--suites", nargs="+", choices=SUITES, default=SUITES)
    parser.add_argument("--scheduler-cases")
    args = parser.parse_args()
    if args.workflow_config:
        require(os.environ.get("GITHUB_REF") == BRANCH and os.environ.get("GITHUB_REPOSITORY") == REPO, "Unapproved execution branch/repository")
        config = validate_execution(json.loads(args.workflow_config.read_text()), os.environ.get("GITHUB_SHA"))
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
            for key, value in {"mode": config["mode"], "product_sha": config["productSHA"], "candidate_run": config["candidateRunId"] or "", "suites": " ".join(config["suites"]), "scheduler_cases": config["schedulerCases"] or ""}.items():
                output.write(f"{key}={value}\n")
        return 0
    require(all([args.arch, args.source, args.product_sha, args.scratch, args.reports]), "Missing acceptance arguments")
    require(re.fullmatch(r"[0-9a-f]{40}", args.product_sha), "Invalid product SHA")
    require(not args.scheduler_cases or ("scheduler" in args.suites and set(args.scheduler_cases.split(",")) <= SCHEDULER_IDS), "Invalid scheduler selection")
    source, scratch, reports = (item.resolve() for item in (args.source, args.scratch, args.reports))
    reports.mkdir(parents=True, exist_ok=True)
    if args.cleanup:
        return int(any(c["status"] != "pass" for c in cleanup(source, scratch, reports, args.product_sha, shutil.which("node") or "node")))
    require(sys.platform == "darwin" and os.getuid() != 0, "Native macOS ordinary user required")
    require(os.environ.get("GITHUB_REF") == BRANCH and os.environ.get("GITHUB_REPOSITORY") == REPO, "Wrong acceptance branch/repository")
    require(args.candidate and not scratch.exists(), "Candidate ZIP and fresh scratch required")
    scratch.mkdir(parents=True)
    report = {"productSHA": args.product_sha, "testSHA": os.environ.get("GITHUB_SHA"), "version": "1.3.4", "internalValidation": True, "architecture": args.arch, "runURL": f"https://github.com/{REPO}/actions/runs/{os.environ.get('GITHUB_RUN_ID')}", "environment": {"uname": platform.uname()._asdict(), "macOS": platform.mac_ver()[0], "uid": os.getuid(), "runnerImage": os.environ.get("ImageVersion")}, "selection": {"suites": args.suites, "schedulerCases": args.scheduler_cases}, "cases": [], "fullyVerified": False, "notCovered": ["Finder/Gatekeeper", "Real login/logout, sleep/wake and full reboot", "Isolated native launchctl query ACL denial", "Real email or providers", "Complete three-platform certification"]}
    node = shutil.which("node") or "node"
    try:
        actual = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
        require(actual == args.product_sha, "Source checkout differs from frozen product")
        subprocess.check_call(["git", "-C", str(source), "diff", "--exit-code", "HEAD", "--", "."])
        reused = []
        for file in REUSE_FILES:
            original = subprocess.check_output(["git", "-C", str(source), "show", f"{REUSE_BASELINE}:{file}"])
            require((source / file).read_bytes() == original, "Prior B/D/Keychain evidence invalidated by change: " + file)
            reused.append(file)
        report["reusedEvidence"] = {"sourceSHA": REUSE_BASELINE, "runURL": f"https://github.com/{REPO}/actions/runs/37018823392", "unchangedFiles": reused, "scope": "B/D native and injection acceptance plus independent temporary Keychain, both architectures; no claim of rerun on candidate"}
        archive = args.candidate.resolve()
        digest = verify_zip(archive, args.arch)
        package = extract_zip(archive, scratch / "candidate")
        require(not (package / "data").exists(), "Candidate archive contains user data")
        metadata = json.loads((package / "candidate.json").read_text())
        verify_metadata(metadata, args.arch, args.product_sha)
        node = package / "runtime/bin/node"
        runtime = json.loads(subprocess.check_output([str(node), "-p", "JSON.stringify({platform:process.platform,arch:process.arch,version:process.version})"], text=True))
        require(runtime == {"platform": "darwin", "arch": args.arch, "version": "v24.14.0"}, "Wrong embedded runtime")
        require(platform.machine() == {"arm64":"arm64", "x64":"x86_64"}[args.arch], "Wrong native runner architecture")
        for module in ["portable-server.mjs", "reminder-scheduler.mjs", "reminder-utils.mjs", "reminder-worker.mjs"]:
            require((package / module).read_bytes() == (source / module).read_bytes(), "Candidate/source mismatch: " + module)
        report["cases"].append({"id":"candidate.baseline", "category":"candidate-black-box", "status":"pass", "details":{"archive":archive.name,"size":archive.stat().st_size,"sha256":digest,"metadata":metadata,"runtime":runtime}})
        if "black-box" in args.suites:
            code = command([sys.executable, HERE.parents[1] / "shared/candidate-smoke.py", archive, "--internal-validation", "--version", "1.3.4", "--platform", "darwin", "--arch", args.arch, "--source-sha", args.product_sha, "--report", reports / "candidate-black-box.json"], reports / "candidate-black-box.log", 240)
            report["cases"].append({"id":"candidate.start-page-save-restart", "category":"candidate-black-box", "status":"pass" if code == 0 and (reports / "candidate-black-box.json").exists() else "fail", "details":"Original candidate ZIP, no module replacement or credentials; see candidate-black-box.json/log"})
        for suite in ["scheduler", "ui", "native-ui"]:
            if suite not in args.suites:
                continue
            params = ["--source", source, "--skip-keychain"] if suite == "scheduler" else ["--package", package]
            if suite == "scheduler" and args.scheduler_cases:
                params += ["--case", args.scheduler_cases]
            code = command([node, HERE / f"{suite}.mjs", *params, "--scratch", scratch / suite, "--report", reports / f"{suite}.json", "--product-sha", args.product_sha], reports / f"{suite}.log", 720 if suite == "scheduler" else 300)
            result = read_report(reports / f"{suite}.json", suite, code)
            report["cases"] += result["cases"]
            report[suite + "Environment"] = result.get("environment", {})
            report[suite + "Cleanup"] = result.get("cleanup", {})
        require(verify_zip(archive, args.arch) == digest, "Candidate changed during acceptance")
    except Exception as error:
        report["cases"].append({"id":"harness", "category":"harness", "status":"fail", "details":str(error)})
    finally:
        try:
            report["cases"] += cleanup(source, scratch, reports, args.product_sha, node)
        except Exception as error:
            report["cases"].append({"id":"cleanup", "category":"harness", "status":"fail", "details":str(error)})
        report["requiredIDs"] = required_ids(args.suites, args.scheduler_cases)
        report["unmetRequirements"] = gate(report["cases"], report["requiredIDs"])
        report["selectedRequirementsPassed"] = not report["unmetRequirements"]
        report["basicUsabilityPassed"] = report["selectedRequirementsPassed"] and set(args.suites) == set(SUITES) and not args.scheduler_cases
        report["counts"] = {s:sum(c["status"]==s for c in report["cases"]) for s in ["pass","fail","pending"]}
        save(reports / "summary.json", report)
        lines=[f"# macOS {args.arch} v1.3.4 basic usability", "", f"Product: {args.product_sha}; tests: {report['testSHA']}", report["runURL"], "", "| Case | Category | Result |", "| --- | --- | --- |"]
        lines += [f"| {c['id']} | {c['category']} | {c['status']} |" for c in report["cases"]]
        lines += ["", "Required checks: " + ("passed" if report["selectedRequirementsPassed"] else "not satisfied"), "Not fully Verified; see source evidence, cleanup residue and excluded scenarios."]
        (reports / "SUMMARY.md").write_text("\n".join(lines)+"\n",encoding="utf-8")
        if os.environ.get("GITHUB_STEP_SUMMARY"):
            with open(os.environ["GITHUB_STEP_SUMMARY"],"a",encoding="utf-8") as f:
                f.write("\n".join(lines)+"\n")
    return int(not report["selectedRequirementsPassed"])


if __name__ == "__main__":
    sys.exit(main())
