"""Strict, branch-scoped r1 execution and original artifact provenance."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import urllib.request
from urllib.parse import urlsplit
import zipfile

REPO = "YZYanthrop/anthropology-canteen"
BRANCH = "codex/v1.3.4-reissue"
PLATFORMS = {
    "win32-x64": {"id":"win32-x64", "runner":"windows-latest", "platform":"win32", "arch":"x64", "root":"Anthropology-Canteen-Windows-x64-v1.3.4-r1"},
    "darwin-arm64": {"id":"darwin-arm64", "runner":"macos-15", "platform":"darwin", "arch":"arm64", "root":"Anthropology-Canteen-macOS-Apple-Silicon-arm64-v1.3.4-r1"},
    "darwin-x64": {"id":"darwin-x64", "runner":"macos-15-intel", "platform":"darwin", "arch":"x64", "root":"Anthropology-Canteen-macOS-Intel-x64-v1.3.4-r1"},
}
MAC_SUITES = ["black-box", "scheduler", "ui", "native-ui", "migration", "native-smoke"]


def require(ok, message):
    if not ok: raise ValueError(message)


def validate(value, test_sha):
    require(isinstance(value,dict), "Execution must be an object")
    require(set(value) == {"mode","productSHA","artifactRunId","platforms","macSuites","sequence"}, "Unknown or missing execution fields")
    require(re.fullmatch(r"[0-9a-f]{40}", test_sha or ""), "Exact test SHA required")
    require(type(value["sequence"]) is int and value["sequence"] > 0, "Positive sequence required")
    mode=value["mode"]
    require(mode in {"build","retest"}, "Only fresh build or immutable artifact retest allowed")
    sha=test_sha if mode == "build" and value["productSHA"] == "self" else value["productSHA"]
    require(isinstance(sha,str) and re.fullmatch(r"[0-9a-f]{40}",sha), "Exact product SHA required")
    platforms=value["platforms"]
    require(isinstance(platforms,list) and all(isinstance(x,str) for x in platforms) and platforms and len(platforms)==len(set(platforms)) and set(platforms)<=set(PLATFORMS), "Invalid or duplicate native platforms")
    suites=value["macSuites"]
    require(isinstance(suites,list) and all(isinstance(x,str) for x in suites) and len(suites)==len(set(suites)) and set(suites)<=set(MAC_SUITES), "Invalid or duplicate Mac suites")
    if any(x.startswith("darwin-") for x in platforms): require(suites, "Selected Mac runner requires explicit suites")
    if mode == "build":
        require(value["productSHA"] == "self" and sha == test_sha and value["artifactRunId"] is None, "Fresh build must freeze its own commit and cannot reuse an artifact")
        require(platforms == list(PLATFORMS) and suites == MAC_SUITES, "Fresh build requires all three native platforms and full acceptance")
    else:
        require(isinstance(value["artifactRunId"],str) and re.fullmatch(r"[1-9][0-9]*",value["artifactRunId"]), "Retest requires original build run ID")
    return {**value, "productSHA":sha, "scope":"full-build" if mode=="build" else "targeted-retest"}


def artifact_name(platform, sha):
    require(platform in PLATFORMS, "Unsupported artifact platform")
    return f"v1.3.4-r1-package-{platform}-{sha}"


def validate_run(run, sha, run_id):
    require(str(run.get("id")) == run_id, "Wrong artifact run ID")
    require(run.get("head_sha") == sha and run.get("head_branch") == BRANCH, "Artifact run source or branch differs")
    require(run.get("repository",{}).get("full_name") == REPO and run.get("head_repository",{}).get("full_name") == REPO, "Artifact run repository differs")
    require(run.get("event") == "push" and run.get("path") == ".github/workflows/portable-release.yml", "Artifact must come from scoped portable build entry")
    require(run.get("status") == "completed", "Wait for original run to finish; do not race active build")


def choose_artifact(items, platform, sha, run_id):
    matches=[x for x in items if x.get("name") == artifact_name(platform,sha)]
    require(len(matches) == 1, "Original platform artifact must exist exactly once")
    item=matches[0]
    require(not item.get("expired",True) and isinstance(item.get("size_in_bytes"),int) and item["size_in_bytes"]>0, "Artifact expired or empty")
    require(re.fullmatch(r"sha256:[0-9a-f]{64}",item.get("digest") or ""), "Artifact API SHA256 required")
    provenance=item.get("workflow_run",{})
    require(str(provenance.get("id"))==run_id and provenance.get("head_sha")==sha and provenance.get("head_branch")==BRANCH, "Artifact provenance differs from original frozen build")
    return item


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        redirected=super().redirect_request(req,fp,code,msg,headers,newurl)
        if redirected and urlsplit(req.full_url).netloc != urlsplit(newurl).netloc:
            redirected.remove_header("Authorization")
        return redirected


def request(endpoint):
    token=os.environ.get("GH_TOKEN")
    require(token, "Read-only Actions token required")
    url=f"https://api.github.com/repos/{REPO}/{endpoint}"
    req=urllib.request.Request(url,headers={"Accept":"application/vnd.github+json","Authorization":"Bearer "+token,"X-GitHub-Api-Version":"2022-11-28","User-Agent":"canteen-r1-artifact-verifier"})
    return urllib.request.build_opener(SafeRedirect()).open(req,timeout=120)


def api(endpoint):
    with request(endpoint) as response: return json.load(response)


def download(config, source, platform, destination, reports):
    sha,run_id=config["productSHA"],config["artifactRunId"]
    require(config["mode"]=="retest", "Download only replaces rebuilding during retest")
    original=validate(json.loads((source/"packaging/reissue/execution.json").read_text()),sha)
    require(original["mode"]=="build", "Frozen source must contain original full build configuration")
    run=api(f"actions/runs/{run_id}")
    validate_run(run,sha,run_id)
    items=[]
    page=1
    while True:
        batch=api(f"actions/runs/{run_id}/artifacts?per_page=100&page={page}")["artifacts"]
        items+=batch
        if len(batch)<100: break
        page+=1
        require(page<20,"Unexpected artifact pagination")
    item=choose_artifact(items,platform,sha,run_id)
    require(not destination.exists() or not any(destination.iterdir()), "Artifact destination must be empty")
    destination.mkdir(parents=True,exist_ok=True)
    reports.mkdir(parents=True,exist_ok=True)
    transfer=reports/"original-artifact.zip"
    with request(f"actions/artifacts/{item['id']}/zip") as response, transfer.open("wb") as output:
        while chunk:=response.read(1024*1024): output.write(chunk)
    with transfer.open("rb") as stream: actual=hashlib.file_digest(stream,"sha256").hexdigest()
    require(actual==item["digest"].split(":")[1], "Actions artifact transfer SHA256 mismatch")
    filename=PLATFORMS[platform]["root"]+".zip"
    with zipfile.ZipFile(transfer) as archive:
        require(sorted(archive.namelist())==sorted([filename,filename+".sha256"]), "Artifact must contain only original ZIP and sidecar")
        require(archive.testzip() is None,"Artifact CRC failure")
        for name in archive.namelist(): (destination/name).write_bytes(archive.read(name))
    (reports/"artifact-provenance.json").write_text(json.dumps({"run":run,"artifact":item,"downloadSHA256":actual,"productSHA":sha,"testSHA":os.environ.get("GITHUB_SHA"),"bytesReused":True},ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    # The transfer ZIP is evidence, not a final product; retain it in the report.


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config",type=Path,required=True)
    parser.add_argument("--download",choices=PLATFORMS)
    parser.add_argument("--source",type=Path)
    parser.add_argument("--destination",type=Path)
    parser.add_argument("--reports",type=Path)
    args=parser.parse_args()
    require(os.environ.get("GITHUB_REF")=="refs/heads/"+BRANCH and os.environ.get("GITHUB_REPOSITORY")==REPO and os.environ.get("GITHUB_EVENT_NAME")=="push", "Only approved repository branch push may execute r1")
    config=validate(json.loads(args.config.read_text()),os.environ.get("GITHUB_SHA"))
    if args.download:
        require(all([args.source,args.destination,args.reports]),"Missing download paths")
        require(args.download in config["platforms"],"Platform not selected")
        download(config,args.source.resolve(),args.download,args.destination.resolve(),args.reports.resolve())
    else:
        result={"mode":config["mode"],"scope":config["scope"],"product_sha":config["productSHA"],"matrix":json.dumps({"include":[PLATFORMS[x] for x in config["platforms"]]},separators=(",",":")),"artifact_run":config["artifactRunId"] or ""}
        with open(os.environ["GITHUB_OUTPUT"],"a",encoding="utf-8") as output:
            for key,value in result.items(): output.write(f"{key}={value}\n")
        print(json.dumps(config,indent=2))

if __name__=="__main__": main()
