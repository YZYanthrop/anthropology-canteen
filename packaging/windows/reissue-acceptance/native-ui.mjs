// Real owned disabled Windows task -> unchanged packaged API -> compiled page.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { classifyBrowserRequest, hashes, offlineWorkerSource } from "../../macos/basic-acceptance/native-ui.mjs";
const execute = promisify(execFile), argv = process.argv.slice(2);
const args = Object.fromEntries(argv.filter((_,i)=>i%2===0).map((key,i)=>[key.slice(2),argv[i*2+1]]));
const scratch=resolve(args.scratch), packageRoot=resolve(args.package), reportPath=resolve(args.report);
assert.equal(process.platform,"win32"); assert.match(args["product-sha"],/^[a-f0-9]{40}$/);
const root=join(scratch,"product"), worker=join(scratch,"offline-worker.mjs"), executions=join(scratch,"executions.jsonl");
const installationId=randomUUID(), name=`Anthropology Canteen Reminder ${installationId.slice(0,12)}`;
const report={productSHA:args["product-sha"],cases:[],cleanup:{},environment:{platform:process.platform,arch:process.arch,node:process.version}};
const exists=async p=>{try{await access(p);return true;}catch(e){if(e.code==="ENOENT")return false;throw e;}};
let server, context, serverClosed, taskOwned=false;
async function native(mode,extra=[]) { return JSON.parse((await execute("powershell.exe",["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",join(dirname(fileURLToPath(import.meta.url)),"native-state.ps1"),"-TaskName",name,"-OwnedRoot",scratch,"-Mode",mode,...extra],{windowsHide:true,timeout:45000})).stdout.trim().replace(/^\uFEFF/,"")); }
try {
  assert.equal(await exists(scratch),false,"fresh owned scratch required");await mkdir(scratch,{recursive:true});
  await cp(packageRoot,root,{recursive:true,errorOnExist:true,force:false});assert.equal(await exists(join(root,"data")),false);
  const before=await hashes(root), meta=JSON.parse(await readFile(join(root,"release.json"),"utf8"));
  assert.equal(meta.sourceCommit,args["product-sha"]);assert.equal(meta.releaseRevision,"r1");assert.equal(meta.platform,"win32");
  const node=join(root,"runtime/node.exe");await writeFile(worker,offlineWorkerSource(executions));
  const later=new Date(Date.now()+12*3600000);
  const config={enabled:true,installationId,credentialRef:installationId,provider:"custom",sender:"sender@example.invalid",recipient:"reader@example.invalid",host:"smtp.example.invalid",username:"sender@example.invalid",port:465,security:"tls",schedule:{cadence:"daily",time:`${String(later.getHours()).padStart(2,"0")}:${String(later.getMinutes()).padStart(2,"0")}`},schedulerPath:root};
  const data=join(root,"data");await mkdir(data);
  const json=(filename,value)=>writeFile(join(data,filename),JSON.stringify(value));
  await json("anthropology-canteen-data.json",{version:8,revision:0,subscriptions:{scholar:[],journal:[],keyword:[]},states:{},articleArchive:{},translations:{},scholarProfiles:{},feed:{items:[],scholars:[],updatedAt:new Date().toISOString(),source:"live",warnings:[],coverage:[]}});
  await json("anthropology-canteen-settings.json",{version:3,reminders:config});await json("anthropology-canteen-reminder-state.json",{version:2,items:{},baselines:{},baselineComplete:false});
  assert.equal(await exists(join(data,"anthropology-canteen-reminder-secret.json")),false,"synthetic credential must be absent");
  await writeFile(join(scratch,"owned.json"),JSON.stringify({sourceSHA:args["product-sha"],scratch,root,name,worker,processes:[]}));
  taskOwned=true;await native("FixtureDisabled",["-NodePath",node,"-WorkerPath",worker]);
  const osBefore=await native("Read");assert.equal(osBefore.enabled,false);
  const reservation=createServer();await new Promise((yes,no)=>{reservation.once("error",no);reservation.listen(0,"127.0.0.1",yes);});const port=reservation.address().port;await new Promise(yes=>reservation.close(yes));
  const base=`http://127.0.0.1:${port}`, env={...process.env,PORT:String(port)};for(const k of ["NODE_OPTIONS","OPENALEX_API_KEY","SEMANTIC_SCHOLAR_API_KEY"])delete env[k];
  server=spawn(node,[join(root,"portable-server.mjs")],{cwd:root,env,windowsHide:true,stdio:["ignore","pipe","pipe"]});
  let serverLog="";server.stdout.on("data",v=>{serverLog+=v;});server.stderr.on("data",v=>{serverLog+=v;});
  serverClosed=new Promise((yes,no)=>{server.once("close",yes);server.once("error",no);});
  await writeFile(join(scratch,"owned.json"),JSON.stringify({sourceSHA:args["product-sha"],scratch,root,name,worker,processes:[{kind:"server",pid:server.pid}]}));
  let token;
  for(let i=0;i<100;i++){assert.equal(server.exitCode,null,serverLog);try{token=(await(await fetch(base+"/api/runtime-status",{signal:AbortSignal.timeout(1000)})).json()).sessionToken;if(token)break;}catch{}await delay(200);}
  assert.ok(token,"server readiness");
  const api=await(await fetch(base+"/api/reminders/status",{headers:{"X-Anthropology-Canteen-Session":token}})).json();
  assert.equal(api.scheduler.status,"disabled");assert.equal(api.scheduler.installed,false);assert.ok(api.scheduler.reasonCodes.includes("task-disabled"));assert.equal(api.credentialStatus,"missing");assert.equal(api.scheduler.definitionValid,false,"offline external worker is deliberately not a current product definition");
  const {chromium}=await import(process.env.ACCEPTANCE_PLAYWRIGHT_MODULE?pathToFileURL(resolve(process.env.ACCEPTANCE_PLAYWRIGHT_MODULE)).href:"playwright-core");
  context=await chromium.launchPersistentContext(join(scratch,"browser-profile"),{executablePath:process.env.ACCEPTANCE_CHROME_PATH||"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true,serviceWorkers:"block",args:["--disable-background-networking","--disable-component-update","--no-first-run"]});
  const blocked=[], observed=[];await context.route("**/*",async route=>{const request=route.request(),kind=classifyBrowserRequest(request.url(),request.method(),base),url=new URL(request.url());if(kind!=="allow-real-read"){blocked.push(kind);await route.abort();return;}if(url.pathname.startsWith("/api/")&&!["/api/runtime-status","/api/local-data","/api/local-settings","/api/reminders/status","/api/browser-session"].includes(url.pathname)){blocked.push("unexpected-api");await route.abort();return;}await route.continue();});
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on("response",async response=>{if(response.url()===base+"/api/reminders/status")try{observed.push(await response.json());}catch{}});
  await page.goto(base,{waitUntil:"domcontentloaded"});await page.getByRole("button",{name:"邮件提醒",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"邮件提醒设置"});await dialog.getByText("后台提醒已停用",{exact:true}).waitFor();
  const button=dialog.getByRole("button",{name:"重新开启后台提醒",exact:true});await button.waitFor();assert.equal(await button.isDisabled(),true);
  assert.equal(await dialog.getByText("邮件提醒正在运行",{exact:true}).count(),0);assert.equal(await dialog.getByRole("button",{name:"立即检查一次",exact:true}).count(),0);
  assert.ok(observed.length);assert.ok(observed.every(v=>v.scheduler.status==="disabled"));assert.deepEqual(blocked.filter(v=>v!=="block-loopback-https-favicon"),[]);
  assert.equal((await native("Read")).xml,osBefore.xml);assert.equal(await exists(executions),false);assert.deepEqual(await hashes(root),before);
  await page.screenshot({path:join(dirname(reportPath),"C-windows-native-api-ui-disabled.png"),fullPage:true});
  report.cases.push({id:"C-windows-native-api-ui-disabled",category:"package-native-api-ui",status:"pass",details:{api,observed,buttonDisabled:true,taskUnchanged:true,workerExecutions:0,packageFilesUnchanged:true,externalOfflinePayload:true}});
} catch(e){report.cases.push({id:"C-windows-native-api-ui-disabled",category:"package-native-api-ui",status:"fail",details:e.stack||e.message});}
finally {
  const errors=[];
  try{if(await exists(join(scratch,"owned.json")))await execute("powershell.exe",["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",join(dirname(fileURLToPath(import.meta.url)),"cleanup.ps1"),"-Manifest",join(scratch,"owned.json"),"-Report",join(scratch,"captured-processes.json"),"-CaptureOnly"],{windowsHide:true,timeout:30000});}catch(e){errors.push(e.message);}
  try{if(context)await context.close();report.cleanup.browserClosed=true;}catch(e){errors.push(e.message);}
  try{if(server){if(server.exitCode===null)server.kill();await Promise.race([serverClosed,delay(15000, undefined, { ref: false }).then(()=>{throw new Error("server cleanup timeout");})]);}report.cleanup.serverClosed=true;}catch(e){errors.push(e.message);}
  try{if(taskOwned)assert.equal((await native("Remove")).exists,false);report.cleanup.taskAbsent=true;}catch(e){errors.push(e.message);}
  report.cleanup.status=errors.length?"fail":"pass";report.cleanup.errors=errors;report.cases.push({id:"windows-native-ui.final-cleanup",category:"harness-cleanup",status:report.cleanup.status,details:report.cleanup});
  await mkdir(dirname(reportPath),{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2)+"\n");process.exitCode=report.cases.some(c=>c.status!=="pass")?1:0;
}
