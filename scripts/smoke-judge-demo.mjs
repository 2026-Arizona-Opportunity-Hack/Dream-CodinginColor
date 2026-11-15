import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes,randomUUID} from 'node:crypto';
import {createIsolatedDatabase} from '../lib/isolated-database.js';
import {provisionJudgeDatabase} from '../lib/judge-provision.js';
import {authenticator,decryptTotp} from '../lib/totp.js';
const release=resolve(process.argv[2]||'node_modules/.cache/colorloop-judge-release');
const {startServer}=await import(pathToFileURL(join(release,'scripts/dev.js')).href);
const {judgeDeploymentConfig,guardJudgeDatabase}=await import(pathToFileURL(join(release,'lib/judge-deployment.js')).href);
const {createSqlStore}=await import(pathToFileURL(join(release,'lib/retention-sql-store.js')).href);
const directory=await mkdtemp(join(tmpdir(),'colorloop-public-judge-'));
const database=await createIsolatedDatabase();let server,chrome,websocket;
const account=name=>({name,email:`${randomUUID()}@judge.invalid`,password:'Aa1!'+randomBytes(24).toString('base64url')});
const accounts={operator:account('Synthetic operator'),judges:[account('Synthetic laptop judge')],boards:[account('Synthetic Board A'),account('Synthetic Board B'),account('Synthetic Board C')]};
delete process.env.DATABASE_URL;delete process.env.RESEND_API_KEY;delete process.env.CRON_SECRET;delete process.env.AUTOMATION_USER_ID;delete process.env.COLORLOOP_STORE;
Object.assign(process.env,{COLORLOOP_ENVIRONMENT:'judge',COLORLOOP_DEMO:'false',JUDGE_DATABASE_URL:'postgresql://synthetic:synthetic-password@ep-synthetic-judge.invalid/neondb',JUDGE_DATABASE_HOST:'ep-synthetic-judge.invalid',JUDGE_ENVIRONMENT_ID:randomUUID(),MFA_ENCRYPTION_KEY:randomBytes(32).toString('base64'),APP_ORIGIN:'https://localhost:0',EMAIL_DELIVERY_MODE:'disabled',EMAIL_CRON_ENABLED:'false',CIC_DONOR_AUTOMATION_APPROVED:'false'});
const nativeFetch=globalThis.fetch;let emailRequests=0;
globalThis.fetch=(url,options)=>{if(new URL(url).hostname==='api.resend.com'){emailRequests++;throw new Error('Real email is prohibited');}return nativeFetch(url,options);};
try{
 const configuration=judgeDeploymentConfig();await provisionJudgeDatabase(database,configuration,accounts);
 const guarded=guardJudgeDatabase(database,configuration),store=createSqlStore(guarded);
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-keyout',join(directory,'tls.key'),'-out',join(directory,'tls.crt')],{stdio:'ignore'});
 server=await startServer({database:guarded,store,staticRoot:release,port:0,origin:'https://localhost:0',tls:{key:await readFile(join(directory,'tls.key')),cert:await readFile(join(directory,'tls.crt'))}});
 const base=`https://localhost:${server.address().port}`;process.env.APP_ORIGIN=base;
 chrome=spawn(process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--ignore-certificate-errors','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${join(directory,'profile')}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
 const address=await new Promise((accept,reject)=>{let stderr='';chrome.stderr.on('data',chunk=>{stderr+=chunk;const m=stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m)accept(m[1]);});chrome.on('error',reject);chrome.on('exit',code=>reject(new Error(`Chrome exited ${code}`)));setTimeout(()=>reject(new Error('Chrome startup timed out')),20000).unref();});
 websocket=new WebSocket(address);await once(websocket,'open');let sequence=0;const pending=new Map(),exceptions=[];
 websocket.addEventListener('message',event=>{const d=JSON.parse(event.data);if(d.id){const p=pending.get(d.id);pending.delete(d.id);d.error?p?.reject(new Error(d.error.message)):p?.resolve(d.result);}if(d.method==='Runtime.exceptionThrown')exceptions.push(d.params.exceptionDetails.text);});
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});websocket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
 const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
 const cdp=(method,params)=>send(method,params,sessionId);await cdp('Page.enable');await cdp('Runtime.enable');
 const evaluate=async expression=>{const result=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;};
 const wait=expression=>evaluate(`new Promise((resolve,reject)=>{let n=0;const poll=()=>{if(${expression})return resolve(true);if(++n>400)return reject(new Error('Judge UI condition timed out: '+${JSON.stringify(expression)}));setTimeout(poll,30);};poll();})`);
 const click=text=>evaluate(`(()=>{const b=[...document.querySelectorAll('main button,dialog button')].find(b=>b.textContent===${JSON.stringify(text)});if(!b)throw new Error('Missing judge action');b.click();})()`);
 const goto=async(hash,condition)=>{await evaluate(`location.hash=${JSON.stringify(hash)}`);await wait(condition);};
 const judge=accounts.judges[0];
 const login=()=>evaluate(`(()=>{const f=document.querySelector('#sign-in-form');f.elements.email.value=${JSON.stringify(judge.email)};f.elements.password.value=${JSON.stringify(judge.password)};f.requestSubmit();})()`);
 await cdp('Page.navigate',{url:base});await wait("!!document.querySelector('#sign-in-form')");
 assert.equal(await evaluate("document.querySelector('#app-shell').hidden"),true);assert.equal(await evaluate("document.querySelector('#auth-sign-up').hidden"),true);assert.match(await evaluate("document.querySelector('[role=note]').textContent"),/synthetic records only/);
 await login();await wait("document.querySelector('#auth-content h1')?.textContent==='Set up two-factor authentication'");assert.equal(await evaluate("fetch('/api/donors').then(r=>r.status)"),403);
 await evaluate(`(()=>{const f=document.querySelector('#sign-in-form');f.elements.currentPassword.value=${JSON.stringify(judge.password)};f.requestSubmit();})()`);await wait("document.querySelector('.enrollment-qr')");
 const user=await store.read(s=>s.users.find(u=>u.email===judge.email)),code=authenticator(decryptTotp(user.totpPendingCiphertext,user.id),user.email).generate();
 await evaluate(`(()=>{const f=document.querySelector('#sign-in-form');f.elements.code.value=${JSON.stringify(code)};f.requestSubmit();})()`);await wait("document.querySelector('#recovery-done')");const codes=await evaluate("[...document.querySelectorAll('[data-recovery-code]')].map(e=>e.textContent)");await evaluate("document.querySelector('#recovery-done').click()");await wait("!document.querySelector('#app-shell').hidden");
 for(const [screen,title]of Object.entries({dashboard:'Today',donors:'Donors',imports:'Imports',tasks:'Follow-ups',outreach:'Outreach',reports:'Reports',settings:'Settings'})){
  await goto(screen,`document.title.startsWith(${JSON.stringify(title)})&&!document.querySelector('main .loading')`);await evaluate('new Promise(r=>setTimeout(r,80))');assert.equal(await evaluate("[...document.querySelectorAll('main [role=alert]')].some(e=>e.textContent.length>0)"),false,screen);
 }
 const donor=(await database.query('SELECT id FROM donors ORDER BY display_name LIMIT 1')).rows[0];
 await goto(`donors/${donor.id}?tab=giving`,"document.querySelector('#donor-section')?.textContent.includes('Complete gift history')");await click('Preview donor impact (internal)');await wait("document.querySelector('[aria-label=\"Internal donor impact preview\"]')");
 const maya=(await database.query("SELECT id FROM donors WHERE display_name='Maya Hernandez'")).rows[0];
 await goto(`donors/${maya.id}?tab=giving`,"document.querySelector('main h1')?.textContent==='Maya Hernandez'");await wait("document.querySelector('#donor-section')");await click('Preview donor impact (internal)');await wait("document.querySelector('[aria-label=\"Internal donor impact preview\"]')?.textContent.includes('SYNTHETIC DEMO')");
 const csv='Name,Email,Amount,Date,Currency,Status,Campaign,Transaction ID\nSynthetic Judge Import,new-import@colorloop.invalid,10,2026-11-01,USD,completed,Synthetic Digital Skills,JUDGE-BROWSER-1';
 for(let retry=0;retry<2;retry++){
  await goto('imports',"document.querySelector('#upload')");if(retry){await click('Start another import');await wait("document.querySelector('#upload')");}
  await evaluate(`(()=>{const f=document.querySelector('#upload'),t=new DataTransfer();t.items.add(new File([${JSON.stringify(csv)}],'synthetic-judge.csv',{type:'text/csv'}));f.elements.file.files=t.files;f.elements.source.value='judge-browser';f.requestSubmit();})()`);await wait("document.querySelector('#mapping')");await evaluate("document.querySelector('#mapping').requestSubmit()");await wait("document.querySelector('#validated form')");await evaluate("document.querySelector('#validated form').requestSubmit()");await wait("document.querySelector('#final-confirmation .primary')");await evaluate("document.querySelector('#final-confirmation .primary').click()");await wait("document.querySelector('[data-import-confirmed]')");assert.match(await evaluate("document.querySelector('#validated').textContent"),retry?/0 donations added · 1 existing gifts reused/:/1 donations added/);
 }
 assert.equal((await database.query('SELECT count(*)::int AS n FROM donations')).rows[0].n,11);
 assert.equal(await evaluate("fetch('/api/users').then(r=>r.status)"),403);assert.equal(await evaluate("fetch('/api/jobs/prepare').then(r=>r.status)"),403);
 await cdp('Page.reload');await wait("!document.querySelector('#app-shell').hidden");
 await evaluate("document.querySelector('#session').click();document.querySelector('#sign-out').click()");await wait("!document.querySelector('#sign-in').hidden");assert.equal(await evaluate("fetch('/api/donors').then(r=>r.status)"),401);
 await login();await wait("document.querySelector('#auth-content h1')?.textContent==='Verify your sign-in'");await evaluate("[...document.querySelectorAll('#auth-content button')].find(b=>b.textContent==='Use a recovery code').click()");await evaluate(`(()=>{const f=document.querySelector('#sign-in-form');f.elements.recoveryCode.value=${JSON.stringify(codes[0])};f.requestSubmit();})()`);await wait("!document.querySelector('#app-shell').hidden");
 await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"),true);
 assert.deepEqual(exceptions,[]);assert.equal(emailRequests,0);
 console.log(JSON.stringify({result:'PASS',judgeRelease:true,database:'disposable PostgreSQL',seededDonors:8,seededGifts:10,sevenPages:true,mandatoryTotp:true,refresh:true,logoutAndRelogin:true,recoveryCode:true,impactEvidence:true,csvImportAndReimport:true,accountAdminDenied:true,cronDenied:true,realEmails:emailRequests,browserExceptions:exceptions.length}));
}finally{globalThis.fetch=nativeFetch;websocket?.close();if(chrome){const exit=once(chrome,'exit');chrome.kill('SIGTERM');await exit;}if(server)await new Promise(resolve=>server.close(resolve));await database.close();await rm(directory,{recursive:true,force:true});}
