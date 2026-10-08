"""Choose one immutable fixture root for acceptance and independent cleanup."""
import os
from pathlib import Path
import re
import subprocess
import sys


def runner_paths(runner_temp, native_temp, platform_id, run_id, attempt):
    if platform_id not in {"win32-x64", "darwin-arm64", "darwin-x64"} or not all(re.fullmatch(r"[1-9][0-9]*", str(x)) for x in [run_id, attempt]):
        raise ValueError("Invalid unique runner identity")
    scratch_base = native_temp if platform_id == "win32-x64" else runner_temp
    return {"R1_PACKAGES": runner_temp / "r1-packages",
            "R1_SCRATCH": scratch_base / f"canteen-r1-{run_id}-{attempt}-{platform_id}",
            "R1_REPORTS": runner_temp / "r1-reports"}


def main():
    runner_temp = Path(os.environ["RUNNER_TEMP"]).resolve()
    native_temp = runner_temp
    if sys.platform == "win32":
        # Use the same OS API as the strict observer and cleanup guard. Actions'
        # RUNNER_TEMP may be on a different volume; do not widen those guards.
        native_temp = Path(subprocess.check_output(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
            "[IO.Path]::GetTempPath()"], text=True, timeout=30, creationflags=subprocess.CREATE_NO_WINDOW).strip()).resolve()
    values = runner_paths(runner_temp, native_temp, sys.argv[1], os.environ["GITHUB_RUN_ID"], os.environ["GITHUB_RUN_ATTEMPT"])
    with open(os.environ["GITHUB_ENV"], "a", encoding="utf-8") as output:
        for key, value in values.items():
            output.write(f"{key}={value}\n")


if __name__ == "__main__": main()
