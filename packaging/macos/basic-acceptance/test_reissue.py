import importlib.util
from pathlib import Path
import unittest
spec = importlib.util.spec_from_file_location("basic", Path(__file__).with_name("run.py"))
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)
class ReissueGate(unittest.TestCase):
    def test_fresh_reissue_requires_migration_keychain_and_all_original_cases(self):
        ids = a.required_ids(a.REISSUE_SUITES, None, reissue=True)
        self.assertEqual(len(ids), 73)
        self.assertIn("environment-keychain", ids)
        self.assertEqual(a.REGISTRATION_IDS, {"A-loaded-registration", "A-loaded-disabled-registration", "A-absent-registration"})
        self.assertNotIn("A-unloaded-registration", ids)
        self.assertNotIn("A-disabled-registration", ids)
        self.assertIn("A-unloaded-post-registration-query", ids)
        self.assertIn("A-disabled-post-registration-query", ids)
        self.assertIn("B-process-interruption", ids)
        self.assertIn("D-parent-denied-current-readable", ids)
        self.assertIn("migration.final-cleanup", ids)
        cases = [{"id": cid, "status": "pass"} for cid in ids]
        self.assertEqual(a.gate(cases, ids), [])
        for omitted in ["environment-keychain", "B-process-interruption", "D-parent-denied-current-readable", "A-loaded-registration", "scheduler.final-cleanup"]:
            self.assertTrue(a.gate([c for c in cases if c["id"] != omitted], ids))
    def test_reissue_rejects_old_candidate_identity(self):
        sha = "a" * 40
        good = {"version":"1.3.4", "sourceCommit":sha, "platform":"darwin", "arch":"arm64", "fullyVerified":False, "status":"prepared-for-release", "releaseRevision":"r1", "artifactVersion":"1.3.4-r1", "verificationScope":"three-platform-limited-reissue"}
        a.verify_metadata(good, "arm64", sha, reissue=True)
        with self.assertRaises(RuntimeError):
            a.verify_metadata({**good, "status":"unpublished-candidate"}, "arm64", sha, reissue=True)
        self.assertTrue(a.package_name("arm64", reissue=True).endswith("-v1.3.4-r1.zip"))
if __name__ == "__main__": unittest.main()
