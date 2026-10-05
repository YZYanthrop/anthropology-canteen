"""Bounded command logs and exact checkout/toolchain checks for CI harnesses."""
import json
import os
from pathlib import Path
import platform
import shutil
import signal
import subprocess
import sys
import time


def run(args, log, cwd=None, timeout=900):
    log.parent.mkdir(parents=True,exist_ok=True)
    flags={"creationflags":subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW} if sys.platform=="win32" else {"start_new_session":True}
    started=time.monotonic()
    with log.open("w",encoding="utf-8") as stream:
        child=subprocess.Popen([str(x) for x in args],cwd=cwd,stdout=stream,stderr=subprocess.STDOUT,**flags)
        try: code=child.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            if sys.platform=="win32":
                subprocess.run(["taskkill.exe","/PID",str(child.pid),"/T","/F"],stdout=stream,stderr=subprocess.STDOUT,timeout=30)
            else:
                os.killpg(child.pid,signal.SIGTERM)
                try: child.wait(timeout=20)
                except subprocess.TimeoutExpired: os.killpg(child.pid,signal.SIGKILL)
            child.wait(timeout=30)
            stream.write("\nHARNESS TIMEOUT; always-cleanup must inspect manifest-owned resources.\n")
            code=124
    print(f"{log.name}: exit={code}, seconds={time.monotonic()-started:.1f}",flush=True)
    if code:
        lines=log.read_text(encoding="utf-8",errors="replace").splitlines()
        print("\n".join(lines[-60:]),flush=True)
    return code


def save(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")


def checkout(source, sha):
    if subprocess.check_output(["git","-C",str(source),"rev-parse","HEAD"],text=True).strip()!=sha:
        raise ValueError("Source checkout differs from frozen product SHA")
    subprocess.run(["git","-C",str(source),"diff","--exit-code","HEAD","--","."],check=True,capture_output=True)
    metadata=json.loads((source/"package.json").read_text())
    if metadata["version"]!="1.3.4" or metadata["packageManager"]!="pnpm@11.9.0": raise ValueError("Product or pinned package manager changed")


def tools(source):
    node=shutil.which("node")
    pnpm=shutil.which("pnpm.cmd" if sys.platform=="win32" else "pnpm")
    if not node or not pnpm: raise ValueError("Missing pinned node/pnpm")
    node_version=subprocess.check_output([node,"--version"],cwd=source,text=True).strip()
    pnpm_version=subprocess.check_output([pnpm,"--version"],cwd=source,text=True).strip()
    if node_version!="v24.14.0" or pnpm_version!="11.9.0": raise ValueError("Unexpected build toolchain")
    return node,pnpm,{"node":node_version,"pnpm":pnpm_version,"python":sys.version,"system":platform.platform(),"runnerImage":os.environ.get("ImageVersion")}
