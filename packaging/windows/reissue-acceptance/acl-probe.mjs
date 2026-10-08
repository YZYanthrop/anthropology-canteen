// Diagnose native ACL conditions without changing the product or any real data.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
const opts=Object.fromEntries(process.argv.slice(2).filter((_,i)=>i%2===0).map((k,i)=>[k.slice(2),process.argv.slice(2)[i*2+1]]));
assert.equal(process.platform,"win32");
assert.ok(["yes","no"].includes(opts["require-denial"]));
const exec=promisify(execFile), source=resolve(opts.source), reportPath=resolve(opts.report);
const {setWindowsFixtureAccess}=await import(pathToFileURL(join(source,"tests/helpers/windows-files.mjs")));
const report={label:opts.label, node:process.version, executable:process.execPath, checks:[], cleanup:false};
const root=await mkdtemp(join(tmpdir(),"canteen-discovery-acl-probe-")), file=join(root,"synthetic.json");
let rootDenied=false,fileDenied=false,fileCreated=false;
try {
  await writeFile(file,'{"synthetic":true}');fileCreated=true;
  report.privileges=(await exec(join(process.env.SystemRoot,"System32","whoami.exe"),["/priv","/fo","csv"],{windowsHide:true,timeout:15000})).stdout;
  for(const [mode,target,operation] of [["DenyList",root,()=>readdir(root)],["DenyRead",file,()=>readFile(file)]]) {
    if(mode==="DenyList") rootDenied=true; else fileDenied=true;
    await setWindowsFixtureAccess(root,target,mode);
    let code="read-succeeded";
    try { await operation(); } catch(error) { code=error.code; }
    report.checks.push({mode,observed:code,denied:["EACCES","EPERM"].includes(code)});
    await setWindowsFixtureAccess(root,target,mode==="DenyList"?"AllowList":"AllowRead");
    if(mode==="DenyList") rootDenied=false; else fileDenied=false;
    await operation(); // Recovery must restore real access too.
  }
  report.denialEffective=report.checks.every(c=>c.denied);
  if(opts["require-denial"]==="yes") assert.ok(report.denialEffective,"ACL fault precondition ineffective; do not label product behavior as a failure or pass");
} catch(error) { report.error=error.stack;process.exitCode=1; }
finally {
  try {
    if(rootDenied) await setWindowsFixtureAccess(root,root,"AllowList");
    if(fileDenied) await setWindowsFixtureAccess(root,file,"AllowRead");
    if(fileCreated) assert.equal(await readFile(file,"utf8"),'{"synthetic":true}');
    assert.deepEqual(await readdir(root),fileCreated?["synthetic.json"]:[]);
    await rm(root,{recursive:true});report.cleanup=true;
  } catch(error) { report.cleanupError=error.stack;report.syntheticRoot=root;process.exitCode=1; }
  await mkdir(dirname(reportPath),{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify({label:report.label,checks:report.checks,cleanup:report.cleanup,error:report.error}));
}
