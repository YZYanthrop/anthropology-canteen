"""Coordinate native r1 acceptance with immutable package and separate test source."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import sys
from common import checkout, run, save, tools
from execution import PLATFORMS, validate, require


def digest(path):
    with path.open("rb") as stream: return hashlib.file_digest(stream,"sha256").hexdigest()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ["source","packages","scratch","reports"]: parser.add_argument("--"+name,required=True,type=Path)
    parser.add_argument("--platform",required=True,choices=PLATFORMS)
    parser.add_argument("--cleanup",action="store_true")
    args=parser.parse_args()
    source,packages,scratch,reports=[x.resolve() for x in (args.source,args.packages,args.scratch,args.reports)]
    acceptance=Path(__file__).resolve().parents[2]
    config=validate(json.loads((Path(__file__).with_name("execution.json")).read_text()),os.environ.get("GITHUB_SHA"))
    sha=config["productSHA"]
    target=PLATFORMS[args.platform]
    archive=packages/(target["root"]+".zip")
    require(args.platform in config["platforms"],"Unselected platform")
    require(sys.platform==target["platform"] and platform.machine().lower() in ({"x64":["amd64","x86_64"],"arm64":["arm64","aarch64"]}[target["arch"]]),"Native runner platform or architecture differs")
    reports.mkdir(parents=True,exist_ok=True)
    basic=acceptance/"packaging/macos/basic-acceptance/run.py"
    windows=acceptance/"packaging/windows/reissue-acceptance/run.py"
    common=["--source",source,"--product-sha",sha,"--scratch",scratch,"--reports",reports/"acceptance"]
    result={"productSHA":sha,"testSHA":os.environ.get("GITHUB_SHA"),"workflowSHA":os.environ.get("GITHUB_SHA"),"runID":os.environ.get("GITHUB_RUN_ID"),"runAttempt":os.environ.get("GITHUB_RUN_ATTEMPT"),"sourceBranch":"codex/v1.3.4-reissue","platform":target["platform"],"arch":target["arch"],"mode":config["mode"],"scope":config["scope"],"selection":config,"phases":[],"fullyVerified":False,"releaseAuthorizedByThisScript":False}
    def phase(name,command,timeout):
        code=run(command,reports/(name+".log"),cwd=source,timeout=timeout)
        result["phases"].append({"name":name,"exitCode":code,"status":"pass" if code==0 else "fail"})
        return code
    try:
        if args.cleanup:
            if target["platform"]=="win32":
                phase("final-cleanup",[sys.executable,"-B",windows,"--cleanup-only","--package",archive,*common],300)
            else:
                phase("final-cleanup",[sys.executable,"-B",basic,"--reissue","--cleanup","--arch",target["arch"],*common],300)
                phase("native-smoke-final-cleanup",[sys.executable,"-B",acceptance/"packaging/macos/smoke-cleanup.py","--manifest",reports/"native-smoke/smoke-owned.json","--report",reports/"native-smoke/smoke-cleanup-final.json"],180)
        else:
            checkout(source,sha)
            _,_,result["toolchain"]=tools(source)
            require(sorted(p.name for p in packages.glob("*.zip*"))==sorted([archive.name,archive.name+".sha256"]),"Expected exactly original ZIP and sidecar")
            before=digest(archive)
            result["package"]={"name":archive.name,"sha256":before,"size":archive.stat().st_size,"sidecarSHA256":digest(Path(str(archive)+".sha256"))}
            if target["platform"]=="win32":
                phase("windows-acceptance",[sys.executable,"-B",windows,"--package",archive,*common],3000)
            else:
                suites=[x for x in config["macSuites"] if x!="native-smoke"]
                if suites:
                    phase("macos-acceptance",[sys.executable,"-B",basic,"--reissue","--arch",target["arch"],"--candidate",archive,*common,"--suites",*suites],2400)
                if "native-smoke" in config["macSuites"]:
                    spec=importlib.util.spec_from_file_location("zip_helper",acceptance/"packaging/macos/acceptance-v134/run.py")
                    helper=importlib.util.module_from_spec(spec); spec.loader.exec_module(helper)
                    extracted=helper.extract_zip(archive,scratch.parent/(scratch.name+"-smoke-archive"))
                    phase("native-smoke",["bash",acceptance/"packaging/macos/smoke-test.sh",extracted,archive,target["arch"],reports/"native-smoke"],480)
            require(digest(archive)==before,"Final package bytes changed during acceptance")
            checkout(source,sha)
    except Exception as error:
        result["error"]=str(error)
    result["selectedPhasesPassed"]=bool(result["phases"]) and not result.get("error") and all(p["status"]=="pass" for p in result["phases"])
    result["notCovered"]=["Manual Finder/Gatekeeper","Real login/logout, sleep/wake, full reboot","Unsafe isolated scheduler query ACL","Alternate administrator identity","Real email and providers"]
    result["localUACCancellation"]="Separate coordinated local evidence required; cloud success does not waive this gate"
    save(reports/("cleanup-coordinator.json" if args.cleanup else "native-coordinator.json"),result)
    return int(not result["selectedPhasesPassed"])

if __name__=="__main__": sys.exit(main())
