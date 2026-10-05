"""Remove only manifest-owned native smoke resources, with explicit verification."""
import argparse
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import subprocess
import sys
import time


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def validate_manifest(value, uid):
    require(value.get("version") == 1 and value.get("uid") == uid and uid > 0, "Cleanup will not cross user identity")
    base, root = (PurePosixPath(value[k]) for k in ["tempBase", "tempRoot"])
    require(base.is_absolute() and base != PurePosixPath("/"), "Invalid temporary base")
    require(root.parent == base and re.fullmatch(r"anthropology-canteen-smoke\.[A-Za-z0-9]+", root.name), "Cleanup root is not the unique smoke directory")
    require(".." not in root.parts, "Unnormalized smoke root")
    label = value.get("launchdLabel", "")
    require(re.fullmatch(r"org\.anthropology-canteen\.reminder\.smoke[0-9a-f]{18}", label), "Invalid owned LaunchAgent identity")
    home = PurePosixPath(value["home"])
    require(home.is_absolute() and value.get("launchdPlist") == str(home / "Library/LaunchAgents" / (label + ".plist")), "LaunchAgent path differs from owned label")
    require(value.get("keychainService") == "org.anthropology-canteen.smtp", "Invalid test Keychain service")
    accounts = value.get("keychainAccounts", [])
    require(isinstance(accounts, list) and len(accounts) <= 2 and len(accounts) == len(set(accounts)), "Invalid owned Keychain account list")
    for account in accounts:
        require(re.fullmatch(r"macos-smoke-[0-9a-f]{32}|smoke[0-9a-f]{18}", account), "Refusing unrelated Keychain identity")
    for item in value.get("ownedProcesses", []):
        require(isinstance(item.get("pid"), int) and item["pid"] > 1, "Invalid owned PID")
        token = item.get("token", "")
        require(token.startswith(str(root) + "/") or re.fullmatch(r"http://127\.0\.0\.1:[0-9]{1,5}/api/browser-session", token), "Invalid owned process token")


def owned_processes(output, value):
    result = []
    prefix = value["tempRoot"] + "/"
    recorded = {p["pid"]: p["token"] for p in value.get("ownedProcesses", [])}
    for line in output.splitlines():
        match = re.fullmatch(r"\s*([0-9]+)\s+([0-9]+)\s+(.+)", line)
        if not match or int(match[2]) != value["uid"]:
            continue
        pid, command = int(match[1]), match[3]
        if prefix in command or (pid in recorded and recorded[pid] in command):
            result.append({"pid": pid, "command": command})
    return result


def job_absent(code, diagnostic):
    return code != 0 and bool(re.search(r"Could not find service|service not found", diagnostic, re.I))


def item_absent(code, diagnostic):
    # security maps errSecItemNotFound (-25300) to shell exit status 44.
    return code == 44 and "could not be found" in diagnostic.lower()


