import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("windows_reissue", Path(__file__).with_name("run.py"))
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)

class GateTests(unittest.TestCase):
    def test_every_required_case_must_pass(self):
        good = [{"id": cid, "status": "pass"} for cid in harness.REQUIRED]
        self.assertEqual(harness.gate(good), [])
        for item in good:
            absent = [x for x in good if x != item]
            self.assertTrue(harness.gate(absent))
            for status in ["pending", "fail"]:
                self.assertTrue(harness.gate(absent + [{"id": item["id"], "status": status}]))
        self.assertTrue(harness.gate(good + [{"id": "unexpected-cleanup", "status": "fail"}]))
        with self.assertRaises(Exception):
            harness.gate(good + good[:1])

    def test_cleanup_rejects_unowned_root_before_os_queries(self):
        with tempfile.TemporaryDirectory() as root:
            manifest = Path(root) / "owned.json"
            manifest.write_text(json.dumps({"root": os.environ.get("SystemRoot", "C:/Windows"), "names": []}))
            report = Path(root) / "report.json"
            result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
                                     str(Path(__file__).with_name("cleanup.ps1")), "-Manifest", str(manifest), "-Report", str(report)],
                                    capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30, creationflags=subprocess.CREATE_NO_WINDOW)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Refusing cleanup outside unique fixture roots", result.stderr)
            self.assertFalse(report.exists())

    def test_retest_restores_only_original_package_dist_and_never_overwrites(self):
        with tempfile.TemporaryDirectory() as root:
            source=Path(root)/"source";package=Path(root)/"package"
            (package/"dist/server").mkdir(parents=True);source.mkdir()
            original=b"synthetic compiled module"
            (package/"dist/server/index.js").write_bytes(original)
            result=harness.provide_source_dist(source,package)
            self.assertTrue(result["copiedFromOriginalPackage"])
            self.assertEqual((source/"dist/server/index.js").read_bytes(),original)
            self.assertFalse(harness.provide_source_dist(source,package)["copiedFromOriginalPackage"])
            (source/"dist/server/index.js").write_bytes(b"unrelated existing bytes")
            with self.assertRaises(Exception):harness.provide_source_dist(source,package)
            self.assertEqual((source/"dist/server/index.js").read_bytes(),b"unrelated existing bytes")
            self.assertEqual((package/"dist/server/index.js").read_bytes(),original)

    def test_windows_timeout_terminates_owned_child_tree(self):
        with tempfile.TemporaryDirectory() as root:
            with patch.object(harness.subprocess, "Popen") as launch, patch.object(harness.subprocess, "run") as terminate:
                child = launch.return_value
                child.pid = 987654
                child.poll.return_value = None
                child.wait.side_effect = [subprocess.TimeoutExpired("fixture", 0.01), 1]
                result = harness.command(["fixture.exe"], Path(root) / "log.txt", 0.01)
                self.assertEqual(result, 124)
                terminate.assert_called_once()
                self.assertEqual(terminate.call_args.args[0], ["taskkill.exe", "/PID", "987654", "/T", "/F"])
                self.assertNotIn("start_new_session", launch.call_args.kwargs)
                self.assertIn("TIMEOUT", (Path(root) / "log.txt").read_text())

if __name__ == "__main__":
    unittest.main()
