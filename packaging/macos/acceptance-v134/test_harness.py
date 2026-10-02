"""Focused acceptance-harness tests; no product execution or network."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("acceptance", Path(__file__).with_name("run.py"))
acceptance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(acceptance)


class HarnessTests(unittest.TestCase):
    def release(self):
        name, digest, size = acceptance.PACKAGES["arm64"]
        return {"tag_name": "v1.3.4", "draft": False, "prerelease": False, "assets": [
            {"name": name, "size": size, "digest": "sha256:" + digest, "browser_download_url": f"https://github.com/{acceptance.REPO}/releases/download/v1.3.4/{name}"},
            {"name": name + ".sha256", "browser_download_url": f"https://github.com/{acceptance.REPO}/releases/download/v1.3.4/{name}.sha256"},
        ]}

    def test_immutable_release_mismatch_stops(self):
        valid = self.release()
        acceptance.verify_release(valid, "arm64")
        for field, wrong in (("tag_name", "v1.3.3"), ("draft", True), ("prerelease", True)):
            changed = copy.deepcopy(valid)
            changed[field] = wrong
            with self.assertRaises(RuntimeError):
                acceptance.verify_release(changed, "arm64")
        for field, wrong in (("digest", "sha256:" + "0" * 64), ("size", 1), ("browser_download_url", "https://example.invalid/elsewhere")):
            changed = copy.deepcopy(valid)
            changed["assets"][0][field] = wrong
            with self.assertRaises(RuntimeError):
                acceptance.verify_release(changed, "arm64")

    def test_missing_checksum_stops(self):
        changed = self.release()
        changed["assets"].pop()
        with self.assertRaises(RuntimeError):
            acceptance.verify_release(changed, "arm64")

    def test_checksum_mismatch_stops_before_execution(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / acceptance.PACKAGES["arm64"][0]
            path.write_bytes(b"not the published package")
            with self.assertRaisesRegex(RuntimeError, "size mismatch"):
                acceptance.verify_zip(path, "arm64")

    def test_zip_traversal_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            archive = root / "unsafe.zip"
            with zipfile.ZipFile(archive, "w") as handle:
                handle.writestr("../outside", "untrusted")
            with self.assertRaisesRegex(RuntimeError, "Unsafe"):
                acceptance.extract_zip(archive, root / "extracted")
            self.assertFalse((root / "outside").exists())

    def test_unix_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            archive = root / "unsafe.zip"
            info = zipfile.ZipInfo("root/link")
            info.external_attr = 0o120777 << 16
            with zipfile.ZipFile(archive, "w") as handle:
                handle.writestr(info, "../outside")
            with self.assertRaisesRegex(RuntimeError, "symlink"):
                acceptance.extract_zip(archive, root / "extracted")

    def test_partial_report_is_not_success(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "result.json"
            path.write_text(json.dumps({"cases": [{"id": "native-unavailable", "category": "native", "status": "pending"}]}))
            result = acceptance.read_report(path, "scheduler", 124)
            self.assertEqual([case["status"] for case in result["cases"]], ["pending", "fail"])
            self.assertEqual(acceptance.read_report(path, "scheduler", 0)["cases"][0]["status"], "pending")

    def test_missing_or_empty_report_fails(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "result.json"
            self.assertEqual(acceptance.read_report(path, "suite", 0)["cases"][0]["status"], "fail")
            path.write_text('{"cases":[]}')
            self.assertEqual(acceptance.read_report(path, "suite", 0)["cases"][0]["status"], "fail")


if __name__ == "__main__":
    unittest.main()
