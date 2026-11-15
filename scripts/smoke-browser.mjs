import {authenticator,decryptTotp} from '../lib/totp.js';
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
import {fileURLToPath as sourcePath,pathToFileURL as sourceURL} from 'node:url';
const {startServer}=await import(process.env.COLORLOOP_TEST_BACKEND?sourceURL(process.env.COLORLOOP_TEST_BACKEND+'/scripts/dev.js').href:new URL('./dev.js',import.meta.url).href);
const directory=await mkdtemp(join(tmpdir(),'colorloop-browser-'));
const database=await createIsolatedDatabase();let password='Aa1!'+randomBytes(24).toString('hex');
process.env.MFA_ENCRYPTION_KEY=randomBytes(32).toString('base64');
process.env.EMAIL_DELIVERY_MODE='disabled';process.env.EMAIL_CRON_ENABLED='false';
let server,chrome,websocket;
try{
 await database.transaction(migrate);const store=await initializeSyntheticDemo(database,password);
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-keyout',join(directory,'tls.key'),'-out',join(directory,'tls.crt')],{stdio:'ignore'});
 server=await startServer({database,store,staticRoot:sourcePath(new URL('../',import.meta.url)),port:0,origin:'https://localhost:0',tls:{key:await readFile(join(directory,'tls.key')),cert:await readFile(join(directory,'tls.crt'))}});
 const base=`https://localhost:${server.address().port}`;
 chrome=spawn(process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--ignore-certificate-errors','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${join(directory,'profile')}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
 const address=await new Promise((accept,reject)=>{let stderr='';chrome.stderr.on('data',chunk=>{stderr+=chunk;const match=stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match)accept(match[1]);});chrome.on('error',reject);chrome.on('exit',code=>reject(new Error(`Chrome exited ${code}`)));setTimeout(()=>reject(new Error('Chrome startup timed out')),20000).unref();});
 websocket=new WebSocket(address);await once(websocket,'open');let sequence=0;const pending=new Map();
 websocket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id){const p=pending.get(data.id);pending.delete(data.id);data.error?p?.reject(new Error(data.error.message)):p?.resolve(data.result);}});
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});websocket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
 const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
 const cdp=(method,params)=>send(method,params,sessionId);await cdp('Page.enable');await cdp('Runtime.enable');
 const errors=[];websocket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);});
 const evaluate=async expression=>{const result=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;};
 const wait=expression=>evaluate(`new Promise((resolve,reject)=>{let n=0;const poll=()=>{if(${expression})return resolve(true);if(++n>200)return reject(new Error('UI condition timed out'));setTimeout(poll,30);};poll();})`);
 await cdp('Network.enable');const apiRequests=[];
 websocket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.method==='Network.requestWillBeSent'&&message.params.request.url.includes('/api/'))apiRequests.push(new URL(message.params.request.url).pathname);});
 await cdp('Page.navigate',{url:base});await wait("!document.querySelector('#sign-in').hidden");
 const assertSignedOut=async()=>{
  assert.equal(await evaluate("document.querySelector('#app-shell').hidden"),true);
  assert.equal(await evaluate("document.querySelector('#main').childElementCount"),0);
  assert.equal(await evaluate("document.querySelector('#modal').open"),false);
  assert.equal(await evaluate("document.querySelector('#sign-in').textContent.includes('Please sign in')||document.querySelector('#sign-in').textContent.includes('Try again')"),false);
 };
 await assertSignedOut();assert.deepEqual(apiRequests,['/api/auth/me']);
 await writeFile(join(tmpdir(),'colorloop-auth-sign-in.png'),Buffer.from((await cdp('Page.captureScreenshot',{format:'png'})).data,'base64'));
 const signIn=async(value,email='admin@example.test')=>evaluate(`(()=>{const f=document.querySelector('#sign-in-form');f.elements.email.value=${JSON.stringify(email)};f.elements.password.value=${JSON.stringify(value)};f.requestSubmit();})()`);
 const applicantPassword=password;
 await evaluate("document.querySelector('#auth-sign-up').click()");
 await evaluate(`(()=>{const f=document.querySelector('#sign-in-form');f.elements.name.value='Synthetic Applicant';f.elements.email.value='applicant-browser@example.test';f.elements.password.value=${JSON.stringify(applicantPassword)};document.querySelector('[data-toggle-password]').click();})()`);
 assert.equal(await evaluate("document.querySelector('[data-password]').type"),'text');await evaluate("document.querySelector('[data-toggle-password]').click();document.querySelector('#sign-in-form').requestSubmit()");
 await wait("document.querySelector('#auth-content [role=status]')");
 assert.equal((await database.query("SELECT count(*)::int AS n FROM account_requests WHERE status='pending'")).rows[0].n,1);
 assert.equal((await database.query("SELECT count(*)::int AS n FROM users WHERE email='applicant-browser@example.test'")).rows[0].n,0);
 await signIn('incorrect synthetic password');await wait("document.querySelector('#sign-in-error').textContent.length>0");await assertSignedOut();
 let recoveryCodes=[];
 async function completeBrowserAuthentication(email='admin@example.test',loginPassword=password){
  await wait("['Set up two-factor authentication','Verify your sign-in'].includes(document.querySelector('#auth-content h1')?.textContent)");
  assert.equal(await evaluate("document.querySelector('#app-shell').hidden"),true);
  if(await evaluate("document.querySelector('#auth-content h1').textContent==='Set up two-factor authentication'")){
   await evaluate(`(()=>{const f=document.querySelector('#sign-in-form');f.elements.currentPassword.value=${JSON.stringify(loginPassword)};f.requestSubmit();})()`);
   await wait("document.querySelector('.enrollment-qr')");
   const user=await store.read(s=>s.users.find(u=>u.email===email));
   const code=authenticator(decryptTotp(user.totpPendingCiphertext,user.id),user.email).generate();
   await evaluate("(()=>{const f=document.querySelector('#sign-in-form');f.elements.code.value='invalid';f.noValidate=true;f.requestSubmit();})()");
   await wait("document.querySelector('#sign-in-error').textContent.length>0");assert.equal(await evaluate("document.querySelector('#app-shell').hidden"),true);
   await evaluate(`(()=>{const f=document.querySelector('#sign-in-form');f.elements.code.value=${JSON.stringify(code)};f.requestSubmit();})()`);
   await wait("document.querySelector('#recovery-done')");recoveryCodes=await evaluate("[...document.querySelectorAll('[data-recovery-code]')].map(e=>e.textContent)");assert.equal(recoveryCodes.length,10);
   await evaluate("document.querySelector('#recovery-done').click()");
  }else{
   // Use genuine single-use recovery codes after enrollment; never bypass a factor.
   await evaluate("[...document.querySelectorAll('#auth-content button')].find(b=>b.textContent==='Use a recovery code').click()");
   const recovery=recoveryCodes.shift();assert.ok(recovery);
   await evaluate(`(()=>{const f=document.querySelector('#sign-in-form');f.elements.recoveryCode.value=${JSON.stringify(recovery)};f.requestSubmit();})()`);
  }
  await wait("!document.querySelector('#app-shell').hidden&&document.querySelector('main h1')");
 }
 await signIn(password);await completeBrowserAuthentication();
 await cdp('Page.reload');await wait("!document.querySelector('#app-shell').hidden&&document.querySelector('main h1')");
 assert.equal(await evaluate("document.querySelector('#sign-in').hidden"),true);
 await evaluate("document.querySelector('#session').click()");await wait("!document.querySelector('#account-dropdown').hidden");
 assert.equal(apiRequests.filter(path=>path==='/api/auth/logout').length,0);
 assert.match(await evaluate("document.querySelector('#account-dropdown').textContent"),/admin@example.test/);
 assert.match(await evaluate("document.querySelector('#account-role').textContent"),/Administrator/);
 await writeFile(join(tmpdir(),'colorloop-auth-menu.png'),Buffer.from((await cdp('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 assert.equal(await evaluate("document.querySelector('#account-dropdown').hidden&&document.activeElement.id==='session'"),true);
 await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowUp',code:'ArrowUp',windowsVirtualKeyCode:38});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowUp',code:'ArrowUp',windowsVirtualKeyCode:38});
 assert.equal(await evaluate("document.activeElement.id"),'sign-out');
 await evaluate("document.querySelector('main h1').click()");assert.equal(await evaluate("document.querySelector('#account-dropdown').hidden"),true);
 await evaluate("document.querySelector('#session').click()");
 await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await cdp('Emulation.setTouchEmulationEnabled',{enabled:true});
 const point=await evaluate("(()=>{const r=document.querySelector('#my-profile').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
 await cdp('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await evaluate('new Promise(resolve=>setTimeout(resolve,80))');await cdp('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await wait("document.querySelector('#modal').open");

 assert.equal(await evaluate("document.querySelector('#modal-title').textContent"),'My Profile');
 assert.match(await evaluate("document.querySelector('#modal-fields').textContent"),/admin@example.test/);
 await evaluate("(()=>{const f=document.querySelector('#modal-form');f.elements.name.value='Synthetic Updated Administrator';f.requestSubmit();})()");await wait("!document.querySelector('#modal').open");assert.equal((await database.query("SELECT name FROM users WHERE email='admin@example.test'")).rows[0].name,'Synthetic Updated Administrator');
 await cdp('Emulation.setTouchEmulationEnabled',{enabled:false});await cdp('Emulation.clearDeviceMetricsOverride');
 await evaluate("document.querySelector('#session').click();document.querySelector('#account-security').click()");await wait("document.querySelector('#modal').open");
 assert.equal(await evaluate("document.querySelector('#modal-title').textContent"),'Security');
 await evaluate("document.querySelector('#close-modal').click()");
 await evaluate("document.querySelector('#session').click();document.querySelector('#account-settings').click()");await wait("document.querySelector('#modal-title').textContent==='Account Settings'&&document.querySelector('#modal').open");
 await evaluate("(()=>{const f=document.querySelector('#modal-form');f.elements.startPage.value='donors';f.elements.timeZone.value='UTC';f.requestSubmit();})()");await wait("!document.querySelector('#modal').open");
 assert.equal((await store.read(s=>s.users.find(u=>u.email==='admin@example.test'))).preferences.startPage,'donors');
 await evaluate("document.querySelector('#session').click();document.querySelector('#account-settings').click()");await wait("document.querySelector('#admin-account-actions')");
 await evaluate("[...document.querySelectorAll('#admin-account-actions button')].find(b=>b.textContent==='Review account requests').click()");await wait("document.querySelector('#modal-title').textContent==='Review account requests'");
 await evaluate("document.querySelector('#modal-form').requestSubmit()");await wait("document.querySelector('#modal-fields').textContent.includes('No pending account requests')");
 assert.equal((await database.query("SELECT count(*)::int AS n FROM users WHERE email='applicant-browser@example.test' AND role_id='board-member' AND NOT totp_enabled")).rows[0].n,1);
 await evaluate("document.querySelector('#close-modal').click()");
 // Security actions reauthenticate and use genuine recovery codes; the UI never sends messages.
 await evaluate("document.querySelector('#session').click();document.querySelector('#account-security').click()");await wait("document.querySelector('#security-actions')");
 await evaluate("[...document.querySelectorAll('#security-actions button')].find(b=>b.textContent==='Regenerate recovery codes').click()");
 let recovery=recoveryCodes.shift();await evaluate(`(()=>{const f=document.querySelector('#modal-form');f.elements.currentPassword.value=${JSON.stringify(password)};f.elements.recoveryCode.value=${JSON.stringify(recovery)};f.requestSubmit();})()`);
 await wait("document.querySelector('[data-recovery-code]')");recoveryCodes=await evaluate("[...document.querySelectorAll('[data-recovery-code]')].map(e=>e.textContent)");await evaluate("document.querySelector('#modal-form').requestSubmit()");await wait("!document.querySelector('#modal').open");
 await evaluate("document.querySelector('#session').click();document.querySelector('#account-security').click()");await wait("document.querySelector('#security-actions')");await evaluate("[...document.querySelectorAll('#security-actions button')].find(b=>b.textContent==='Change password').click()");
 const nextPassword='Bb2@'+randomBytes(24).toString('hex');recovery=recoveryCodes.shift();
 await evaluate(`(()=>{const f=document.querySelector('#modal-form');f.elements.currentPassword.value=${JSON.stringify(password)};f.elements.newPassword.value=${JSON.stringify(nextPassword)};f.elements.recoveryCode.value=${JSON.stringify(recovery)};f.requestSubmit();})()`);await wait("!document.querySelector('#modal').open");password=nextPassword;
 await evaluate("document.querySelector('#session').click();document.querySelector('#account-security').click()");await wait("document.querySelector('#security-actions')");await evaluate("[...document.querySelectorAll('#security-actions button')].find(b=>b.textContent==='Disable / reset authenticator').click()");
 recovery=recoveryCodes.shift();await evaluate(`(()=>{const f=document.querySelector('#modal-form');f.elements.currentPassword.value=${JSON.stringify(password)};f.elements.recoveryCode.value=${JSON.stringify(recovery)};f.requestSubmit();})()`);
 await wait("document.querySelector('#auth-content h1')?.textContent==='Set up two-factor authentication'");assert.equal((await store.read(s=>s.users.find(u=>u.email==='admin@example.test'))).totpEnabled,false);await completeBrowserAuthentication();
 const screens=['dashboard','donors','imports','tasks','outreach','reports','settings'];
 for(const screen of screens){
  await evaluate(`location.hash=${JSON.stringify(screen)}`);await wait(`document.title.startsWith(${JSON.stringify(({dashboard:'Today',donors:'Donors',imports:'Imports',tasks:'Follow-ups',outreach:'Outreach',reports:'Reports',settings:'Settings'})[screen])})&&!document.querySelector('main .loading')`);
  await evaluate('new Promise(resolve=>setTimeout(resolve,100))');
  assert.equal(await evaluate("[...document.querySelectorAll('main [role=alert]')].map(e=>e.textContent).join('')"),'',`${screen} rendered an error`);
 }
 // Exercise the actual column-mapping UI with the sanitized sample's shape.
 await evaluate("location.hash='imports'");await wait("document.querySelector('#upload')");
 const importCsv='First name,Last name,Email,Secondary email,Amount,First payment date (America/Phoenix),Phone,Company,Board member,Campaign,Transaction ID\nSynthetic,Browser Import,browser-import@example.test,secondary-browser@example.test,25,"10/19/2026, 8:23 PM",+16025550123,Synthetic Company,board-a@example.test,Synthetic Browser Campaign,REQ-BROWSER\nSynthetic,Browser Import,browser-import@example.test,secondary-browser@example.test,100,2026-11-01,+16025550123,Synthetic Company,board-a@example.test,Synthetic Browser Campaign,REQ-BROWSER-2';
 await evaluate(`(()=>{const form=document.querySelector('#upload');form.elements.namedItem('source').value='zeffy';const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(importCsv)}],'synthetic-sample.csv',{type:'text/csv'}));form.elements.namedItem('file').files=transfer.files;form.requestSubmit();})()`);
 await wait("document.querySelector('#mapping')");
 assert.equal(await evaluate("document.querySelector('#mapping').elements.namedItem('first_name').value"),'First name');
 assert.equal(await evaluate("document.querySelector('#mapping').elements.namedItem('last_name').value"),'Last name');
 assert.equal(await evaluate("document.querySelector('#mapping').elements.namedItem('secondary_email').value"),'Secondary email');
 for(let retry=0;retry<2;retry++){
  await evaluate("(()=>{const form=document.querySelector('#mapping');form.elements.namedItem('review_currency').value='USD';form.elements.namedItem('review_status').value='completed';form.requestSubmit();})()");
  await wait("document.querySelector('#validated form')");
  if(retry)assert.match(await evaluate("document.querySelector('#validated').textContent"),/2 existing transactions/);
  await evaluate("(()=>{const form=document.querySelector('#validated form');form.querySelector('#approve-recognized-owners')?.click();for(const campaign of form.querySelectorAll('select[name^=\"campaign:\"]')){if(campaign.options[0].textContent==='Choose campaign decision'){campaign.value='create';form.elements.namedItem(campaign.name+':approved').checked=true;}}form.requestSubmit();})()");

  await wait("document.querySelector('#final-confirmation .primary')");await evaluate("document.querySelector('#final-confirmation .primary').click()");await wait("document.querySelector('#validated h3')?.textContent==='Import confirmed'");
 }
 const imported=(await database.query("SELECT d.*,g.id AS gift_id FROM donors d JOIN donations g ON d.id=g.donor_id WHERE g.source='zeffy' AND g.external_transaction_id='REQ-BROWSER'")).rows;
 assert.equal((await database.query("SELECT count(*)::int AS n FROM campaigns WHERE name='Synthetic Browser Campaign'")).rows[0].n,1);
 assert.equal(imported.length,1);assert.equal(imported[0].first_name,'Synthetic');assert.equal(imported[0].last_name,'Browser Import');assert.equal(imported[0].phone,'+16025550123');assert.equal(imported[0].company,'Synthetic Company');
 assert.equal((await database.query('SELECT count(*)::int AS n FROM outreach_messages WHERE donation_id=$1',[imported[0].gift_id])).rows[0].n,1);
 // Rehearse the exact five-gift mentor scenario, grouped into only two campaign decisions.
 await evaluate("location.hash='donors'");await wait("document.querySelector('[data-donor]')");
 await evaluate("location.hash='imports'");await wait("document.querySelector('#upload')");
 const demoCsv=['First name,Last name,Email,Amount,Date,Currency,Status,Campaign,Transaction ID',
 'Demo,Alex,demo-alex@example.test,100,2026-06-15,USD,completed,DEMO Summer Coding 2026,POLISH-001',
 'Demo,Alex,demo-alex@example.test,1000,2026-10-20,USD,completed,DEMO Fall Coding 2026,POLISH-002',
 'Demo,Blair,demo-blair@example.test,500,2026-07-12,USD,completed, demo summer coding 2026 ,POLISH-003',
 'Demo,Casey,demo-casey@example.test,250,2026-09-05,USD,completed,DEMO Fall Coding 2026,POLISH-004',
 'Demo,Drew,demo-drew@example.test,750,2026-11-01,USD,completed,DEMO Fall Coding 2026,POLISH-005'].join('\n');
 await evaluate(`(()=>{const f=document.querySelector('#upload');f.elements.source.value='generic';const t=new DataTransfer();t.items.add(new File([${JSON.stringify(demoCsv)}],'synthetic-demo.csv',{type:'text/csv'}));f.elements.file.files=t.files;f.requestSubmit();})()`);await wait("document.querySelector('#mapping')");
 for(let repeat=0;repeat<2;repeat++){
  await evaluate("document.querySelector('#mapping').requestSubmit()");await wait("document.querySelector('[data-campaign-group]')");
  assert.equal(await evaluate("document.querySelectorAll('[data-campaign-group]').length"),2);
  assert.match(await evaluate("document.querySelector('.import-summary').textContent"),/4 donor identities.*5 donation rows.*2 campaign names/);
  if(!repeat){
   await evaluate("(()=>{const f=document.querySelector('#validated form');for(const c of f.querySelectorAll('select[name^=\"campaign:\"]'))c.value='create';f.requestSubmit();})()");
   await wait("document.querySelector('#validated [role=alert]')?.textContent.includes('Explicitly approve')");
   assert.equal((await database.query("SELECT count(*)::int AS n FROM donations WHERE external_transaction_id LIKE 'POLISH-%'")).rows[0].n,0);
   await evaluate("(()=>{const f=document.querySelector('#validated form');for(const c of f.querySelectorAll('select[name^=\"campaign:\"]'))f.elements.namedItem(c.name+':approved').checked=true;})()");
  }else assert.match(await evaluate("document.querySelector('.import-summary').textContent"),/5 existing transactions/);
  await evaluate("document.querySelector('#validated form').requestSubmit()");await wait("document.querySelector('#final-confirmation .primary')");await evaluate("document.querySelector('#final-confirmation .primary').click()");await wait("document.querySelector('#validated h3')?.textContent==='Import confirmed'");
 }
 const demoGifts=(await database.query("SELECT count(*)::int AS n,sum(amount)::text AS total FROM donations WHERE external_transaction_id LIKE 'POLISH-%'")).rows[0];assert.deepEqual(demoGifts,{n:5,total:'2600.00'});
 assert.equal((await database.query("SELECT count(*)::int AS n FROM campaigns WHERE name LIKE 'DEMO %'")).rows[0].n,2);
 // Same display name, distinct email: the selector must make the choice explicit.
 await evaluate("(async()=>{const {api}=await import('/public/js/api.js');await api('/donors',{method:'POST',body:{name:'Demo Alex',email:'other-alex@example.test',allow_duplicate:true,duplicate_reason:'Synthetic distinct donor identity for selector regression'}});})()");
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
 const donorId=(await database.query("SELECT id FROM donors WHERE normalized_email='demo-alex@example.test'")).rows[0].id;
 await evaluate(`document.querySelector('[data-donor="${donorId}"]').click()`);await wait("document.querySelector('#donor-section')");
 assert.equal(await evaluate("location.hash.includes('/'+"+JSON.stringify(donorId)+")"),true);
 assert.equal(await evaluate("document.querySelector('#donor-section').textContent.includes('Complete gift history')"),true);
 assert.match(await evaluate("document.querySelector('#donor-section').textContent"),/\$1,000\.00/);
 assert.equal(await evaluate("[...document.querySelectorAll('#donor-section time')].some(t=>t.textContent.includes('T00:'))"),false);
 await evaluate("[...document.querySelectorAll('.profile-actions button')].find(b=>b.textContent==='Log a call / note').click()");
 await wait("document.querySelector('#modal-title').textContent==='Record a conversation'");
 await evaluate("(()=>{const f=document.querySelector('#modal-form');f.elements.type.value='call';f.elements.note.value='Synthetic deployment rehearsal interaction';f.requestSubmit();})()");await wait("!document.querySelector('#modal').open");
 assert.equal((await database.query('SELECT count(*)::int AS n FROM activities WHERE donor_id=$1 AND content=$2',[donorId,'Synthetic deployment rehearsal interaction'])).rows[0].n,1);
  // Preserve donor search across profile navigation and browser Back.
  await evaluate("location.hash='donors?q=Demo%20Alex'");await wait("document.querySelector('#donor-search')?.value==='Demo Alex'");
  await evaluate(`document.querySelector('[data-donor="${donorId}"]').click()`);await wait("document.querySelector('#donor-section')");
  assert.equal(await evaluate("new URLSearchParams(document.querySelector('.back-link').getAttribute('href').split('?')[1]).get('q')"),'Demo Alex');
  await evaluate('history.back()');await wait("document.querySelector('#donor-search')?.value==='Demo Alex'");
  // Configure and exercise the genuine admin policy UI with delivery explicitly off.
  await evaluate("location.hash='settings?section=outreach'");await wait("[...document.querySelectorAll('main button')].some(b=>b.textContent==='Email automation policy')");
  await evaluate("[...document.querySelectorAll('main button')].find(b=>b.textContent==='Email automation policy').click()");await wait("document.querySelector('#modal').open&&document.querySelector('#modal-title').textContent==='Email automation policy'");
  assert.equal(await evaluate("document.querySelector('#modal-fields').textContent.includes('Scheduled provider sending: off; server opt-in is required')"),true);
  await evaluate("(()=>{const f=document.querySelector('#modal-form');f.elements.donorEnabled.value='false';f.elements.boardEnabled.value='false';f.elements.reason.value='Synthetic browser administrator keeps all email automation disabled';f.elements.confirmed.checked=true;f.requestSubmit();})()");await wait("!document.querySelector('#modal').open");
  const emailPolicy=(await database.query('SELECT email_policy FROM retention_settings')).rows[0].email_policy;assert.equal(emailPolicy.donorEnabled,false);assert.equal(emailPolicy.boardEnabled,false);
  await evaluate("[...document.querySelectorAll('main button')].find(b=>b.textContent==='Send ONE TEST board reminder').click()");await wait("document.querySelector('#modal-title').textContent==='ONE TEST board reminder'");
  assert.equal(await evaluate("document.querySelector('#modal-form').elements.recipient.value"),'');
  await evaluate("(()=>{const f=document.querySelector('#modal-form');f.elements.recipient.value='verified-inbox@synthetic-cic-mail.org';f.elements.confirmed.checked=true;f.requestSubmit();})()");await wait("document.querySelector('#modal-error').textContent.includes('EMAIL_DELIVERY_MODE=test')");
  assert.equal((await database.query("SELECT count(*)::int AS n FROM retention_events WHERE type='email.board-test'")).rows[0].n,0);
  await evaluate("document.querySelector('#close-modal').click()");
  assert.equal((await evaluate("(async()=>{const {api}=await import('/public/js/api.js');return api('/email/run',{method:'POST',body:{confirmed:true}});})()")).enabled,false);
  const emailConfirmation=new Promise(resolve=>{const listener=event=>{const data=JSON.parse(event.data);if(data.method==='Page.javascriptDialogOpening'){websocket.removeEventListener('message',listener);resolve(data.params);}};websocket.addEventListener('message',listener);});
  await evaluate("setTimeout(()=>[...document.querySelectorAll('main button')].find(b=>b.textContent==='Process approved email queue').click(),0)");assert.equal((await emailConfirmation).type,'confirm');await cdp('Page.handleJavaScriptDialog',{accept:true});
  await wait("[...document.querySelectorAll('main [role=status]')].some(p=>p.textContent.includes('Email delivery is disabled'))");
  await evaluate("location.hash='donors'");await wait("document.querySelector('#donor-search')");
  // Initial gift is optional, saves atomically, and uses the existing gift ledger.
  await evaluate("[...document.querySelectorAll('main button')].find(b=>b.textContent==='Add donor').click()");await wait("document.querySelector('#modal').open");
  await evaluate("(()=>{const f=document.querySelector('#modal-form');f.elements.name.value='Synthetic Opportunity Hack Initial';f.elements.name.dispatchEvent(new Event('input',{bubbles:true}));[...f.querySelectorAll('button')].find(b=>b.textContent==='Use Organization').click();f.elements.organization_name.value='Synthetic Opportunity Hack';f.elements.contact_person.value='Synthetic Treasurer';f.elements.initial_amount.value='12.34';f.elements.initial_currency.value='USD';f.elements.initial_status.value='completed';f.elements.initial_source.value='check';f.requestSubmit();f.requestSubmit();})()");
  await wait("!document.querySelector('#modal').open&&document.querySelector('main h1')?.textContent==='Synthetic Opportunity Hack Initial'");
  assert.equal((await database.query("SELECT donor_type FROM donors WHERE display_name='Synthetic Opportunity Hack Initial'")).rows[0].donor_type,'organization');
  const initialFormGift=(await database.query("SELECT g.amount,g.source FROM donations g JOIN donors d ON d.id=g.donor_id WHERE d.display_name='Synthetic Opportunity Hack Initial'")).rows;assert.deepEqual(initialFormGift,[{amount:'12.34',source:'check'}]);
  await evaluate("location.hash='donors'");await wait("document.querySelector('#donor-search')");
  // Create a real synthetic donor without an initial gift.
  await evaluate("[...document.querySelectorAll('main button')].find(b=>b.textContent==='Add donor').click()");await wait("document.querySelector('#modal').open");
  await evaluate("(()=>{const f=document.querySelector('#modal-form');f.elements.name.value='Synthetic UX manual entry';f.elements.email.value='ux-manual@example.test';f.elements.notes.value='Synthetic independently reviewed identity source';f.elements.company.value='Synthetic Employer';f.elements.organization_name.value='Synthetic Partner';f.elements.contact_person.value='Synthetic Contact';f.requestSubmit();})()");
  await wait("!document.querySelector('#modal').open&&document.querySelector('main h1')?.textContent==='Synthetic UX manual entry'");
  const manualId=(await database.query("SELECT id FROM donors WHERE normalized_email='ux-manual@example.test'")).rows[0].id;
  assert.deepEqual((await database.query('SELECT donor_type,company,organization_name,contact_person FROM donors WHERE id=$1',[manualId])).rows[0],{donor_type:'person',company:'Synthetic Employer',organization_name:'Synthetic Partner',contact_person:'Synthetic Contact'});
  await evaluate("[...document.querySelectorAll('.profile-actions button')].find(b=>b.textContent==='Record gift').click()");await wait("document.querySelector('#modal').open&&document.querySelector('#modal-title').textContent==='Record a gift'");
  await evaluate("(()=>{const f=document.querySelector('#modal-form');f.elements.amount.value='25.75';f.elements.currency.value='USD';f.elements.status.value='completed';f.elements.donated_at.value='2026-11-13';f.elements.source.value='cash';f.elements.notes.value='Synthetic cash gift with verified receipt';f.requestSubmit();})()");
  await wait("document.querySelector('#gift-review')&&!document.querySelector('#gift-review').hidden");
  assert.equal((await database.query('SELECT count(*)::int AS n FROM donations WHERE donor_id=$1',[manualId])).rows[0].n,0);
  await evaluate("(()=>{const f=document.querySelector('#modal-form');f.requestSubmit();f.requestSubmit();})()");await wait("!document.querySelector('#modal').open");
  const gifts=(await database.query('SELECT * FROM donations WHERE donor_id=$1',[manualId])).rows;assert.equal(gifts.length,1);assert.equal(gifts[0].amount,'25.75');assert.equal(gifts[0].source,'cash');assert.equal(gifts[0].external_transaction_id,null);
  // Missing payment values remain unknown and outside verified totals.
  await wait("[...document.querySelectorAll('.profile-actions button')].some(b=>b.textContent==='Record gift')");
  await evaluate("[...document.querySelectorAll('.profile-actions button')].find(b=>b.textContent==='Record gift').click()");await wait("document.querySelector('#modal').open&&document.querySelector('#modal-title').textContent==='Record a gift'");
  await evaluate("(()=>{const f=document.querySelector('#modal-form');f.elements.amount.value='1.01';f.elements.donated_at.value='2026-11-12';f.requestSubmit();})()");await wait("document.querySelector('#gift-review')&&!document.querySelector('#gift-review').hidden");
  assert.match(await evaluate("document.querySelector('#gift-review').textContent"),/currency unknown/);
  await evaluate("document.querySelector('#modal-form').requestSubmit()");await wait("!document.querySelector('#modal').open");
  assert.equal((await database.query('SELECT count(*)::int AS n FROM donations WHERE donor_id=$1 AND currency IS NULL AND status IS NULL',[manualId])).rows[0].n,1);
  // A server-bound preview and two explicit confirmations authorize the merge.
  await evaluate("location.hash='donors?view=duplicates'");await wait("document.querySelector('#duplicate-selection')");
  await evaluate(`(()=>{const f=document.querySelector('#duplicate-selection');f.elements.targetId.value=${JSON.stringify(donorId)};f.elements.sourceId.value=${JSON.stringify(manualId)};f.elements.reason.value='Synthetic independent identity evidence verified for this merge';f.requestSubmit();})()`);
  await wait("document.querySelector('#merge-confirm')");assert.equal(await evaluate("document.querySelector('#merge-confirm button').disabled"),false);
  await database.query('UPDATE donors SET company=$2 WHERE id=$1',[manualId,'Synthetic identity evidence updated after preview']);
  await evaluate("(()=>{const f=document.querySelector('#merge-confirm');f.elements.reviewed.checked=true;f.elements.identity_confirmed.checked=true;f.requestSubmit();})()");
  await wait("document.querySelector('#merge-confirm [role=alert]')?.textContent.includes('fresh')");
  assert.equal(await evaluate("document.querySelector('#merge-confirm button').disabled"),true);
  assert.equal((await database.query('SELECT donor_id FROM donations WHERE id=$1',[gifts[0].id])).rows[0].donor_id,manualId);
  await evaluate("document.querySelector('#duplicate-selection').requestSubmit()");await wait("document.querySelector('#merge-confirm')&&!document.querySelector('#merge-confirm button').disabled");
  await evaluate("(()=>{const f=document.querySelector('#merge-confirm');f.elements.reviewed.checked=true;f.elements.identity_confirmed.checked=true;f.requestSubmit();})()");
  await wait("document.querySelector('#duplicate-preview h2')?.textContent==='Merge recorded'");
  assert.ok((await database.query('SELECT archived_at FROM donors WHERE id=$1',[manualId])).rows[0].archived_at);
  assert.equal((await database.query('SELECT donor_id FROM donations WHERE id=$1',[gifts[0].id])).rows[0].donor_id,donorId);
  assert.equal((await database.query("SELECT count(*)::int AS n FROM audit_events WHERE action='donors.merge-preview-consumed'")).rows[0].n,1);
  await evaluate(`location.hash='donors/${donorId}?tab=timeline'`);await wait("document.querySelector('#timeline-filter')");
  await evaluate("(()=>{const filter=document.querySelector('#timeline-filter');filter.value='giving';filter.dispatchEvent(new Event('change'));})()");
  assert.match(await evaluate("document.querySelector('.timeline').textContent"),/25.75/);
  await evaluate(`location.hash='donors/${donorId}?tab=details'`);await wait("[...document.querySelectorAll('main button')].some(b=>b.textContent==='Edit donor details')");
  await evaluate("[...document.querySelectorAll('main button')].find(b=>b.textContent==='Edit donor details').click()");await wait("document.querySelector('#modal').open");
  await evaluate("(()=>{const f=document.querySelector('#modal-form');f.elements.email_consent.value='true';f.requestSubmit();})()");await wait("!document.querySelector('#modal').open");
  await wait("[...document.querySelectorAll('.profile-actions button')].some(b=>b.textContent==='Draft email')");
  await evaluate("[...document.querySelectorAll('.profile-actions button')].find(b=>b.textContent==='Draft email').click()");await wait("document.querySelector('#follow-up-donor')");
  assert.equal(await evaluate("document.querySelector('#follow-up-donor').value"),donorId);
  await evaluate("(()=>{const f=document.querySelector('#modal-form');f.elements.templateId.value='thank-you-email';f.requestSubmit();})()");await wait("document.querySelector('#review-outreach')");
  const draftId=await evaluate("new URLSearchParams(location.hash.split('?')[1]).get('draft')");
  await evaluate("(()=>{const f=document.querySelector('#review-outreach');f.elements.subject.value='Synthetic reviewed thank-you';f.elements.subject.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await evaluate("[...document.querySelectorAll('#draft-actions button')].find(b=>b.textContent==='Save edits and approve').click()");
  await wait("document.querySelector('#draft-review .workflow-steps [aria-current=step]')?.textContent.includes('Approved')");
  assert.equal((await database.query('SELECT status FROM outreach_messages WHERE id=$1',[draftId])).rows[0].status,'approved');
  await evaluate("[...document.querySelectorAll('#draft-actions button')].find(b=>b.textContent==='Prepare manual-send handoff').click()");await wait("document.querySelector('#modal-title').textContent==='Approved message handoff'");
  await evaluate("document.querySelector('#modal-form').requestSubmit()");await wait("!document.querySelector('#modal').open");
  await wait("[...document.querySelectorAll('#draft-actions button')].some(b=>b.textContent==='Record a completed human send')");
  await evaluate("[...document.querySelectorAll('#draft-actions button')].find(b=>b.textContent==='Record a completed human send').click()");await wait("document.querySelector('#modal-title').textContent==='Record human send'");
  await evaluate("(()=>{const f=document.querySelector('#modal-form');f.elements.reference.value='Synthetic human send evidence, no external provider';f.requestSubmit();})()");await wait("!document.querySelector('#modal').open");
  assert.equal((await database.query('SELECT status FROM outreach_messages WHERE id=$1',[draftId])).rows[0].status,'sent');
  assert.equal(apiRequests.includes('/api/outreach/send'),false);
  await evaluate("location.hash='imports'");await wait("document.querySelector('[data-batch]')");
  await evaluate("document.querySelector('[data-batch]').click()");await wait("document.querySelector('#import-history-detail table')");
 await database.query('UPDATE users SET board_member=false'); // Disposable fixture: mirror the real empty board roster.
 await evaluate("location.hash='tasks'");await wait("[...document.querySelectorAll('main button')].some(b=>b.textContent==='Create follow-up')");
 await evaluate("[...document.querySelectorAll('main button')].find(b=>b.textContent==='Create follow-up').click()");await wait("document.querySelector('#modal').open");
 await evaluate("(()=>{const s=document.querySelector('#follow-up-search');s.value='Demo Alex';s.dispatchEvent(new Event('input'));})()");
 assert.equal(await evaluate("document.querySelector('#follow-up-donor').options.length"),3);
 assert.equal(await evaluate("new Set([...document.querySelector('#follow-up-donor').options].map(o=>o.textContent)).size"),3);
 await evaluate("(()=>{const s=document.querySelector('#follow-up-search');s.value='demo-alex@example.test';s.dispatchEvent(new Event('input'));s.focus();})()");
 await cdp('Page.bringToFront');
 for(const [key,code,n] of [['Tab','Tab',9],['ArrowDown','ArrowDown',40],['ArrowDown','ArrowDown',40]]){await cdp('Input.dispatchKeyEvent',{type:'rawKeyDown',key,code,windowsVirtualKeyCode:n,nativeVirtualKeyCode:process.platform==='darwin'?(key==='ArrowDown'?125:48):n});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:n,nativeVirtualKeyCode:process.platform==='darwin'?(key==='ArrowDown'?125:48):n});}
 assert.equal(await evaluate("document.querySelector('#follow-up-donor').value"),donorId,JSON.stringify(await evaluate("({focus:document.activeElement.id,options:[...document.querySelector('#follow-up-donor').options].map(o=>({text:o.textContent,selected:o.selected}))})")));
 await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 assert.equal(await evaluate("(()=>{const r=document.querySelector('#follow-up-donor').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})()"),true);
 await cdp('Emulation.clearDeviceMetricsOverride');
 await evaluate("(()=>{const f=document.querySelector('#modal-form');f.elements.title.value='Synthetic deployment follow-up';f.elements.due_date.value='2026-11-20';f.requestSubmit();})()");await wait("!document.querySelector('#modal').open");
 await wait("document.querySelector('#notice').textContent.includes('New follow-up saved.')");
 await evaluate('new Promise(resolve=>setTimeout(resolve,8300))');assert.equal(await evaluate("document.querySelector('#notice').textContent"),'');
 assert.equal((await database.query('SELECT count(*)::int AS n FROM tasks WHERE donor_id=$1 AND next_action=$2',[donorId,'Synthetic deployment follow-up'])).rows[0].n,1);
 assert.equal((await database.query('SELECT u.email FROM tasks t JOIN users u ON t.assignee_id=u.id WHERE t.donor_id=$1 AND t.next_action=$2',[donorId,'Synthetic deployment follow-up'])).rows[0].email,'admin@example.test');
 const emailTaskId=(await database.query('SELECT id FROM tasks WHERE donor_id=$1 AND next_action=$2',[donorId,'Synthetic deployment follow-up'])).rows[0].id;
 await evaluate(`location.hash='tasks?task=${emailTaskId}'`);await wait("document.querySelector('#modal').open&&document.querySelector('#modal-title').textContent==='Update follow-up'");
 assert.equal(await evaluate("document.querySelector('#modal-form').elements.due_date.value"),'2026-11-20');
 await evaluate("document.querySelector('#close-modal').click()");
 await evaluate("location.hash='settings'");await wait("document.querySelector('main').textContent.includes('No board members have been added.')");
 await evaluate("location.hash='outreach'");await wait("document.querySelector('[data-draft]')");
 assert.equal(await evaluate("[...document.querySelectorAll('[data-draft]')].filter(b=>b.closest('tr').textContent.includes('demo-alex@example.test')).length"),4);
 assert.match(await evaluate("[...document.querySelectorAll('[data-draft]')].find(b=>b.closest('tr').textContent.includes('demo-alex@example.test')).closest('table').textContent"),/\$1,000\.00/);

 await evaluate("location.hash='reports'");await wait("[...document.querySelectorAll('main button')].some(b=>b.textContent==='Funder gift history and outcomes')");
 await evaluate("[...document.querySelectorAll('main button')].find(b=>b.textContent==='Funder gift history and outcomes').click()");
 await wait("document.querySelector('#modal').open");
 await evaluate(`(()=>{const f=document.querySelector('#modal-form');f.elements.donor_id.value=${JSON.stringify(donorId)};f.requestSubmit();})()`);
 await wait("!document.querySelector('#modal').open&&document.querySelector('main').textContent.includes('Verified funded outcomes')");
 const pdf=await cdp('Page.printToPDF',{printBackground:true});assert.ok(Buffer.from(pdf.data,'base64').length>1000);
 await writeFile(join(directory,'synthetic-funder.pdf'),Buffer.from(pdf.data,'base64'));
 // Authenticate normal assignment mutations before testing the reminder link as its board recipient.
 const emailBoardId=(await database.query("SELECT id FROM users WHERE email='applicant-browser@example.test'")).rows[0].id;
 await database.query('UPDATE users SET board_member=true WHERE id=$1',[emailBoardId]);
 await evaluate(`(async()=>{const {api}=await import('/public/js/api.js');await api('/assignments',{method:'POST',body:{donorId:${JSON.stringify(donorId)},assigneeId:${JSON.stringify(emailBoardId)}}});await api('/tasks/${emailTaskId}',{method:'PATCH',body:{assignee_id:${JSON.stringify(emailBoardId)}}});})()`);
 assert.deepEqual(errors,[]);
 await evaluate("document.querySelector('#session').click();document.querySelector('#sign-out').click()");await wait("!document.querySelector('#sign-in').hidden");await assertSignedOut();
 assert.equal((await database.query('SELECT count(*)::int AS n FROM sessions')).rows[0].n,0);
 await evaluate('history.back()');await evaluate('new Promise(resolve=>setTimeout(resolve,150))');await assertSignedOut();
 await cdp('Page.reload');await wait("!document.querySelector('#sign-in').hidden");await assertSignedOut();
 const adminRecoveryCodes=recoveryCodes;
 await signIn(applicantPassword,'applicant-browser@example.test');await completeBrowserAuthentication('applicant-browser@example.test',applicantPassword);
 assert.equal(await evaluate("document.querySelector('#account-role').textContent"),'Board member');
 assert.equal(await evaluate("[...document.querySelectorAll('aside nav a')].map(a=>a.textContent).join(',')"),'My donors,My follow-ups,My drafts');
 await evaluate(`location.hash='tasks?task=${emailTaskId}'`);await wait("document.querySelector('#modal').open&&document.querySelector('#modal-title').textContent==='Update follow-up'");
 assert.equal(await evaluate("document.querySelector('#modal-form').elements.assignee_id.value"),emailBoardId);
 assert.equal(await evaluate("document.querySelector('#modal-fields').textContent.includes('Synthetic deployment follow-up')"),true);
 await evaluate("document.querySelector('#close-modal').click();location.hash='tasks?task=50000000-0000-4000-8000-000000000099'");await wait("document.querySelector('#notice').textContent.includes('This follow-up is unavailable to your account.')");
 assert.equal(await evaluate("document.querySelector('#modal').open"),false);
 await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"),true);assert.equal(await evaluate("[...document.querySelectorAll('#mobile-navigation a')].map(a=>a.textContent).join(',')"),'My donors,My follow-ups,My drafts');await cdp('Emulation.clearDeviceMetricsOverride');
 await evaluate("document.querySelector('#session').click();document.querySelector('#sign-out').click()");await wait("!document.querySelector('#sign-in').hidden");recoveryCodes=adminRecoveryCodes;
 await signIn(password);await completeBrowserAuthentication();
 // Revoke only the synthetic browser session and let a genuine 401 drive the UI.
 await database.query('DELETE FROM sessions');
 await evaluate("location.hash=location.hash==='#donors'?'tasks':'donors'");await wait("!document.querySelector('#sign-in').hidden");await assertSignedOut();
 assert.equal(await evaluate("location.hash"),'#sign-in');

 console.log(JSON.stringify({result:'PASS',realSql:true,integratedMentorWorkflows:true,manualGiftReview:true,serverMergePreview:true,inlineApproval:true,secureBrowserCookie:true,screens:screens.length,donorProfile:true,interactionSaved:true,followUpCreated:true,emailTaskLinks:true,emailCronDisabled:true,searchableDonor:true,groupedCampaigns:true,mentorGifts:5,mentorTotal:2600,notificationExpires:true,emptyBoardRoster:true,assignToSelf:true,draftGiftMetadata:true,funderPdfBytes:Buffer.from(pdf.data,'base64').length,browserExceptions:errors.length,accountRoleSafety:true,dedicatedSignIn:true,refreshPreservesMfa:true,backNavigationSafe:true,realTotp:true,signupApproval:true,mobileProfile:true,authenticatorReset:true,campaignReview:true,profileSaved:true,preferencesSaved:true,passwordChanged:true,recoveryRegenerated:true,profileMenu:true,sessionExpiry:true,logout:true}));
}finally{
 websocket?.close();if(chrome){const exited=once(chrome,'exit');chrome.kill('SIGTERM');await exited;}
 if(server)await new Promise(resolve=>server.close(resolve));await database.close();await rm(directory,{recursive:true,force:true});
}
