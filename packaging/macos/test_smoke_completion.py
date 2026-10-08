"""Completion evidence must reject a zero shell status before all checks finish."""
import importlib.util
import unittest
import subprocess
import sys
import tempfile
from pathlib import Path

class CompletionTests(unittest.TestCase):
    def load(self):
        spec=importlib.util.spec_from_file_location("smoke_completion",Path(__file__).with_name("smoke_result.py"))
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
    def test_zero_exit_or_cleanup_alone_cannot_prove_smoke_completion(self):
        a=self.load();s="a"*40;digest="b"*64
        good={"status":"pass","productSHA":s,"arch":"arm64","zipSHA256":digest,"checks":list(a.REQUIRED)}
        a.validate(good,s,"arm64",digest)
        for value in [{},{"status":"pass"},{**good,"checks":good["checks"][:-1]},{**good,"productSHA":"c"*40},{**good,"zipSHA256":"d"*64},{**good,"arch":"x64"}]:
            with self.subTest(value=value), self.assertRaises(ValueError):a.validate(value,s,"arm64",digest)
    @unittest.skipUnless(sys.platform == "darwin", "Real /bin/bash control-flow regression executes in Mac retest")
    def test_real_shell_waits_for_pid_and_rejects_premature_zero_exit(self):
        script=Path(__file__).with_name("smoke-test.sh").read_text(encoding="utf-8")
        start=script.index("for ((attempt",script.index('PID_FILE="$EXTRACTED_ROOT'))
        loop=script[start:script.index("done",start)+4]
        with tempfile.TemporaryDirectory(prefix="canteen-smoke-control-") as root:
            pid=Path(root)/"synthetic pid"
            result=subprocess.run(["/bin/bash","-uc",'PID_FILE="$1"; (sleep 0.05; printf 123 > "$PID_FILE") & '+loop+'; wait; [[ -f "$PID_FILE" ]] && echo reached',"fixture",str(pid)],capture_output=True,text=True,timeout=25)
            self.assertEqual(result.returncode,0,result.stderr);self.assertEqual(result.stdout.strip(),"reached")
        guard=script[script.index("cleanup() {"):script.index("  # Keep logs")]+ '  exit "$original_exit"\n}\n'
        for completed,expected in [("false",1),("true",0)]:
            result=subprocess.run(["/bin/bash","-uc",'SMOKE_COMPLETED='+completed+'\n'+guard+'trap cleanup EXIT\nexit 0'],capture_output=True,text=True,timeout=10)
            self.assertEqual(result.returncode,expected,result.stderr)

    def test_shell_requires_terminal_receipt_and_has_no_file_test_in_arithmetic(self):
        script=Path(__file__).with_name("smoke-test.sh").read_text(encoding="utf-8")
        self.assertNotIn('attempt < 20 && ! -f',script)
        self.assertIn('SMOKE_COMPLETED="false"',script)
        self.assertIn('"$SMOKE_COMPLETED" != "true"',script)
        self.assertIn('smoke_result.py',script)
        self.assertLess(script.index('smoke_result.py'),script.index('SMOKE_COMPLETED="true"'))
if __name__=="__main__":unittest.main()
