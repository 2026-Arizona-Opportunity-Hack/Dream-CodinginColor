import test from 'node:test';
import assert from 'node:assert/strict';
import {mentorFixture,password} from '../test-support/mentor-fixture.js';
import {createManualDonor} from '../lib/manual-entry.js';
import {approveDraft,saveDraft,listDrafts} from '../lib/outreach.js';
import {saveTask} from '../lib/assignment.js';
import {createEmailProvider} from '../lib/email-provider.js';
import {saveEmailSettings,readEmailSettings,processEmailAutomation,reminderWindow} from '../lib/email-automation.js';
import {followUpDay as frontendDueDay} from '../public/js/donor-view.js';
const inbox='verified-inbox@cic-approved-mail.org',boardInbox='verified-board@cic-approved-mail.org';
const env={EMAIL_DELIVERY_MODE:'test',RESEND_API_KEY:'synthetic-transport-credential',EMAIL_FROM:'notifications@cic-approved-mail.org',EMAIL_TEST_INBOXES:`${inbox},${boardInbox}`,APP_ORIGIN:'https://colorloop.example'};
const now=new Date('2026-11-17T18:00:00Z');
const decision=(donorEnabled,boardEnabled)=>({donorEnabled,boardEnabled,confirmed:true,reason:'Synthetic administrator explicitly reviewed sending policy'});
function transport(overrides={}){
 const posts=[],states=new Map();let count=0;
 const provider=createEmailProvider({env:{...env,...overrides},fetcher:async(url,options)=>{
  if(options.method==='POST'){const id=`synthetic-receipt-${++count}`;posts.push({id,key:options.headers['Idempotency-Key'],body:JSON.parse(options.body)});states.set(id,'queued');return new Response(JSON.stringify({id}),{status:200});}
  const id=url.split('/').at(-1);return new Response(JSON.stringify({id,last_event:states.get(id)||'queued'}),{status:200});
 }});return {provider,posts,states};
}
async function donorAndDraft(f,name='Synthetic Approved Donor',email=inbox,distinct=false){
 const donor=await f.tx(q=>createManualDonor(q,{display_name:name,normalized_email:email,email_consent:true,...(distinct?{allow_duplicate:true,duplicate_reason:'Synthetic distinct identities deliberately share one verified test inbox'}:{}),idempotency_key:`gift-${name.replaceAll(' ','-')}`,initial_donation:{amount:'25',currency:'USD',status:'completed',source:'cash',donation_date:'2026-11-15'}},f.admin));
 const draft=await f.store.read(s=>s.drafts.find(d=>d.donorId===donor.id));return {donor,draft};
}
test('automation is off by default; approved donor emails queue once, then record provider delivery evidence',async()=>{
 const f=await mentorFixture(),mail=transport();
 try{
  const {draft}=await donorAndDraft(f);
  assert.equal((await processEmailAutomation(f.store,f.admin.id,now,{env:{},provider:mail.provider})).enabled,false);
  await saveEmailSettings(f.store,f.admin,decision(true,false),now,env);
  assert.equal((await processEmailAutomation(f.store,f.admin.id,now,{env,provider:mail.provider})).queued,0,'unapproved thank-you must not send');
  await approveDraft(f.store,f.admin,{id:draft.id,revision:draft.revision},now);
  await Promise.all([processEmailAutomation(f.store,f.admin.id,now,{env,provider:mail.provider}),processEmailAutomation(f.store,f.admin.id,now,{env,provider:mail.provider})]);
  assert.equal(mail.posts.length,1);assert.equal(mail.posts[0].key,`colorloop/${draft.id}:1`);
  assert.equal((await f.store.read(s=>s.drafts.find(d=>d.id===draft.id))).status,'queued');
  mail.states.set(mail.posts[0].id,'delivered');
  const result=await processEmailAutomation(f.store,f.admin.id,new Date(+now+60000),{env,provider:mail.provider});assert.equal(result.deliveryUpdates,1);assert.equal(mail.posts.length,1);
  assert.equal((await f.store.read(s=>s.drafts.find(d=>d.id===draft.id))).status,'delivered');
  assert.deepEqual((await f.db.query('SELECT status FROM outreach_delivery_history')).rows.map(r=>r.status).sort(),['delivered','queued','sending']);
  const followUp=await saveDraft(f.store,f.admin,{donorId:draft.donorId,templateId:'follow-up'},now);await approveDraft(f.store,f.admin,{id:followUp.id,revision:1},now);
  assert.equal((await processEmailAutomation(f.store,f.admin.id,now,{env,provider:mail.provider})).queued,1);assert.equal(mail.posts.length,2);
 }finally{await f.db.close();}
});
test('calendar due days agree between Today, follow-up UI and reminder scheduling',async()=>{
 const f=await mentorFixture();
 try{
  assert.equal(frontendDueDay('2026-11-20T00:00:00+00:00'),'2026-11-20');assert.equal(frontendDueDay('2026-11-20T03:00:00Z'),'2026-11-19');
  const donor=await f.tx(q=>createManualDonor(q,{display_name:'Synthetic calendar task'},f.admin));await saveTask(f.store,f.admin,{donorId:donor.id,assigneeId:f.admin.id,nextAction:'Synthetic due November 20',dueAt:'2026-11-20'},now);
  const auth=await f.session(f.admin),early=await f.call('v1/overview','GET',{on:'2026-11-19',time_zone:'America/Phoenix'},auth),due=await f.call('v1/overview','GET',{on:'2026-11-20',time_zone:'America/Phoenix'},auth);
  assert.equal(early.body.data.counts.overdue,0);assert.equal(early.body.data.counts.due_today,0);assert.equal(due.body.data.counts.due_today,1);
 }finally{await f.db.close();}
});
test('repeated provider rate limits stop after three attempts without changing approval or retry identity',async()=>{
 const f=await mentorFixture();let calls=0;const keys=[];
 const provider=createEmailProvider({env,fetcher:async(url,options)=>{calls++;keys.push(options.headers['Idempotency-Key']);return new Response('{}',{status:429});}});
 try{
  const {draft}=await donorAndDraft(f);await approveDraft(f.store,f.admin,{id:draft.id,revision:1},now);await saveEmailSettings(f.store,f.admin,decision(true,false),now,env);
  for(const minutes of [0,16,47,100])await processEmailAutomation(f.store,f.admin.id,new Date(+now+minutes*60000),{env,provider});
  assert.equal(calls,3);assert.equal(new Set(keys).size,1);assert.equal((await f.db.query('SELECT count(*)::int AS n FROM outreach_approval_history WHERE message_id=$1',[draft.id])).rows[0].n,1);
 }finally{await f.db.close();}
});
test('consent, reserved addresses and verified-inbox gates block dispatch and expose safe UI issues',async()=>{
 const f=await mentorFixture(),mail=transport();
 try{
  await saveEmailSettings(f.store,f.admin,decision(true,false),now,env);
  for(const [name,email,distinct] of [['Synthetic Reserved','synthetic@example.com'],['Synthetic Not Allowlisted','unverified@cic-approved-mail.org'],['Synthetic Revoked',inbox],['Synthetic Refunded',inbox,true]]){
   const {donor,draft}=await donorAndDraft(f,name,email,distinct);await approveDraft(f.store,f.admin,{id:draft.id,revision:1},now);
   if(name==='Synthetic Revoked')await f.db.query('UPDATE donors SET opted_out=true WHERE id=$1',[donor.id]);
   if(name==='Synthetic Refunded')await f.db.query("UPDATE donations SET status='refunded' WHERE donor_id=$1",[donor.id]);
  }
  const result=await processEmailAutomation(f.store,f.admin.id,now,{env,provider:mail.provider});assert.equal(result.blocked,4);assert.equal(mail.posts.length,0);
  const issues=await f.store.read(s=>listDrafts(s,{},f.admin).map(d=>d.deliveryIssue));assert.ok(issues.includes('EMAIL_RECIPIENT_BLOCKED'));assert.ok(issues.includes('EMAIL_TEST_INBOX_REQUIRED'));assert.ok(issues.includes('CONTACT_NOT_ALLOWED'));assert.ok(issues.includes('GIFT_CHANGED'));
  const before=(await f.db.query("SELECT count(*)::int AS n FROM audit_events WHERE action='email.dispatch.blocked'")).rows[0].n;
  await processEmailAutomation(f.store,f.admin.id,now,{env,provider:mail.provider});assert.equal((await f.db.query("SELECT count(*)::int AS n FROM audit_events WHERE action='email.dispatch.blocked'")).rows[0].n,before);
 }finally{await f.db.close();}
});
test('live donor activation requires independent CIC confirmation and an active administrator policy',async()=>{
 const f=await mentorFixture(),mail=transport(),live={...env,EMAIL_DELIVERY_MODE:'live',NODE_ENV:'production'};
 try{
  await assert.rejects(saveEmailSettings(f.store,f.admin,decision(true,false),now,live),{code:'CIC_APPROVAL_REQUIRED'});
  await saveEmailSettings(f.store,f.admin,decision(true,false),now,env);
  const {draft}=await donorAndDraft(f);await approveDraft(f.store,f.admin,{id:draft.id,revision:1},now);
  assert.equal((await processEmailAutomation(f.store,f.admin.id,now,{env:live,provider:mail.provider})).blocked,1);assert.equal(mail.posts.length,0);
  const approved={...live,CIC_DONOR_AUTOMATION_APPROVED:'true',CIC_EMAIL_APPROVAL_REFERENCE:'Synthetic CIC test policy reference'};
  await saveEmailSettings(f.store,f.admin,decision(true,false),now,approved);
  await processEmailAutomation(f.store,f.admin.id,now,{env:approved,provider:mail.provider});assert.equal(mail.posts.length,1);
 }finally{await f.db.close();}
});
test('board reminders use Phoenix approaching/due/weekly-overdue windows and deduplicate task, recipient and deadline',async()=>{
 const f=await mentorFixture(),mail=transport();
 try{
  const member=await f.board('reminder-board');await f.db.query('UPDATE users SET email=$2 WHERE id=$1',[member.id,boardInbox]);
  const donor=await f.tx(q=>createManualDonor(q,{display_name:'Synthetic Jordan Ellis',owner_id:member.id},f.admin));
  await f.db.query("UPDATE tasks SET status='cancelled' WHERE event_key LIKE 'onboarding:%'");
  const task=await saveTask(f.store,f.admin,{donorId:donor.id,assigneeId:member.id,nextAction:'Synthetic November 20 follow-up',dueAt:'2026-11-20'},now);
  assert.equal(reminderWindow('2026-11-20T00:00:00.000Z',now),'approaching:2026-11-20');
  await saveEmailSettings(f.store,f.admin,decision(false,true),now,env);
  await processEmailAutomation(f.store,f.admin.id,now,{env,provider:mail.provider});assert.equal(mail.posts.length,1);assert.match(mail.posts[0].body.text,/Synthetic Jordan Ellis/);assert.match(mail.posts[0].body.text,/2026-11-20/);assert.deepEqual(mail.posts[0].body.to,[boardInbox]);
  await processEmailAutomation(f.store,f.admin.id,new Date('2026-11-18T18:00:00Z'),{env,provider:mail.provider});assert.equal(mail.posts.length,1);
  await processEmailAutomation(f.store,f.admin.id,new Date('2026-11-20T18:00:00Z'),{env,provider:mail.provider});assert.equal(mail.posts.length,2);
  await processEmailAutomation(f.store,f.admin.id,new Date('2026-11-21T18:00:00Z'),{env,provider:mail.provider});assert.equal(mail.posts.length,3);
  await processEmailAutomation(f.store,f.admin.id,new Date('2026-11-22T18:00:00Z'),{env,provider:mail.provider});assert.equal(mail.posts.length,3);
  await saveTask(f.store,f.admin,{id:task.id,status:'completed'},now,true);
  await processEmailAutomation(f.store,f.admin.id,new Date('2026-11-28T18:00:00Z'),{env,provider:mail.provider});assert.equal(mail.posts.length,3);
 }finally{await f.db.close();}
});
test('changed follow-ups are suppressed and edited internal reminder content is never automatically reapproved',async()=>{
 const f=await mentorFixture(),blocked=transport({EMAIL_TEST_INBOXES:inbox}),mail=transport();
 try{
  const member=await f.board('review-board');await f.db.query('UPDATE users SET email=$2 WHERE id=$1',[member.id,boardInbox]);
  const donor=await f.tx(q=>createManualDonor(q,{display_name:'Synthetic changed follow-up',owner_id:member.id},f.admin));await f.db.query("UPDATE tasks SET status='cancelled' WHERE event_key LIKE 'onboarding:%'");
  const task=await saveTask(f.store,f.admin,{donorId:donor.id,assigneeId:member.id,nextAction:'Synthetic reviewed action',dueAt:'2026-11-20'},now);
  await saveEmailSettings(f.store,f.admin,decision(false,true),now,env);await processEmailAutomation(f.store,f.admin.id,now,{env,provider:blocked.provider});assert.equal(blocked.posts.length,0);
  const draft=await f.store.read(s=>s.drafts.find(d=>d.eventKey?.startsWith('board-reminder:')));
  await saveTask(f.store,f.admin,{id:task.id,dueAt:'2026-12-20'},now,true);
  assert.equal((await processEmailAutomation(f.store,f.admin.id,now,{env,provider:mail.provider})).blocked,1);assert.equal(mail.posts.length,0);
  await saveDraft(f.store,f.admin,{id:draft.id,revision:1,body:'Synthetic human edit requiring fresh approval'},now,true);
  await saveTask(f.store,f.admin,{id:task.id,dueAt:'2026-11-20'},now,true);
  await processEmailAutomation(f.store,f.admin.id,now,{env,provider:mail.provider});assert.equal(mail.posts.length,0);assert.equal((await f.store.read(s=>s.drafts.find(d=>d.id===draft.id))).status,'draft');
 }finally{await f.db.close();}
});
test('known rate-limit rejection retries with backoff and same key; uncertain failures never automatically retry',async()=>{
 for(const uncertain of [false,true]){
  const f=await mentorFixture();let calls=0;const keys=[];
  const provider=createEmailProvider({env,fetcher:async(url,options)=>{if(options.method!=='POST')return new Response(JSON.stringify({id:'synthetic-retry',last_event:'queued'}));calls++;keys.push(options.headers['Idempotency-Key']);if(calls===1){if(uncertain)throw new Error('private transport details');return new Response('{}',{status:429});}return new Response(JSON.stringify({id:'synthetic-retry'}));}});
  try{
   const {draft}=await donorAndDraft(f);await approveDraft(f.store,f.admin,{id:draft.id,revision:1},now);await saveEmailSettings(f.store,f.admin,decision(true,false),now,env);
   await processEmailAutomation(f.store,f.admin.id,now,{env,provider});assert.equal(calls,1);
   await processEmailAutomation(f.store,f.admin.id,new Date(+now+5*60000),{env,provider});assert.equal(calls,1);
   await processEmailAutomation(f.store,f.admin.id,new Date(+now+16*60000),{env,provider});assert.equal(calls,uncertain?1:2);
   if(!uncertain)assert.equal(keys[0],keys[1]);
   assert.doesNotMatch(JSON.stringify(await f.store.read(s=>s.sendHistory)),/private transport details/);
  }finally{await f.db.close();}
 }
});
test('provider bounce records suppression and prevents later approved mail to that address',async()=>{
 const f=await mentorFixture(),mail=transport();
 try{
  const {donor,draft}=await donorAndDraft(f);await approveDraft(f.store,f.admin,{id:draft.id,revision:1},now);await saveEmailSettings(f.store,f.admin,decision(true,false),now,env);await processEmailAutomation(f.store,f.admin.id,now,{env,provider:mail.provider});
  mail.states.set(mail.posts[0].id,'bounced');await processEmailAutomation(f.store,f.admin.id,now,{env,provider:mail.provider});
  const followUp=await saveDraft(f.store,f.admin,{donorId:donor.id,templateId:'follow-up'},now);await approveDraft(f.store,f.admin,{id:followUp.id,revision:1},now);
  assert.equal((await processEmailAutomation(f.store,f.admin.id,now,{env,provider:mail.provider})).blocked,1);assert.equal(mail.posts.length,1);
  assert.equal((await f.store.read(s=>s.events.filter(e=>e.type==='email.suppression'))).length,1);
 }finally{await f.db.close();}
});
test('email policy/run routes require genuine MFA, CSRF and administrator authority; configuration never exposes secrets',async()=>{
 const f=await mentorFixture();
 try{
  assert.equal((await f.call('email/settings')).statusCode,401);const board=await f.board('restricted-email');const boardAuth=await f.session(board);assert.equal((await f.call('email/settings','GET',{},boardAuth)).statusCode,403);
  const auth=await f.session(f.admin);assert.equal((await f.call('email/settings','POST',decision(false,false),auth,{'x-csrf-token':'forged'})).statusCode,403);
  assert.equal((await f.call('email/settings','POST',decision(false,false),auth)).statusCode,200);
  assert.equal((await f.call('email/run','POST',{},auth)).statusCode,400);assert.equal((await f.call('email/run','POST',{confirmed:true},auth)).body.data.enabled,false);
  const settings=await readEmailSettings(f.store,env);assert.doesNotMatch(JSON.stringify(settings),/synthetic-transport-credential|verified-inbox@/);
  const login=await f.call('auth/login','POST',{email:f.admin.email,password});const partial={token:login.headers['Set-Cookie'].split(';')[0].split('=')[1],csrfToken:login.body.data.csrfToken};assert.equal((await f.call('email/settings','GET',{},partial)).statusCode,403);
 }finally{await f.db.close();}
});
