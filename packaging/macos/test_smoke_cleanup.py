"""Offline cleanup-ownership regressions; never invokes launchctl or Keychain."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("smoke_cleanup", Path(__file__).with_name("smoke-cleanup.py"))
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)

class SmokeCleanupTests(unittest.TestCase):
    def fixture(self):
        root = "/private/tmp/anthropology-canteen-smoke.test123"
        label = "org.anthropology-canteen.reminder.smoke" + "a" * 18
        return {"version": 1, "uid": 501, "tempBase": "/private/tmp", "tempRoot": root,
                "home": "/Users/runner", "launchdLabel": label,
                "launchdPlist": "/Users/runner/Library/LaunchAgents/" + label + ".plist",
                "keychainService": "org.anthropology-canteen.smtp",
                "keychainAccounts": ["macos-smoke-" + "a" * 32, "smoke" + "a" * 18],
                "ownedProcesses": [{"pid": 125, "token": root + "/archive/root/portable-server.mjs"}],
                "cleanupCompleted": False}

    def test_ownership_accepts_only_exact_private_identities(self):
        a.validate_manifest(self.fixture(), 501)
        for key, value in [("uid", 0), ("tempRoot", "/Users/runner"),
                           ("tempBase", "/"), ("launchdLabel", "com.other.service"),
                           ("launchdPlist", "/Users/runner/Library/LaunchAgents/other.plist"),
                           ("keychainAccounts", ["personal"]), ("keychainService", "personal")]:
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                a.validate_manifest({**self.fixture(), key: value}, 501)

    def test_owned_process_filter_does_not_target_other_users_or_similar_paths(self):
        value = self.fixture(); root = value["tempRoot"]
        output = (f"125 501 /usr/bin/node {root}/archive/root/portable-server.mjs\n"
                  f"126 502 /usr/bin/node {root}/archive/root/portable-server.mjs\n"
                  f"127 501 /usr/bin/node {root}-other/portable-server.mjs\n"
                  "128 501 /usr/bin/node /other/portable-server.mjs\n")
        self.assertEqual([p["pid"] for p in a.owned_processes(output, value)], [125])

    def test_reused_pid_is_not_owned(self):
        value = self.fixture()
        self.assertEqual(a.owned_processes("125 501 /usr/bin/node /other/server.mjs", value), [])
        value["ownedProcesses"].append({"pid": 200, "token": "http://127.0.0.1:45678/api/browser-session"})
        a.validate_manifest(value, 501)
        self.assertEqual([p["pid"] for p in a.owned_processes("200 501 /usr/bin/curl http://127.0.0.1:45678/api/browser-session", value)], [200])

    def test_query_failures_are_not_absence(self):
        self.assertTrue(a.job_absent(113, "Could not find service test in domain for user gui: 501"))
        self.assertFalse(a.job_absent(0, "loaded"))
        self.assertFalse(a.job_absent(1, "Permission denied"))
        self.assertTrue(a.item_absent(44, "security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain."))
        self.assertFalse(a.item_absent(1, "User interaction is not allowed"))

if __name__ == "__main__": unittest.main()
