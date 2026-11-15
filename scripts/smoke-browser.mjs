import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync,spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { createIsolatedDatabase } from '../lib/isolated-database.js';
import { initializeSyntheticDemo } from '../lib/demo-data.js';
import { migrate } from '../lib/database-setup.js';
import { startServer } from './dev.js';
const directory=await mkdtemp(join(tmpdir(),'colorloop-browser-'));
const database=await createIsolatedDatabase(),password=randomBytes(24).toString('hex');
let server,chrome,websocket;
try{
 await database.transaction(migrate);const store=await initializeSyntheticDemo(database,password);
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-keyout',join(directory,'tls.key'),'-out',join(directory,'tls.crt')],{stdio:'ignore'});
 server=await startServer({database,store,port:0,origin:'https://localhost:0',tls:{key:await readFile(join(directory,'tls.key')),cert:await readFile(join(directory,'tls.crt'))}});
 const base=`https://localhost:${server.address().port}`;
 chrome=spawn(process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--ignore-certificate-errors','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${join(directory,'profile')}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
 const address=await new Promise((accept,reject)=>{let stderr='';chrome.stderr.on('data',chunk=>{stderr+=chunk;const match=stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match)accept(match[1]);});chrome.on('error',reject);chrome.on('exit',code=>reject(new Error(`Chrome exited ${code}`)));setTimeout(()=>reject(new Error('Chrome startup timed out')),20000).unref();});
 websocket=new WebSocket(address);await once(websocket,'open');let sequence=0;const pending=new Map();
 websocket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id){const p=pending.get(data.id);pending.delete(data.id);data.error?p?.reject(new Error(data.error.message)):p?.resolve(data.result);}});
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});websocket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
 const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
 const cdp=(method,params)=>send(method,params,sessionId);await cdp('Page.enable');await cdp('Runtime.enable');
 const errors=[];websocket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);});
 const evaluate=async expression=>{const result=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.text);return result.result.value;};
 const wait=expression=>evaluate(`new Promise((resolve,reject)=>{let n=0;const poll=()=>{if(${expression})return resolve(true);if(++n>200)return reject(new Error('UI condition timed out'));setTimeout(poll,30);};poll();})`);
 await cdp('Page.navigate',{url:base});await wait("document.querySelector('main h1')");
 await evaluate("document.querySelector('#session').click()");await wait("document.querySelector('#modal').open");
 await evaluate(`(()=>{const f=document.querySelector('#modal-form');f.elements.email.value='admin@example.test';f.elements.password.value=${JSON.stringify(password)};f.requestSubmit();})()`);
 await wait("!document.querySelector('#modal').open&&document.querySelector('#session').textContent!=='Sign in'");
 const screens=['dashboard','donors','imports','tasks','outreach','reports','settings'];
 for(const screen of screens){
  await evaluate(`location.hash=${JSON.stringify(screen)}`);await wait(`document.title.startsWith(${JSON.stringify(({dashboard:'Overview',donors:'Donors',imports:'Import center',tasks:'Follow-ups',outreach:'Outreach',reports:'Reports',settings:'Settings'})[screen])})&&!document.querySelector('main [role="status"]')`);
  await evaluate('new Promise(resolve=>setTimeout(resolve,100))');
  assert.equal(await evaluate("[...document.querySelectorAll('main [role=alert]')].map(e=>e.textContent).join('')"),'',`${screen} rendered an error`);
 }
 // Exercise the actual column-mapping UI with the sanitized sample's shape.
 await evaluate("location.hash='imports'");await wait("document.querySelector('#upload')");
 const importCsv='First name,Last name,Email,Secondary email,Amount,First payment date (America/Phoenix),Phone,Company,Board member,Transaction ID\nSynthetic,Browser Import,browser-import@example.test,secondary-browser@example.test,25,"10/19/2026, 8:23 PM",+16025550123,Synthetic Company,board-a@example.test,REQ-BROWSER';
 await evaluate(`(()=>{const form=document.querySelector('#upload');form.elements.namedItem('source').value='zeffy';const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(importCsv)}],'synthetic-sample.csv',{type:'text/csv'}));form.elements.namedItem('file').files=transfer.files;form.requestSubmit();})()`);
 await wait("document.querySelector('#mapping')");
 assert.equal(await evaluate("document.querySelector('#mapping').elements.namedItem('first_name').value"),'First name');
 assert.equal(await evaluate("document.querySelector('#mapping').elements.namedItem('last_name').value"),'Last name');
 assert.equal(await evaluate("document.querySelector('#mapping').elements.namedItem('secondary_email').value"),'Secondary email');
 for(let retry=0;retry<2;retry++){
  await evaluate("(()=>{const form=document.querySelector('#mapping');form.elements.namedItem('review_currency').value='USD';form.elements.namedItem('review_status').value='completed';form.requestSubmit();})()");
  await wait("document.querySelector('#validated form')");
  if(retry)assert.match(await evaluate("document.querySelector('#validated').textContent"),/1 existing transactions/);
  await evaluate("(()=>{const form=document.querySelector('#validated form');const owner=form.querySelector('select[name^=\"owner:\"]');owner.value=[...owner.options].find(o=>o.textContent.includes('board-a@example.test')).value;form.requestSubmit();})()");
  await wait("document.querySelector('#validated h3')?.textContent==='Import confirmed'");
 }
 const imported=(await database.query("SELECT d.*,g.id AS gift_id FROM donors d JOIN donations g ON d.id=g.donor_id WHERE g.source='zeffy' AND g.external_transaction_id='REQ-BROWSER'")).rows;
 assert.equal(imported.length,1);assert.equal(imported[0].first_name,'Synthetic');assert.equal(imported[0].last_name,'Browser Import');assert.equal(imported[0].phone,'+16025550123');assert.equal(imported[0].company,'Synthetic Company');
 assert.equal((await database.query('SELECT count(*)::int AS n FROM outreach_messages WHERE donation_id=$1',[imported[0].gift_id])).rows[0].n,1);
 await evaluate("location.hash='settings'");await wait("[...document.querySelectorAll('main button')].some(b=>b.textContent==='Manage board member')");
 // Exercise role policy through the real forms and backend, not just helper tests.
 await evaluate("[...document.querySelectorAll('main button')].find(b=>b.textContent==='Manage board member').click()");
 await wait("document.querySelector('#modal').open");
 assert.equal(await evaluate("document.querySelector('#modal-form').elements.namedItem('role').value"),'board-member');
 await evaluate("document.querySelector('#close-modal').click();[...document.querySelectorAll('main button')].find(b=>b.textContent==='Manage user account').click()");
 await wait("document.querySelector('#modal').open");
 assert.equal(await evaluate("document.querySelector('#modal-form').elements.namedItem('roleId').value"),'');
 await evaluate(`(()=>{const f=document.querySelector('#modal-form');f.elements.namedItem('name').value='Synthetic explicit administrator';f.elements.namedItem('email').value='explicit-admin@example.test';f.elements.namedItem('password').value=${JSON.stringify(password)};f.requestSubmit();})()`);
 await wait("document.querySelector('#modal-error').textContent.includes('Choose an account role')");
 const confirmGrant=async accept=>{
  const opening=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Administrator confirmation did not open')),5000);const listener=event=>{const data=JSON.parse(event.data);if(data.method==='Page.javascriptDialogOpening'){clearTimeout(timer);websocket.removeEventListener('message',listener);resolve(data.params);}};websocket.addEventListener('message',listener);});
  const submission=evaluate("(()=>{const f=document.querySelector('#modal-form');f.elements.namedItem('roleId').value='administrator';f.requestSubmit();})()");
  const dialog=await opening;assert.match(dialog.message,/Grant administrator access/);
  await cdp('Page.handleJavaScriptDialog',{accept});await submission;
 };
 await confirmGrant(false);await wait("document.querySelector('#modal-error').textContent.includes('not granted')");
 assert.equal((await database.query("SELECT count(*)::int AS n FROM users WHERE email='explicit-admin@example.test'")).rows[0].n,0);
 await confirmGrant(true);await wait("!document.querySelector('#modal').open");
 assert.equal((await database.query("SELECT role_id FROM users WHERE email='explicit-admin@example.test'")).rows[0].role_id,'administrator');
 // Verify the rendered donor edit and printable funder workflow against real SQL.
 await evaluate("location.hash='donors'");await wait("document.querySelector('[data-donor]')");
 const donorId=await evaluate("document.querySelector('[data-donor]').dataset.donor");
 await evaluate("document.querySelector('[data-donor]').click()");await wait("document.querySelector('#modal').open");
 assert.equal(await evaluate("document.querySelector('#modal-fields').textContent.includes('Complete gift history')"),true);
 await evaluate("document.querySelector('#close-modal').click();location.hash='reports'");await wait("[...document.querySelectorAll('main button')].some(b=>b.textContent==='Funder gift history and outcomes')");
 await evaluate("[...document.querySelectorAll('main button')].find(b=>b.textContent==='Funder gift history and outcomes').click()");
 await wait("document.querySelector('#modal').open");
 await evaluate(`(()=>{const f=document.querySelector('#modal-form');f.elements.donorId.value=${JSON.stringify(donorId)};f.requestSubmit();})()`);
 await wait("!document.querySelector('#modal').open&&document.querySelector('main').textContent.includes('Verified funded outcomes')");
 const pdf=await cdp('Page.printToPDF',{printBackground:true});assert.ok(Buffer.from(pdf.data,'base64').length>1000);
 await writeFile(join(directory,'synthetic-funder.pdf'),Buffer.from(pdf.data,'base64'));
 assert.deepEqual(errors,[]);
 await evaluate("document.querySelector('#session').click()");await wait("document.querySelector('#session').textContent==='Sign in'");
 console.log(JSON.stringify({result:'PASS',realSql:true,secureBrowserCookie:true,screens:screens.length,donorProfile:true,funderPdfBytes:Buffer.from(pdf.data,'base64').length,browserExceptions:errors.length,accountRoleSafety:true,logout:true}));
}finally{
 websocket?.close();if(chrome){const exited=once(chrome,'exit');chrome.kill('SIGTERM');await exited;}
 if(server)await new Promise(resolve=>server.close(resolve));await database.close();await rm(directory,{recursive:true,force:true});
}
