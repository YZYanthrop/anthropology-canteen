// Interactive current-source UAC checks. --prepare performs no task mutation.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { offlineWorkerSource } from "../../macos/basic-acceptance/native-ui.mjs";

const exec = promisify(execFile), argv = process.argv.slice(2), mode = argv.shift();
const options = Object.fromEntries(argv.filter((_,i)=>i%2===0).map((key,i)=>[key.slice(2),argv[i*2+1]]));
assert.equal(process.platform,"win32");
assert.ok(["--prepare","--cancel-new","--register-old","--cancel-update","--verify-cleanup"].includes(mode));
const source=resolve(options.source), reports=resolve(options.reports), sha=options["product-sha"];
assert.match(sha,/^[a-f0-9]{40}$/);
await exec("git",["-C",source,"diff","--exit-code",sha,"--","reminder-scheduler.mjs","reminder-utils.mjs","tools"]);
const scheduler=await import(pathToFileURL(join(source,"reminder-scheduler.mjs")));
const here=dirname(fileURLToPath(import.meta.url)), manifestPath=join(reports,"owned.json");
const shellArgs=["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File"];
const states=async root=>Object.fromEntries(await Promise.all((await readdir(join(root,"data"))).sort().map(async name=>[name,(await readFile(join(root,"data",name))).toString("base64")])));
async function observe(receipt) {
  return JSON.parse((await exec("powershell.exe",[...shellArgs,join(here,"native-state.ps1"),"-TaskName",receipt.name,"-OwnedRoot",receipt.scratch],{windowsHide:true,timeout:45000})).stdout.trim().replace(/^\uFEFF/,""));
}
if(mode==="--prepare") {
  await mkdir(reports,{recursive:true});
  const scratch=await mkdtemp(join(tmpdir(),"canteen-reissue-uac-"));
  const oldRoot=join(scratch,"old"),newRoot=join(scratch,"new");
  const config={installationId:randomUUID(),enabled:true,schedule:{time:new Date(Date.now()+12*3600000).toTimeString().slice(0,5)}};
  for(const root of [oldRoot,newRoot]) {
    for(const name of ["tools","runtime","data"])await mkdir(join(root,name),{recursive:true});
    await copyFile(process.execPath,join(root,"runtime/node.exe"));
    await writeFile(join(root,"reminder-worker.mjs"),offlineWorkerSource(join(scratch,"executions.jsonl")));
    for(const name of ["register-windows-reminder.ps1","elevate-windows-reminder.ps1","inspect-windows-reminder.ps1","windows-reminder-task-common.ps1"])await copyFile(join(source,"tools",name),join(root,"tools",name));
    await writeFile(join(root,"data/anthropology-canteen-settings.json"),JSON.stringify({version:3,reminders:config}));
    await writeFile(join(root,"data/anthropology-canteen-reminder-scheduler.json"),JSON.stringify({syntheticOriginal:true}));
  }
  const receipt={productSHA:sha,testSHA:(await exec("git",["-C",source,"rev-parse","HEAD"])).stdout.trim(),scratch,oldRoot,newRoot,config,name:`Anthropology Canteen Reminder ${config.installationId.slice(0,12)}`};
  await writeFile(manifestPath,JSON.stringify(receipt,null,2));
  assert.equal((await observe(receipt)).exists,false);
  console.log(JSON.stringify({prepared:true,manifest:manifestPath,task:receipt.name,noTaskMutation:true,next:"Notify user; cancel-new requires choosing No in real UAC."}));
} else {
  const receipt=JSON.parse(await readFile(manifestPath,"utf8"));assert.equal(receipt.productSHA,sha);
  assert.ok(resolve(receipt.scratch).startsWith(resolve(tmpdir())+"\\canteen-reissue-uac-"));
  const before=await observe(receipt);
  if(mode==="--verify-cleanup") {
    assert.equal(before.exists,false);assert.ok(!(await readdir(receipt.scratch)).includes("executions.jsonl"));
    await writeFile(join(reports,"cleanup-confirmed.json"),JSON.stringify({productSHA:sha,taskAbsent:true,workerInvocations:0}));
  } else if(mode==="--register-old") {
    assert.equal(before.exists,false);
    await scheduler.installScheduler(receipt.oldRoot,receipt.config);
    const after=await observe(receipt);assert.equal(after.exists,true);assert.equal(after.runLevel,"Limited");assert.equal(resolve(after.root),receipt.oldRoot);
    await writeFile(join(reports,"registered-old.json"),JSON.stringify({productSHA:sha,task:after},null,2));
    console.log("Owned old task registered; notify user before cancel-update UAC.");
  } else {
    assert.equal(before.exists,mode==="--cancel-update");
    const oldBytes=await states(receipt.oldRoot),newBytes=await states(receipt.newRoot);
    await assert.rejects(scheduler.installScheduler(receipt.newRoot,receipt.config),error=>error.code==="SCHEDULER_ELEVATION_CANCELLED");
    const after=await observe(receipt);assert.deepEqual(after,before);
    assert.deepEqual(await states(receipt.oldRoot),oldBytes);assert.deepEqual(await states(receipt.newRoot),newBytes);
    assert.ok(!(await readdir(receipt.scratch)).includes("executions.jsonl"));
    await writeFile(join(reports,mode.slice(2)+".json"),JSON.stringify({productSHA:sha,testSHA:receipt.testSHA,case:mode,passed:true,originalNativeStateUnchanged:true,oldAndNewFilesUnchanged:true,workerInvocations:0,task:before},null,2));
    console.log("Real UAC cancellation retained original task and local files; no worker execution.");
  }
}