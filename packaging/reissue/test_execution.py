"""Negative regressions for r1 build/retest scope and artifact provenance."""
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("execution", Path(__file__).with_name("execution.py"))
x = importlib.util.module_from_spec(spec)
spec.loader.exec_module(x)
S = "a" * 40
T = "b" * 40

class ExecutionTests(unittest.TestCase):
    def config(self):
        return {"mode":"build", "productSHA":"self", "artifactRunId":None,
                "platforms":list(x.PLATFORMS), "macSuites":list(x.MAC_SUITES), "sequence":1}
    def test_build_requires_all_platforms_same_commit_and_complete_suites(self):
        value=x.validate(self.config(), S)
        self.assertEqual(value["productSHA"], S)
        self.assertEqual(value["scope"], "full-build")
        for patch in [{"productSHA":T}, {"artifactRunId":"123"}, {"platforms":["win32-x64"]},
                      {"macSuites":["black-box"]}, {"candidate_packages_only":True},
                      {"platforms":["win32-x64"] * 3}, {"sequence":True}, {"mode":"reuse"}]:
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                x.validate({**self.config(), **patch}, S)
    def test_retest_requires_exact_original_source_and_run_without_rebuild(self):
        good={**self.config(), "mode":"retest", "productSHA":S, "artifactRunId":"123", "platforms":["darwin-arm64"], "macSuites":["scheduler"], "sequence":2}
        value=x.validate(good,T)
        self.assertEqual(value["scope"],"targeted-retest")
        self.assertEqual(value["productSHA"],S)
        for patch in [{"productSHA":"self"}, {"productSHA":"abc123"}, {"artifactRunId":None},
                      {"artifactRunId":"123\nsecret"}, {"macSuites":[]}, {"macSuites":["ui","ui"]},
                      {"platforms":["linux-x64"]}, {"sequence":0}]:
            with self.subTest(patch=patch), self.assertRaises(ValueError): x.validate({**good,**patch},T)
        win={**good,"platforms":["win32-x64"],"macSuites":[]}
        self.assertEqual(x.validate(win,T)["platforms"],["win32-x64"])
    def test_run_provenance_rejects_other_source_branch_repository_or_workflow(self):
        run={"id":123,"head_sha":S,"head_branch":x.BRANCH,"event":"push","status":"completed",
             "path":".github/workflows/portable-release.yml","repository":{"full_name":x.REPO},
             "head_repository":{"full_name":x.REPO}}
        x.validate_run(run,S,"123")
        for patch in [{"head_sha":T}, {"head_branch":"main"}, {"path":".github/workflows/other.yml"},
                      {"event":"workflow_dispatch"}, {"status":"in_progress"}, {"id":999},
                      {"repository":{"full_name":"other/repo"}}, {"head_repository":{"full_name":"other/repo"}}]:
            with self.subTest(patch=patch),self.assertRaises(ValueError): x.validate_run({**run,**patch},S,"123")
    def test_artifact_requires_exact_unique_live_identity(self):
        item={"id":9,"name":x.artifact_name("darwin-x64",S),"expired":False,"size_in_bytes":123,
              "digest":"sha256:"+"c"*64,"workflow_run":{"id":123,"head_sha":S,"head_branch":x.BRANCH}}
        self.assertEqual(x.choose_artifact([item],"darwin-x64",S,"123")["id"],9)
        for values in [[],[item,item],[{**item,"expired":True}],[{**item,"digest":None}],
                       [{**item,"workflow_run":{**item["workflow_run"],"head_sha":T}}]]:
            with self.subTest(values=values),self.assertRaises(ValueError): x.choose_artifact(values,"darwin-x64",S,"123")
    def test_windows_scratch_uses_os_temp_and_independent_steps_share_it(self):
        workflow=(Path(__file__).resolve().parents[2]/".github/workflows/reissue-v134.yml").read_text()
        self.assertIn("acceptance/packaging/reissue/paths.py",workflow)
        for name in ["Execute native package and source-fault acceptance", "Independently clean and verify manifest-owned OS resources"]:
            step=workflow.split("- name: "+name,1)[1].split("      - name:",1)[0]
            self.assertIn("shell: python",step)
            self.assertNotIn("shell: bash",step)
        spec=importlib.util.spec_from_file_location("paths",Path(__file__).with_name("paths.py"))
        paths=importlib.util.module_from_spec(spec);spec.loader.exec_module(paths)
        runner=Path("runner-temp");native=Path("system-temp")
        win=paths.runner_paths(runner,native,"win32-x64","123","1")
        self.assertEqual(win["R1_SCRATCH"],native/"canteen-r1-123-1-win32-x64")
        self.assertEqual(win["R1_REPORTS"],runner/"r1-reports")
        mac=paths.runner_paths(runner,native,"darwin-arm64","123","1")
        self.assertEqual(mac["R1_SCRATCH"],runner/"canteen-r1-123-1-darwin-arm64")
        for identity in [("win32-x64","../123","1"),("win32-x64","123",""),("arbitrary","123","1")]:
            with self.assertRaises(ValueError): paths.runner_paths(runner,native,*identity)

    def test_workflow_never_grants_publication_or_rebuilds_final_tags(self):
        root=Path(__file__).resolve().parents[2]
        entry=(root/".github/workflows/portable-release.yml").read_text()
        workflow=(root/".github/workflows/reissue-v134.yml").read_text()
        self.assertIn('"!v1.3.4-r1"',entry)
        self.assertIn('paths: [packaging/reissue/execution.json]',entry)
        self.assertIn('uses: ./.github/workflows/reissue-v134.yml',entry)
        self.assertIn('on:\n  workflow_call:',workflow)
        self.assertNotIn('contents: write',workflow)
        self.assertNotIn('gh release',workflow)
        self.assertNotIn('git push',workflow)
        self.assertIn('retention-days: 30',workflow)
        self.assertIn('steps.acceptance.outcome',workflow)
        self.assertIn('--cleanup',workflow)
        self.assertIn('ref: ${{ needs.prepare.outputs.product_sha }}',workflow)
        self.assertIn('ref: ${{ github.sha }}',workflow)
        self.assertIn('macos-15-intel', json.dumps(x.PLATFORMS))
        self.assertIn('macos-15', json.dumps(x.PLATFORMS))

if __name__ == "__main__": unittest.main()
