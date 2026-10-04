"""Candidate acceptance tool regressions: no network, build or system jobs."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import subprocess
import sys
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("basic_acceptance", Path(__file__).with_name("run.py"))
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)
SHA = "a" * 40


class CandidateHarnessTests(unittest.TestCase):
    def test_execution_config_requires_frozen_source_for_retest(self):
        value = {"mode": "build", "productSHA": "self", "candidateRunId": None, "suites": ["black-box", "scheduler", "ui", "native-ui"], "schedulerCases": None}
        self.assertEqual(a.validate_execution(value, SHA)["productSHA"], SHA)
        with self.assertRaises(RuntimeError):
            a.validate_execution({**value, "mode": "reuse"}, SHA)
        valid = {**value, "mode": "reuse", "productSHA": "b" * 40, "candidateRunId": "123", "suites": ["ui"]}
        self.assertEqual(a.validate_execution(valid, SHA)["candidateRunId"], "123")
        for field, bad in (("productSHA", "main"), ("suites", ["all"]), ("candidateRunId", "-1"), ("schedulerCases", "evil")):
            with self.subTest(field=field), self.assertRaises(RuntimeError):
                a.validate_execution({**valid, field: bad}, SHA)

    def test_archive_digest_and_sidecar_are_checked(self):
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / a.package_name("arm64")
            file.write_bytes(b"synthetic ZIP")
            digest = hashlib.sha256(file.read_bytes()).hexdigest()
            sidecar = Path(str(file) + ".sha256")
            sidecar.write_text(digest + "  " + file.name + "\n")
            self.assertEqual(a.verify_zip(file, "arm64"), digest)
            file.write_bytes(b"tampered")
            with self.assertRaises(RuntimeError):
                a.verify_zip(file, "arm64")
            sidecar.write_text(digest + "  other.zip\n")
            with self.assertRaises(RuntimeError):
                a.verify_zip(file, "arm64")

    def test_metadata_rejects_different_source_or_release(self):
        good = {"version": "1.3.4", "sourceCommit": SHA, "platform": "darwin", "arch": "arm64", "fullyVerified": False, "status": "unpublished-candidate"}
        a.verify_metadata(good, "arm64", SHA)
        for key, bad in (("version", "1.3.5"), ("sourceCommit", "b" * 40), ("arch", "x64"), ("fullyVerified", True), ("status", "published-with-limitations")):
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                a.verify_metadata({**good, key: bad}, "arm64", SHA)

    def test_missing_required_or_pending_cannot_pass_gate(self):
        required = a.required_ids(["black-box", "ui", "native-ui"], None)
        cases = [{"id": cid, "status": "pass"} for cid in required]
        self.assertEqual(a.gate(cases, required), [])
        self.assertTrue(a.gate(cases[:-1], required))
        self.assertTrue(a.gate([{**c, "status": "pending"} for c in cases], required))
        self.assertTrue(a.gate(cases + [cases[0]], required))
        self.assertTrue(a.gate(cases + [{"id": "cleanup", "status": "fail"}], required))
        # Explicitly excluded unsafe ACL scenario may be untested, never silently required.
        self.assertEqual(a.gate(cases + [{"id": "C-native-launchctl-query-denied", "status": "pending"}], required), [])

    def test_partial_report_is_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/"report.json"
            p.write_text(json.dumps({"cases":[{"id":"started","status":"pass"}]}))
            report=a.read_report(p,"ui",124)
            self.assertTrue(any(c["status"]=="fail" for c in report["cases"]))

    def test_untrusted_zip_paths_and_links_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            file=Path(tmp)/"bad.zip"
            with zipfile.ZipFile(file,"w") as z:
                z.writestr("../escape", "bad")
            with self.assertRaises(RuntimeError):
                a.extract_zip(file,Path(tmp)/"target")
            with zipfile.ZipFile(file,"w") as z:
                info=zipfile.ZipInfo("root/link");info.external_attr=0o120777<<16
                z.writestr(info,"../escape")
            with self.assertRaises(RuntimeError):
                a.extract_zip(file,Path(tmp)/"target")

    def test_shared_smoke_inspects_internal_candidate_without_executing_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); archive=root/a.package_name("arm64")
            notice=(Path(__file__).resolve().parents[2]/"shared/CANDIDATE-NOTICE.txt").read_text(encoding="utf-8")
            metadata={"version":"1.3.4","sourceCommit":SHA,"platform":"darwin","arch":"arm64","fullyVerified":False,"status":"unpublished-candidate"}
            def make(extra=None):
                files={"candidate.json":json.dumps(metadata),"CANDIDATE-NOTICE.txt":notice,
                    "runtime/bin/node":"synthetic runtime never executed", "portable-server.mjs":"synthetic", "dist/server/index.js":"synthetic", "reminder-worker.mjs":"synthetic", "tools/import-data.mjs":"synthetic", "LICENSE":"synthetic", "Anthropology Canteen.command":"synthetic", "tools/anthropology-canteen-keychain":"synthetic"}
                if extra: files.update(extra)
                with zipfile.ZipFile(archive,"w") as z:
                    for name, value in files.items():
                        info=zipfile.ZipInfo("candidate/"+name);info.external_attr=0o100755<<16
                        z.writestr(info,value)
                Path(str(archive)+".sha256").write_text(hashlib.sha256(archive.read_bytes()).hexdigest()+"  "+archive.name)
            smoke=Path(__file__).resolve().parents[2]/"shared/candidate-smoke.py"
            args=[sys.executable,str(smoke),str(archive),"--inspect-only","--internal-validation","--version","1.3.4","--platform","darwin","--arch","arm64","--source-sha",SHA,"--report",str(root/"report.json")]
            make(); result=subprocess.run(args,capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            # Same displayed version must not let an internal candidate pass as a release.
            result=subprocess.run(args+["--release"],capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0)
            make({"CANDIDATE-NOTICE.txt":notice.replace("INTERNAL VALIDATION ONLY", "unmarked")})
            result=subprocess.run(args,capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0)
            make({"data/anthropology-canteen-data.json":"{}"});result=subprocess.run(args,capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0)


if __name__ == "__main__":
    unittest.main()