def execute(args):
    return subprocess.run(args, capture_output=True, text=True, timeout=30)


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".writing")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def cleanup(manifest_path, report_path, retain=False):
    report = {"status": "pending", "resources": [], "remainingProcesses": [], "personalItemsRead": False}
    if not manifest_path.exists():
        report.update(status="pass", note="No ownership manifest exists; no resources touched")
        save(report_path, report)
        return 0
    value = json.loads(manifest_path.read_text(encoding="utf-8"))
    try:
        require(sys.platform == "darwin", "Existing macOS resources require native cleanup")
        validate_manifest(value, os.getuid())
        root = Path(value["tempRoot"])
        require(root.resolve() == root, "Cleanup root must be canonical and not a symlink")
        require(Path(value["home"]).resolve() == Path.home().resolve(), "Cleanup home differs from current user")
        value["retainEvidence"] = bool(value.get("retainEvidence") or retain)
        save(manifest_path, value)
        def record(name, operation):
            try:
                details = operation()
                report["resources"].append({"resource": name, "status": "pass", "details": details})
            except Exception as error:
                report["resources"].append({"resource": name, "status": "fail", "error": str(error)})

        def launchagent():
            target = f"gui/{value['uid']}/{value['launchdLabel']}"
            result = execute(["/bin/launchctl", "print", target])
            if result.returncode == 0:
                require(value["tempRoot"] + "/" in result.stdout, "Loaded task no longer belongs to this smoke root")
                result = execute(["/bin/launchctl", "bootout", target])
                require(result.returncode == 0, "Owned task bootout failed: " + result.stderr.strip())
            else:
                require(job_absent(result.returncode, result.stderr + result.stdout), "Cannot establish task absence: " + result.stderr.strip())
            plist = Path(value["launchdPlist"])
            require(not plist.is_symlink(), "Refusing a replaced plist symlink")
            if plist.exists():
                require(plist.is_file(), "Refusing a replaced non-file plist")
                require(value["tempRoot"] + "/" in plist.read_text(), "Plist no longer belongs to this smoke root")
                plist.unlink()
            result = execute(["/bin/launchctl", "print", target])
            require(job_absent(result.returncode, result.stderr + result.stdout), "Owned task still loaded or task absence cannot be verified")
            require(not plist.exists(), "Owned plist remains")
            result = execute(["/bin/launchctl", "print-disabled", f"gui/{value['uid']}"])
            require(result.returncode == 0 and "{" in result.stdout, "Cannot verify owned disabled override")
            lines = [line.strip() for line in result.stdout.splitlines() if value["launchdLabel"] in line]
            require(len(lines) <= 1, "Ambiguous owned disabled override")
            disabled = bool(lines and re.search(r"=>\s*(true|disabled)\b", lines[0]))
            require(not disabled, "Owned task retains a disabled override")
            if lines:
                require(re.search(r"=>\s*(false|enabled)\b", lines[0]), "Unknown owned disabled override value")
            return {"loaded": False, "plistExists": False, "disabled": False, "override": lines or "absent", "enabledOverrideNote": "Owned enabled override, if present, is reported and not removed by changing global launchd configuration"}
        if value.get("launchdOwned", False):
            record("LaunchAgent", launchagent)
        else:
            report["resources"].append({"resource": "LaunchAgent", "status": "pass", "details": "No native task was claimed or registered"})

        for account in value["keychainAccounts"]:
            def credential(account=account):
                query = ["-s", value["keychainService"], "-a", account]
                result = execute(["/usr/bin/security", "find-generic-password", *query])
                if result.returncode == 0:
                    removed = execute(["/usr/bin/security", "delete-generic-password", *query])
                    require(removed.returncode == 0, "Owned synthetic Keychain item could not be deleted")
                else:
                    require(item_absent(result.returncode, result.stderr), "Owned Keychain absence could not be established")
                result = execute(["/usr/bin/security", "find-generic-password", *query])
                require(item_absent(result.returncode, result.stderr), "Owned Keychain item remains or query failed")
                return {"account": account, "exists": False}
            record("Keychain " + account, credential)

        def processes():
            def observed():
                result = execute(["/bin/ps", "-axo", "pid=,uid=,command="])
                require(result.returncode == 0, "Owned process query failed")
                return [p for p in owned_processes(result.stdout, value) if p["pid"] != os.getpid()]
            initial = observed()
            for item in initial:
                # Re-read before signaling: never kill a reused PID with another command.
                if any(p["pid"] == item["pid"] for p in observed()):
                    try:
                        os.kill(item["pid"], signal.SIGTERM)
                    except ProcessLookupError:
                        pass
            for _ in range(40):
                remaining = observed()
                if not remaining:
                    break
                time.sleep(0.25)
            report["remainingProcesses"] = remaining
            require(not remaining, "Owned native smoke processes remain after SIGTERM")
            return {"terminated": [p["pid"] for p in initial], "remaining": []}
        record("processes", processes)
        report["status"] = "fail" if any(r["status"] == "fail" for r in report["resources"]) else "pass"
        if report["status"] == "pass" and not value["retainEvidence"] and root.exists():
            shutil.rmtree(root)
            require(not root.exists(), "Smoke directory cleanup failed")
        report["syntheticEvidenceRetained"] = root.exists()
        report["tempRoot"] = str(root)
        value["cleanupCompleted"] = report["status"] == "pass"
        save(manifest_path, value)
    except Exception as error:
        report.update(status="fail", error=str(error), evidenceRetained=True)
    save(report_path, report)
    return int(report["status"] != "pass")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--retain-scratch", action="store_true")
    args = parser.parse_args()
    raise SystemExit(cleanup(args.manifest.resolve(), args.report.resolve(), args.retain_scratch))
