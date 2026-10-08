"""Run the new frozen-source shared verification; no historical result reuse."""
import argparse
import os
from pathlib import Path
import sys
from common import checkout, run, save, tools


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source",required=True,type=Path)
    parser.add_argument("--reports",required=True,type=Path)
    parser.add_argument("--product-sha",required=True)
    args=parser.parse_args()
    source,reports=args.source.resolve(),args.reports.resolve()
    result={"productSHA":args.product_sha,"testSHA":os.environ.get("GITHUB_SHA"),"runID":os.environ.get("GITHUB_RUN_ID"),"runAttempt":os.environ.get("GITHUB_RUN_ATTEMPT"),"checks":[],"fullyVerified":False}
    try:
        checkout(source,args.product_sha)
        if args.product_sha!=os.environ.get("GITHUB_SHA"): raise ValueError("Shared baseline verification must execute at frozen S=T")
        node,pnpm,result["toolchain"]=tools(source)
        checks=[("lint",[pnpm,"lint"]),("build",[pnpm,"build"]),("node",[node,"--test","tests/*.test.mjs"]),("ui",[pnpm,"test:ui"])]
        checks += [("tools-"+str(index),[sys.executable,"-B",path]) for index,path in enumerate([
            "packaging/reissue/test_execution.py", "packaging/macos/basic-acceptance/test_harness.py",
            "packaging/macos/basic-acceptance/test_reissue.py", "packaging/macos/acceptance-v134/test_harness.py",
            "packaging/windows/reissue-acceptance/test_harness.py", "packaging/macos/test_smoke_cleanup.py", "packaging/macos/test_smoke_completion.py"])]
        # New shared smoke tests are named consistently; fail if none were supplied.
        shared_tests=sorted((source/"packaging/shared").glob("test_*.py"))
        if not shared_tests: raise ValueError("Missing r1 shared package regression tests")
        checks += [("shared-tools-"+str(index),[sys.executable,"-B",path]) for index,path in enumerate(shared_tests)]
        for name,command in checks:
            code=run(command,reports/(name+".log"),cwd=source,timeout=1200)
            result["checks"].append({"name":name,"command":[str(x) for x in command],"exitCode":code,"status":"pass" if code==0 else "fail"})
        checkout(source,args.product_sha)
    except Exception as error:
        result["error"]=str(error)
    result["passed"]=bool(result["checks"]) and not result.get("error") and all(c["status"]=="pass" for c in result["checks"])
    save(reports/"shared-summary.json",result)
    return int(not result["passed"])

if __name__=="__main__": sys.exit(main())
