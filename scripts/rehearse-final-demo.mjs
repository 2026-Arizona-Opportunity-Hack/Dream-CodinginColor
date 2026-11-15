// Local-only rehearsal. The original CSV is read, never changed or bundled.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash,randomBytes} from 'node:crypto';
import {parse} from 'csv-parse/sync';
import {createIsolatedDatabase} from '../lib/isolated-database.js';
import {migrate} from '../lib/database-setup.js';
import {createSqlStore} from '../lib/retention-sql-store.js';
import {bootstrapAdministrator,saveUser} from '../lib/auth.js';
import {authenticator,decryptTotp} from '../lib/totp.js';
import {startServer} from './dev.js';

const csvPath=process.argv[2];
assert.ok(csvPath,'Usage: node scripts/rehearse-final-demo.mjs /absolute/path/colorloop_demo_ZEFFY_with_OHacks.csv');
const csv=await readFile(csvPath),digest=b=>createHash('sha256').update(b).digest('hex');
const source=parse(csv,{columns:true,skip_empty_lines:true,bom:true});
assert.equal(source.length,11);assert.equal(source.reduce((s,r)=>s+Math.round(Number(r.Amount)*100),0),213000);
assert.equal(source.filter(r=>!r['Board Contact']).length,3);
assert.ok(source.every(r=>r['Donor Email'].endsWith('@example.com')&&/^202-555-01\d\d$/.test(r['Donor Phone'])&&/^2026-11-\d\d$/.test(r['Payment Date'])&&r.Currency==='USD'&&r['Payment Status']==='completed'));
assert.equal(new Set(source.map(r=>r['Transaction ID'])).size,11);
const directory=await mkdtemp(join(tmpdir(),'colorloop-final-rehearsal-'));
const database=await createIsolatedDatabase(),password='Aa1!'+randomBytes(24).toString('hex');
// In-process synthetic settings only. Never use credentials loaded from .env.
Object.assign(process.env,{MFA_ENCRYPTION_KEY:randomBytes(32).toString('base64'),EMAIL_DELIVERY_MODE:'disabled',EMAIL_CRON_ENABLED:'false',CIC_DONOR_AUTOMATION_APPROVED:'false'});
const nativeFetch=globalThis.fetch;let providerRequests=0;
globalThis.fetch=(url,options)=>{if(new URL(url).hostname==='api.resend.com'){providerRequests++;throw new Error('External email is prohibited in this rehearsal.');}return nativeFetch(url,options);};
let server,chrome,websocket;
const evidence={csv:{filename:'colorloop_demo_ZEFFY_with_OHacks.csv',sha256:digest(csv),rows:11,total:2130,blankBoardContacts:3},pages:{},mentor:{},radar:{},realEmails:0};
try{
 await database.transaction(migrate);const store=createSqlStore(database);
 const admin={...await bootstrapAdministrator(store,{name:'Synthetic Dream rehearsal',email:'dream-rehearsal@example.test',password}),administrator:true};
 const boards=[];
 for(const [index,name]of ['Shorya Moses','Abbhijit Venkatachalam','Oumar Yassir'].entries())boards.push(await saveUser(store,admin,{name,email:`board-${index}@example.test`,password,roleId:'board-member',boardMember:true},new Date()));
 const accounts=async()=>({users:(await database.query('SELECT * FROM users ORDER BY id')).rows,roles:(await database.query('SELECT * FROM roles ORDER BY id')).rows,settings:(await database.query('SELECT * FROM retention_settings')).rows});
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-keyout',join(directory,'tls.key'),'-out',join(directory,'tls.crt')],{stdio:'ignore'});
 server=await startServer({database,store,staticRoot:resolve('.'),port:0,origin:'https://localhost:0',tls:{key:await readFile(join(directory,'tls.key')),cert:await readFile(join(directory,'tls.crt'))}});
 const base=`https://localhost:${server.address().port}`;
 chrome=spawn(process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--ignore-certificate-errors','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${join(directory,'profile')}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
 const address=await new Promise((accept,reject)=>{let stderr='';chrome.stderr.on('data',chunk=>{stderr+=chunk;const m=stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m)accept(m[1]);});chrome.on('error',reject);chrome.on('exit',code=>reject(new Error(`Chrome exited ${code}`)));setTimeout(()=>reject(new Error('Chrome startup timed out')),20000).unref();});
 websocket=new WebSocket(address);await once(websocket,'open');let sequence=0;const pending=new Map(),exceptions=[];
 websocket.addEventListener('message',event=>{const d=JSON.parse(event.data);if(d.id){const p=pending.get(d.id);pending.delete(d.id);d.error?p?.reject(new Error(d.error.message)):p?.resolve(d.result);}if(d.method==='Runtime.exceptionThrown')exceptions.push(d.params.exceptionDetails.text);});
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});websocket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
 const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
 const cdp=(method,params)=>send(method,params,sessionId);await cdp('Page.enable');await cdp('Runtime.enable');
 const evaluate=async expression=>{const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 const wait=expression=>evaluate(`new Promise((resolve,reject)=>{let n=0;const poll=()=>{if(${expression})return resolve(true);if(++n>400)return reject(new Error('UI condition timed out: '+${JSON.stringify(expression)}+'; '+document.querySelector('main')?.textContent.slice(-1600)));setTimeout(poll,30);};poll();})`);
 const click=text=>evaluate(`(()=>{const b=[...document.querySelectorAll('main button,dialog button')].find(b=>b.textContent===${JSON.stringify(text)});if(!b)throw new Error('Button missing: '+${JSON.stringify(text)});b.click();})()`);
 const goto=async(hash,condition)=>{await evaluate(`location.hash=${JSON.stringify(hash)}`);await wait(condition);};
 const api=(path,method='GET',body)=>evaluate(`(async()=>{const {api}=await import('/public/js/api.js');try{return {status:200,body:await api(${JSON.stringify(path)},${JSON.stringify({method,...(body?{body}:{})})})};}catch(e){return {status:e.status,code:e.code,message:e.message};}})()`);
 const screenshot=async name=>writeFile(join(tmpdir(),`colorloop-rehearsal-${name}.png`),Buffer.from((await cdp('Page.captureScreenshot',{format:'png'})).data,'base64'));
 async function login(user){
  await wait("!document.querySelector('#sign-in').hidden");
  await evaluate(`(()=>{const f=document.querySelector('#sign-in-form');f.elements.email.value=${JSON.stringify(user.email)};f.elements.password.value=${JSON.stringify(password)};f.requestSubmit();})()`);
  await wait("document.querySelector('#auth-content h1')?.textContent==='Set up two-factor authentication'");
  await evaluate(`(()=>{const f=document.querySelector('#sign-in-form');f.elements.currentPassword.value=${JSON.stringify(password)};f.requestSubmit();})()`);await wait("document.querySelector('.enrollment-qr')");
  const current=await store.read(s=>s.users.find(u=>u.id===user.id));
  const code=authenticator(decryptTotp(current.totpPendingCiphertext,current.id),current.email).generate();
  await evaluate(`(()=>{const f=document.querySelector('#sign-in-form');f.elements.code.value=${JSON.stringify(code)};f.requestSubmit();})()`);await wait("document.querySelector('#recovery-done')");
  await evaluate("document.querySelector('#recovery-done').click()");await wait("!document.querySelector('#app-shell').hidden&&document.querySelector('main h1')");
 }
 await cdp('Page.navigate',{url:base});await login(admin);
 assert.equal((await database.query('SELECT count(*)::int AS n FROM donors')).rows[0].n,0);
 await goto('dashboard',"document.title.startsWith('Today')&&!document.querySelector('main .loading')");await wait("document.querySelector('.giving-strip')?.textContent.includes('$0.00')");await screenshot('empty');
 const beforeImport=digest(JSON.stringify(await accounts()));
 async function importFile(retry=false){
  await goto('imports',"document.querySelector('#upload')");
  if(retry){await click('Start another import');await wait("document.querySelector('#upload')");}
  // Chrome reads the actual original file. No reconstructed CSV or SQL imports.
  const doc=await cdp('DOM.getDocument'),node=await cdp('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'#upload input[type=file]'});
  await cdp('DOM.setFileInputFiles',{nodeId:node.nodeId,files:[resolve(csvPath)]});
  await evaluate("(()=>{const f=document.querySelector('#upload');f.elements.source.value='zeffy';f.requestSubmit();})()");await wait("document.querySelector('#mapping')");
  evidence.mapping=await evaluate("Object.fromEntries([...document.querySelector('#mapping').elements].filter(e=>e.name&&!e.name.startsWith('review')).map(e=>[e.name,e.value]))");
  await evaluate("(()=>{const f=document.querySelector('#mapping'),mapping={first_name:'Donor First Name',last_name:'Donor Last Name',email:'Donor Email',phone:'Donor Phone',organization_name:'Organization',amount:'Amount',board_contact:'Board Contact',campaign:'Campaign Name',donation_date:'Payment Date',currency:'Currency',status:'Payment Status',external_transaction_id:'Transaction ID'};for(const [key,column]of Object.entries(mapping))f.elements.namedItem(key).value=column;f.elements.company.value='';f.dispatchEvent(new Event('input',{bubbles:true}));f.requestSubmit();})()");await wait("document.querySelector('#validated form')||document.querySelector('#validated [role=alert]')");
  const summary=await evaluate("document.querySelector('#validated').textContent");
  if(retry&&summary.includes('Source transaction belongs to a different donor identity.'))return {blocker:'Reviewed Organization cannot currently be re-reviewed on exact-file reimport',summary};
  assert.match(summary,/11 valid rows/);assert.match(summary,/0 errors/);
  if(retry)assert.match(summary,/11 existing transactions/);
  assert.equal(await evaluate("document.querySelectorAll('[data-campaign-group]').length"),2);
  await evaluate("(()=>{const f=document.querySelector('#validated form');f.querySelector('#approve-recognized-owners')?.click();for(const s of f.querySelectorAll('select')){if(s.name.startsWith('campaign:')&&!s.value){s.value='create';f.elements.namedItem(s.name+':approved').checked=true;}if(s.name.startsWith('type:'))s.value=s.closest('label').textContent.includes('Opportunity Hack')?'organization':'person';}f.dispatchEvent(new Event('input',{bubbles:true}));f.requestSubmit();})()");
  await wait("document.querySelector('#final-confirmation .primary')");await evaluate("document.querySelector('#final-confirmation .primary').click()");await wait("document.querySelector('[data-import-confirmed]')");
  const result=await evaluate("document.querySelector('#validated').textContent");
  assert.match(result,retry?/0 donations added · 11 existing gifts reused/:/11 donations added · 0 existing gifts reused/);
  await screenshot(retry?'reimport':'import');return {summary,result};
 }
 evidence.mentor.import=await importFile();
 assert.equal(digest(JSON.stringify(await accounts())),beforeImport,'Import changed account, role, settings or MFA data');
 const giftRows=(await database.query('SELECT d.*,g.amount,g.donation_date,g.external_transaction_id,g.currency,g.status,c.name AS campaign FROM donors d JOIN donations g ON g.donor_id=d.id JOIN campaigns c ON c.id=g.campaign_id ORDER BY g.external_transaction_id')).rows;
 assert.equal(giftRows.length,11);
 for(const [index,row]of giftRows.entries()){
  const input=source[index];assert.equal(row.normalized_email,input['Donor Email']);assert.equal(row.first_name,input['Donor First Name']);assert.equal(row.last_name,input['Donor Last Name']);assert.equal(row.phone,input['Donor Phone']);assert.equal(row.organization_name,input.Organization||null);assert.equal(Number(row.amount),Number(input.Amount));assert.equal(row.external_transaction_id,input['Transaction ID']);assert.equal(new Date(row.donation_date).toISOString().slice(0,10),input['Payment Date']);assert.equal(row.campaign,input['Campaign Name']);assert.equal(row.currency,'USD');assert.equal(row.status,'completed');
 }
 const ownership=(await database.query('SELECT d.normalized_email,u.name FROM donors d JOIN board_assignments a ON a.donor_id=d.id AND a.active JOIN users u ON u.id=a.assignee_id')).rows;
 assert.equal(ownership.length,11);for(const input of source.filter(r=>r['Board Contact']))assert.equal(ownership.find(o=>o.normalized_email===input['Donor Email']).name,input['Board Contact']);
 evidence.ownership={reviewedContacts:8,balancedBlankContacts:3,workloads:Object.fromEntries(boards.map(b=>[b.name,ownership.filter(o=>o.name===b.name).length]))};
 const maya=giftRows.find(d=>d.normalized_email==='maya.hernandez@example.com');
 await goto('donors',"document.querySelectorAll('[data-donor]').length===11");evidence.pages.Donors='11 donors; 11 verified gifts; reviewed owners; contact and organization fields verified';
 await evaluate(`document.querySelector('[data-donor="${maya.id}"]').click()`);await wait("document.querySelector('#donor-section')?.textContent.includes('Complete gift history')");assert.match(await evaluate("document.querySelector('#donor-section').textContent"),/60.00/);
 // Create a no-gift synthetic alias through the real form, then merge it.
 await goto('donors',"document.querySelector('#donor-search')");await click('Add donor');await wait("document.querySelector('#modal').open");
 await evaluate("(()=>{const f=document.querySelector('#modal-form');f.elements.name.value='Maya Hernandez alternate record';f.elements.email.value='maya-alternate@example.com';f.elements.notes.value='Controlled duplicate for isolated identity-review rehearsal only';f.requestSubmit();})()");await wait("!document.querySelector('#modal').open&&document.querySelector('main h1')?.textContent==='Maya Hernandez alternate record'");
 const duplicate=(await database.query("SELECT id FROM donors WHERE normalized_email='maya-alternate@example.com'")).rows[0];
 const unaffectedBefore=digest(JSON.stringify((await database.query('SELECT id,display_name,normalized_email FROM donors WHERE id<>$1 AND id<>$2 ORDER BY id',[maya.id,duplicate.id])).rows));
 await goto('donors?view=duplicates',"document.querySelector('#duplicate-selection')");
 await evaluate(`(()=>{const f=document.querySelector('#duplicate-selection');f.elements.targetId.value=${JSON.stringify(maya.id)};f.elements.sourceId.value=${JSON.stringify(duplicate.id)};f.elements.reason.value='Synthetic rehearsal: reviewed both records against the same identity';f.requestSubmit();})()`);await wait("document.querySelector('#merge-confirm')");
 await evaluate("(()=>{const f=document.querySelector('#merge-confirm');f.elements.reviewed.checked=true;f.elements.identity_confirmed.checked=true;f.requestSubmit();})()");await wait("document.querySelector('#duplicate-preview h2')?.textContent==='Merge recorded'");
 assert.ok((await database.query('SELECT archived_at FROM donors WHERE id=$1',[duplicate.id])).rows[0].archived_at);
 assert.equal(unaffectedBefore,digest(JSON.stringify((await database.query('SELECT id,display_name,normalized_email FROM donors WHERE id<>$1 AND id<>$2 ORDER BY id',[maya.id,duplicate.id])).rows)));
 assert.equal((await database.query('SELECT count(*)::int AS n FROM donations')).rows[0].n,11);await screenshot('merge');evidence.mentor.merge='Server preview and both identity confirmations; alias archived; 11 gifts and unrelated donors preserved';
 evidence.mentor.reimport=await importFile(true);
 assert.deepEqual((await database.query('SELECT count(*)::int AS gifts,sum(amount)::text AS total FROM donations')).rows[0],{gifts:11,total:'2130.00'});
 await goto('reports',"document.title.startsWith('Reports')&&document.querySelector('main').textContent.includes('$2,130.00')");evidence.pages.Reports='USD 2,130; 11 completed gifts; no prior-year retention inferred';await screenshot('reports');
 await goto(`donors/${maya.id}?tab=giving`,"document.querySelector('#donor-section')?.textContent.includes('Complete gift history')");await click('Export funder packet');await wait("document.querySelector('#packet-preview')?.textContent.includes('Verified funded outcomes')");assert.match(await evaluate("document.querySelector('#packet-preview').textContent"),/60.00/);
 const pdf=await cdp('Page.printToPDF',{printBackground:true});assert.ok(Buffer.from(pdf.data,'base64').length>1000);evidence.funderPdfBytes=Buffer.from(pdf.data,'base64').length;
 await goto(`donors/${maya.id}?tab=timeline`,"document.querySelector('#timeline-filter')");
 await click('Log a call / note');await wait("document.querySelector('#modal').open");await evaluate("(()=>{const f=document.querySelector('#modal-form');f.elements.note.value='Synthetic mentor rehearsal conversation';f.requestSubmit();})()");await wait("!document.querySelector('#modal').open");
 await wait("document.querySelector('.timeline')?.textContent.includes('Synthetic mentor rehearsal conversation')");
 await click('Schedule follow-up');await wait("document.querySelector('#modal-title').textContent==='New follow-up'&&document.querySelector('#modal').open");
 await evaluate(`(()=>{const f=document.querySelector('#modal-form');f.elements.title.value='Invite Maya to the next CIC update';f.elements.due_date.value='2026-11-20';f.elements.assignee_id.value=${JSON.stringify(boards[0].id)};f.requestSubmit();})()`);await wait("!document.querySelector('#modal').open");
 await wait("document.querySelector('.timeline')?.textContent.includes('Invite Maya')");await goto('tasks',"document.querySelector('main').textContent.includes('Invite Maya')");evidence.pages['Follow-ups']='Maya follow-up assigned to Shorya; November 20 deadline; visible in task list and timeline';
 await goto('dashboard',"document.title.startsWith('Today')&&document.querySelector('.giving-strip')?.textContent.includes('$2,130.00')");evidence.pages.Today='Empty USD 0 before import; USD 2,130/11 donors after; next-seven-day task appears';
 // Preserve real imports. Add a separate fictional prior-cycle donor via UI.
 await goto('donors',"document.querySelector('#donor-search')");await click('Add donor');await wait("document.querySelector('#modal').open");
 await evaluate(`(()=>{const f=document.querySelector('#modal-form');f.elements.name.value='Synthetic Avery Cycle';f.elements.email.value='avery-cycle@example.com';f.elements.email_consent.value='true';f.elements.owner_id.value=${JSON.stringify(boards[0].id)};f.elements.initial_amount.value='120.00';f.elements.initial_date.value='2025-06-10';f.elements.initial_currency.value='USD';f.elements.initial_status.value='completed';f.requestSubmit();})()`);await wait("!document.querySelector('#modal').open&&document.querySelector('main h1')?.textContent==='Synthetic Avery Cycle'");
 const avery=(await database.query("SELECT id FROM donors WHERE normalized_email='avery-cycle@example.com'")).rows[0];
 await goto('outreach?view=attention&mode=cycle',"document.querySelector('[data-nudge]')");
 const card=await evaluate("document.querySelector('[data-nudge]').closest('article').textContent");assert.match(card,/Synthetic Avery Cycle/);assert.match(card,/Jun 10, 2025/);await screenshot('radar');
 assert.equal(await evaluate("document.querySelectorAll('[data-nudge]').length"),1);
 await evaluate("document.querySelector('[data-nudge]').click()");await wait("document.querySelector('#review-outreach')");
 const radarDraftId=await evaluate("new URLSearchParams(location.hash.split('?')[1]).get('draft')");const radarBody=await evaluate("document.querySelector('#review-outreach').elements.body.value");assert.match(radarBody,/Synthetic Avery Cycle/);assert.match(radarBody,/2025-06-10/);
 assert.equal((await api(`/outreach/drafts/${radarDraftId}/send`,'POST')).status,409);
 await evaluate("(()=>{const f=document.querySelector('#review-outreach');f.elements.body.value+=' Synthetic review: invite Avery to the next CIC update.';f.elements.body.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#draft-actions details').open=true;})()");await click('Save edits and approve');
 await wait("document.querySelector('#draft-actions')?.textContent.includes('Prepare manual-send handoff')");
 const radarState=await store.read(s=>({draft:s.drafts.find(d=>d.id===radarDraftId),task:s.tasks.find(t=>t.donorId===avery.id),event:s.events.find(e=>e.type==='retention.nudge'&&e.donorId===avery.id)}));
 assert.equal(radarState.draft.status,'approved');assert.equal(radarState.draft.approvedBy,admin.id);assert.equal(radarState.task.assigneeId,boards[0].id);assert.ok(radarState.event);
 await goto(`donors/${avery.id}?tab=timeline`,"document.querySelector('.timeline')?.textContent.includes('Reconnect with Coding in Color')&&document.querySelector('.timeline')?.textContent.includes('reconnection draft')");
 evidence.radar={donor:'Synthetic Avery Cycle',gift:'USD 120.00 on 2025-06-10',owner:boards[0].name,card,approved:true,taskCreated:true,activityVisible:true,snooze:'not implemented',amountOnCard:false,amountOnProfile:true};
 // Mentor thank-you approval with no provider call or handoff attestation.
 await goto(`donors/${maya.id}?tab=details`,"document.querySelector('#edit-donor-actions')");await click('Edit donor details');await wait("document.querySelector('#modal').open");await evaluate("(()=>{const f=document.querySelector('#modal-form');f.elements.email_consent.value='true';f.requestSubmit();})()");await wait("!document.querySelector('#modal').open");await wait("document.querySelector('.profile-actions')");await click('Draft email');await wait("document.querySelector('#follow-up-donor')");
 await evaluate("(()=>{const f=document.querySelector('#modal-form');f.elements.templateId.value='thank-you-email';f.requestSubmit();})()");await wait("document.querySelector('#review-outreach')");
 const thankId=await evaluate("new URLSearchParams(location.hash.split('?')[1]).get('draft')");assert.equal(await evaluate("document.querySelector('#review-outreach').elements['reviewed-recipient'].value"),maya.normalized_email);assert.match(await evaluate("document.querySelector('#review-outreach').elements.body.value"),/USD 60\.00/);assert.equal((await api(`/outreach/drafts/${thankId}/send`,'POST')).status,409);
 await evaluate("document.querySelector('#draft-actions details').open=true");await click('Approve current draft');await wait("document.querySelector('#draft-actions')?.textContent.includes('Prepare manual-send handoff')");
 assert.equal((await store.read(s=>s.drafts.find(d=>d.id===thankId))).status,'approved');assert.equal((await database.query('SELECT count(*)::int AS n FROM outreach_approval_history WHERE message_id=$1 AND approved_by=$2',[thankId,admin.id])).rows[0].n,1);assert.equal(providerRequests,0);evidence.mentor.approval='Reviewed Maya recipient and exact thank-you; explicit approval-only fallback; alternate unapproved send rejected 409; zero provider requests';evidence.pages.Outreach='Imported recipients; exact-message approval without delivery; re-engagement draft personalized and edited';
 await evaluate("[...document.querySelectorAll('main details')].find(d=>d.querySelector('summary')?.textContent==='Prepare scheduled updates').open=true");await click('Create quarterly donor updates and tasks');await wait("document.querySelector('#notice').textContent.includes('Quarterly donor updates prepared')");
 const quarterly=await store.read(s=>({drafts:s.drafts.filter(d=>d.eventKey?.startsWith('donor-quarterly:')).length,tasks:s.tasks.filter(t=>t.eventKey?.startsWith('donor-quarterly:')).length}));assert.deepEqual(quarterly,{drafts:12,tasks:12});assert.equal(providerRequests,0);evidence.quarterly=quarterly;
 await goto('imports',"document.querySelectorAll('[data-batch]').length>=2");await evaluate("document.querySelector('[data-batch]').click()");await wait("document.querySelector('#import-history-detail table')");evidence.pages.Imports='Original file uploaded through Chrome; 11 initial gifts; 11 existing transactions and zero new gifts on reimport; persisted history';
 await goto('settings',"document.title.startsWith('Settings')&&!document.querySelector('main .loading')");evidence.pages.Settings='Import left users, password hashes, roles and MFA byte-identical in isolated DB';
 assert.equal(providerRequests,0);assert.equal((await api('/jobs/prepare')).status,401);
 await evaluate("document.querySelector('#session').click();document.querySelector('#sign-out').click()");await wait("!document.querySelector('#sign-in').hidden");
 assert.equal(await evaluate("fetch('/api/donors').then(r=>r.status)"),401);
 for(const [index,board]of [boards[0],boards[1]].entries()){
  await login(board);await goto('donors',"document.querySelector('#donor-search')");
  if(index===0){assert.equal(await evaluate(`!!document.querySelector('[data-donor="${avery.id}"]')`),true);assert.equal((await api(`/donors/${avery.id}`)).status,200);await goto(`donors/${avery.id}`,"document.querySelector('main h1')?.textContent==='Synthetic Avery Cycle'");}
  else{assert.equal(await evaluate(`!!document.querySelector('[data-donor="${avery.id}"]')`),false);assert.equal((await api(`/donors/${avery.id}`)).status,403);await goto(`donors/${avery.id}`,"document.querySelector('main [role=alert]')");assert.equal(await evaluate("document.querySelector('main').textContent.includes('avery-cycle@example.com')"),false);}
  assert.equal((await api('/retention/at-risk?mode=cycle')).status,403); // Default board role lacks reporting permission.
  await evaluate("document.querySelector('#session').click();document.querySelector('#sign-out').click()");await wait("!document.querySelector('#sign-in').hidden");
 }
 evidence.radar.ownerAccess=true;evidence.radar.unrelatedBoardDenied=true;evidence.radar.defaultBoardRadar='Unavailable without reports.read; staff prepares assigned draft and follow-up';
 // Fresh production visit is read-only. Never exercise a shared account here.
 let blockedWrites=0;await cdp('Fetch.enable',{patterns:[{urlPattern:'https://colorloop-nu.vercel.app/api/*',requestStage:'Request'}]});
 websocket.addEventListener('message',event=>{const d=JSON.parse(event.data);if(d.method!=='Fetch.requestPaused')return;const readOnly=['GET','HEAD'].includes(d.params.request.method);if(!readOnly)blockedWrites++;void cdp(readOnly?'Fetch.continueRequest':'Fetch.failRequest',{requestId:d.params.requestId,...(readOnly?{}:{errorReason:'BlockedByClient'})});});
 await cdp('Page.navigate',{url:'https://colorloop-nu.vercel.app'});await wait("!document.querySelector('#sign-in')?.hidden&&!!document.querySelector('#sign-in-form')");
 assert.equal(await evaluate("document.querySelector('#app-shell').hidden"),true);await screenshot('production-sign-in');
 const deployed=await nativeFetch('https://colorloop-nu.vercel.app/public/js/outreach-ui.js');assert.equal(deployed.status,200);const deployedSource=await deployed.text();
 evidence.production={freshSignIn:true,writeRequestsBlocked:blockedWrites,radarAssetsDeployed:deployedSource.includes('Matched giving cycle')&&deployedSource.includes('Prepare check-in and follow-up'),authenticatedRadarNotVerified:true};assert.equal(blockedWrites,0);
 assert.deepEqual(exceptions,[]);assert.equal(digest(await readFile(csvPath)),evidence.csv.sha256);
 evidence.browserExceptions=exceptions.length;evidence.result=evidence.mentor.reimport.blocker?'PARTIAL':'PASS';
 await writeFile(join(tmpdir(),'colorloop-final-rehearsal.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{
 globalThis.fetch=nativeFetch;websocket?.close();if(chrome){const exited=once(chrome,'exit');chrome.kill('SIGTERM');await exited;}if(server)await new Promise(resolve=>server.close(resolve));await database.close();await rm(directory,{recursive:true,force:true});
}
