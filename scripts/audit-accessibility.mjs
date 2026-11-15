// Real Lighthouse against the authenticated synthetic application; no fixture API or Neon.
import assert from 'node:assert/strict';
import {authenticator,decryptTotp} from '../lib/totp.js';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createIsolatedDatabase} from '../lib/isolated-database.js';
import {migrate} from '../lib/database-setup.js';
import {initializeSyntheticDemo} from '../lib/demo-data.js';
import {startServer} from './dev.js';
if(!process.env.LIGHTHOUSE_MODULE)throw new Error('Set LIGHTHOUSE_MODULE to an approved installed lighthouse/core/index.js.');
const {default:lighthouse}=await import(pathToFileURL(resolve(process.env.LIGHTHOUSE_MODULE)).href);
const output=resolve(process.env.A11Y_OUTPUT||'artifacts/accessibility');await mkdir(output,{recursive:true});
const directory=await mkdtemp(join(tmpdir(),'colorloop-lighthouse-'));const database=await createIsolatedDatabase();
let server,chrome,websocket;
try{
 await database.transaction(migrate);process.env.MFA_ENCRYPTION_KEY=randomBytes(32).toString('base64');const password='Aa1!'+randomBytes(24).toString('hex'),store=await initializeSyntheticDemo(database,password);
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-keyout',join(directory,'tls.key'),'-out',join(directory,'tls.crt')],{stdio:'ignore'});
 server=await startServer({database,store,port:0,origin:'https://localhost:0',tls:{key:await readFile(join(directory,'tls.key')),cert:await readFile(join(directory,'tls.crt'))}});
 const base=`https://localhost:${server.address().port}`;
 chrome=spawn(process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--ignore-certificate-errors','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${join(directory,'profile')}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
 const address=await new Promise((accept,reject)=>{let stderr='';chrome.stderr.on('data',data=>{stderr+=data;const match=stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match)accept(match[1]);});chrome.once('error',reject);chrome.once('exit',()=>reject(new Error('Chrome exited')));setTimeout(()=>reject(new Error('Chrome startup timed out')),20000).unref();});
 websocket=new WebSocket(address);await once(websocket,'open');let sequence=0;const pending=new Map();
 websocket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id){const item=pending.get(data.id);pending.delete(data.id);data.error?item.reject(new Error(data.error.message)):item.resolve(data.result);}});
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});websocket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
 const {targetId}=await send('Target.createTarget',{url:base}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
 await send('Page.enable',{},sessionId);await send('Runtime.enable',{},sessionId);
 const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);if(result.exceptionDetails)throw new Error(result.exceptionDetails.text);return result.result.value;};
 await evaluate("new Promise(resolve=>{const poll=()=>document.querySelector('#sign-in-form')&&!document.querySelector('#sign-in').hidden?resolve():setTimeout(poll,50);poll();})");
 await evaluate(`(async()=>{const {api}=await import('/public/js/api.js');await api('/auth/login',{method:'POST',body:{email:'admin@example.test',password:${JSON.stringify(password)}}});await api('/auth/mfa/enroll',{method:'POST',body:{currentPassword:${JSON.stringify(password)}}});})()`);
 const user=await store.read(s=>s.users.find(u=>u.email==='admin@example.test'));
 const code=authenticator(decryptTotp(user.totpPendingCiphertext,user.id),user.email).generate();
 const signedIn=await evaluate(`(async()=>{const {api}=await import('/public/js/api.js');await api('/auth/mfa/confirm',{method:'POST',body:{code:${JSON.stringify(code)}}});return (await api('/auth/me')).authentication;})()`);assert.equal(signedIn,'authenticated');
 const summary={syntheticOnly:true,measuredAt:new Date().toISOString(),lighthouseVersion:null,results:[]};
 for(const screen of ['dashboard','donors','imports','tasks','outreach','reports','settings']){
  const result=await lighthouse(`${base}/#${screen}`,{port:Number(new URL(address).port),onlyCategories:['accessibility'],output:['json','html'],disableStorageReset:true,logLevel:'error'});
  assert.ok(result);const {lhr,report}=result;summary.lighthouseVersion=lhr.lighthouseVersion;
  const failures=Object.values(lhr.audits).filter(a=>a.score!==null&&a.score<1).map(a=>({id:a.id,title:a.title}));
  summary.results.push({screen,score:Math.round(lhr.categories.accessibility.score*100),failures});
  await writeFile(join(output,`${screen}.json`),report[0]);await writeFile(join(output,`${screen}.html`),report[1]);
  console.log(JSON.stringify(summary.results.at(-1)));
 }
 await writeFile(join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n');
 assert.ok(summary.results.every(r=>r.score>=95),'Every screen must measure at least 95 accessibility.');
}finally{
 websocket?.close();if(chrome){const exited=once(chrome,'exit');chrome.kill('SIGTERM');await exited;}
 if(server)await new Promise(resolve=>server.close(resolve));await database.close();await rm(directory,{recursive:true,force:true});
}
