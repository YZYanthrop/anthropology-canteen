"""Offline r1 inspector regressions; synthetic ZIPs contain no runnable product."""
import hashlib
import importlib.util
import io
from unittest.mock import Mock
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

HERE = Path(__file__).resolve().parent
SHA = "a" * 40


class ReissueInspectorTests(unittest.TestCase):
    def fixture(self, directory, platform="darwin", arch="arm64", *, changes=None, extra=None, root_name=None):
        target = "Windows-x64" if platform == "win32" else "macOS-" + {"arm64": "Apple-Silicon-arm64", "x64": "Intel-x64"}[arch]
        root = "Anthropology-Canteen-" + target + "-v1.3.4-r1"
        archive = directory / (root + ".zip")
        value = {"version": "1.3.4", "releaseRevision": "r1", "artifactVersion": "1.3.4-r1", "sourceCommit": SHA,
                 "platform": platform, "arch": arch, "status": "prepared-for-release", "fullyVerified": False,
                 "verificationScope": "three-platform-limited-reissue"}
        value.update(changes or {})
        files = {"release.json": json.dumps(value), "RELEASE-NOTICE.txt": (HERE / "REISSUE-NOTICE.txt").read_text(encoding="utf-8"),
                 "portable-server.mjs": "NOT EXECUTABLE", "dist/server/index.js": "NOT EXECUTABLE", "reminder-worker.mjs": "NOT EXECUTABLE",
                 "tools/import-data.mjs": "NOT EXECUTABLE", "LICENSE": "Synthetic fixture"}
        files["runtime/node.exe" if platform == "win32" else "runtime/bin/node"] = "NEVER EXECUTE THIS FIXTURE"
        if platform == "darwin":
            files.update({"Anthropology Canteen.command": "NOT EXECUTABLE", "tools/anthropology-canteen-keychain": "NOT EXECUTABLE"})
        files.update(extra or {})
        with zipfile.ZipFile(archive, "w") as z:
            for name, contents in files.items():
                info = zipfile.ZipInfo((root_name or root) + "/" + name)
                info.external_attr = 0o100755 << 16
                z.writestr(info, contents)
        Path(str(archive) + ".sha256").write_text(hashlib.sha256(archive.read_bytes()).hexdigest() + "  " + archive.name + "\n", encoding="utf-8")
        return archive

    def inspect(self, archive, platform="darwin", arch="arm64", *, extra=None, sha=SHA):
        report = archive.parent / "report.json"
        if report.exists():
            report.unlink()
        process = subprocess.run([sys.executable, "-B", str(HERE / "candidate-smoke.py"), str(archive), "--inspect-only", "--reissue",
            "--platform", platform, "--arch", arch, "--source-sha", sha, "--report", str(report), *(extra or [])],
            text=True, capture_output=True, encoding="utf-8")
        return process, report

    def test_all_three_native_identities_are_accepted_without_execution(self):
        for platform, arch in [("win32", "x64"), ("darwin", "arm64"), ("darwin", "x64")]:
            with self.subTest(platform=platform, arch=arch), tempfile.TemporaryDirectory() as tmp:
                archive = self.fixture(Path(tmp), platform, arch)
                result, report = self.inspect(archive, platform, arch)
                self.assertEqual(result.returncode, 0, result.stderr)
                value = json.loads(report.read_text(encoding="utf-8"))
                self.assertEqual(value["packageSHA256"], hashlib.sha256(archive.read_bytes()).hexdigest())
                self.assertFalse(value["fullyVerified"])
                self.assertFalse(any("server startup" in check for check in value["checks"]))

    def test_wrong_sidecar_digest_filename_and_post_hash_tampering_are_rejected(self):
        for defect in ["digest", "filename", "tamper"]:
            with self.subTest(defect=defect), tempfile.TemporaryDirectory() as tmp:
                archive = self.fixture(Path(tmp))
                sidecar = Path(str(archive) + ".sha256")
                if defect == "digest":
                    sidecar.write_text("0" * 64 + "  " + archive.name)
                elif defect == "filename":
                    sidecar.write_text(hashlib.sha256(archive.read_bytes()).hexdigest() + "  other.zip")
                else:
                    archive.write_bytes(archive.read_bytes() + b"tampered")
                result, report = self.inspect(archive)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(report.exists())

    def test_wrong_metadata_never_produces_a_pass_report(self):
        for field, bad in [("version", "1.3.5"), ("releaseRevision", "r2"), ("artifactVersion", "1.3.4"), ("sourceCommit", "b" * 40),
                           ("platform", "win32"), ("arch", "x64"), ("status", "published-with-limitations"), ("fullyVerified", True),
                           ("verificationScope", "internal-only")]:
            with self.subTest(field=field), tempfile.TemporaryDirectory() as tmp:
                result, report = self.inspect(self.fixture(Path(tmp), changes={field: bad}))
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(report.exists())

    def test_root_candidate_privacy_missing_notice_and_conflicting_modes_are_rejected(self):
        for options, extra in [({"root_name": "old-candidate"}, []), ({"extra": {"candidate.json": "{}"}}, []),
                ({"extra": {"CANDIDATE-NOTICE.txt": "old"}}, []), ({"extra": {"data/private.json": "{}"}}, []),
                ({"extra": {"RELEASE-NOTICE.txt": "missing required notice"}}, []), ({}, ["--internal-validation"]), ({}, ["--release"])]:
            with self.subTest(options=options, extra=extra), tempfile.TemporaryDirectory() as tmp:
                result, report = self.inspect(self.fixture(Path(tmp), **options), extra=extra)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(report.exists())

    def test_short_source_and_unsupported_windows_architecture_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive = self.fixture(Path(tmp), "win32", "x64")
            self.assertNotEqual(self.inspect(archive, "win32", "x64", sha="abc123")[0].returncode, 0)
            self.assertNotEqual(self.inspect(archive, "win32", "arm64")[0].returncode, 0)


class SmokeLifecycleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location("candidate_smoke", HERE / "candidate-smoke.py")
        cls.smoke = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.smoke)

    def fixture(self, root, token="session-one"):
        process = Mock(pid=1234)
        process.poll.return_value = None
        status = {"app": "anthropology-canteen", "packageRoot": str(root), "sessionToken": token}
        request = Mock(side_effect=lambda *args, **kwargs: io.BytesIO(json.dumps(status).encode()))
        return process, status, request

    def test_runtime_socket_is_not_readiness_before_current_pid_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "data").mkdir()
            pid_file = root / "data/anthropology-canteen-server.pid"
            pid_file.write_text("1111")  # A prior round's PID cannot satisfy startup.
            process, _, request = self.fixture(root)
            now = [0.0]
            def sleep(seconds):
                self.assertFalse(request.called)
                now[0] += seconds
                pid_file.write_text(str(process.pid))
            events = []
            token = self.smoke.wait_for_initialized(process, root, request, set(), events,
                clock=lambda: now[0], sleep=sleep, timeout=1)
            self.assertEqual(token, "session-one")
            self.assertEqual(request.call_count, 1)
            self.assertEqual(events[-1]["status"], "pass")
            self.assertGreater(events[-1]["elapsedSeconds"], 0)
            self.assertNotIn("session-one", json.dumps(events))

    def test_wrong_root_or_reused_session_is_not_accepted_or_retried(self):
        for defect in ("root", "session"):
            with self.subTest(defect=defect), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                (root / "data").mkdir()
                (root / "data/anthropology-canteen-server.pid").write_text("1234")
                process, status, request = self.fixture(root)
                if defect == "root":
                    status["packageRoot"] = str(root / "different-copy")
                with self.assertRaisesRegex(RuntimeError, "identity|session"):
                    self.smoke.wait_for_initialized(process, root, request,
                        {"session-one"} if defect == "session" else set(), [], timeout=1)
                self.assertEqual(request.call_count, 1)

    def test_dead_child_and_initialization_deadline_remain_failures(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            process, _, request = self.fixture(root)
            process.poll.return_value = 9
            with self.assertRaisesRegex(RuntimeError, "exited"):
                self.smoke.wait_for_initialized(process, root, request, set(), [], timeout=1)
            process.poll.return_value = None
            now = [0.0]
            def sleep(seconds):
                now[0] += seconds
            events = []
            with self.assertRaisesRegex(RuntimeError, "initialization timed out"):
                self.smoke.wait_for_initialized(process, root, request, set(), events,
                    clock=lambda: now[0], sleep=sleep, timeout=0.5)
            self.assertLessEqual(now[0], 0.5)
            self.assertFalse(request.called)
            self.assertEqual(events[-1]["status"], "fail")

    def test_probe_and_business_budgets_and_failure_timing_are_explicit(self):
        self.assertEqual(self.smoke.request_timeout("/api/runtime-status"), 2)
        self.assertEqual(self.smoke.request_timeout("/api/local-data"), 30)
        self.assertEqual(self.smoke.request_timeout("/api/reminders/status"), 60)
        opener = Mock()
        opener.open.side_effect = TimeoutError("synthetic timeout")
        events = []
        times = iter([10.0, 40.0])
        with self.assertRaises(TimeoutError):
            with self.smoke.traced_request(opener, "http://127.0.0.1:1", "/api/local-data",
                    "private-session", None, events, "round-3", clock=lambda: next(times)):
                self.fail("A timed-out request must not produce a response")
        self.assertEqual(opener.open.call_count, 1)
        self.assertEqual(opener.open.call_args.kwargs["timeout"], 30)
        self.assertEqual(events[-1]["status"], "fail")
        self.assertEqual(events[-1]["phase"], "round-3")
        self.assertEqual(events[-1]["elapsedSeconds"], 30)
        self.assertNotIn("private-session", json.dumps(events))

    def test_request_trace_covers_response_body_and_closes_response(self):
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.side_effect = TimeoutError("body timed out")
        opener = Mock()
        opener.open.return_value = response
        events = []
        with self.assertRaises(TimeoutError):
            with self.smoke.traced_request(opener, "http://127.0.0.1:1", "/api/local-data",
                    "session", None, events, "round-0") as received:
                received.read()
        self.assertEqual(events[-1]["status"], "fail")
        response.__exit__.assert_called_once()


if __name__ == "__main__":
    unittest.main()
