import test from 'node:test';
import assert from 'node:assert/strict';
import {mentorFixture} from '../test-support/mentor-fixture.js';
import {createManualDonor} from '../lib/manual-entry.js';
import {approveDraft,saveDraft} from '../lib/outreach.js';
import {saveTask,assignDonor} from '../lib/assignment.js';
import {createMemoryStore} from '../lib/retention-store.js';
import {createEmailProvider} from '../lib/email-provider.js';
import {processEmailAutomation,saveEmailSettings,reminderWindow} from '../lib/email-automation.js';
import {preparationJob} from '../lib/preparation-job.js';

const addresses={donor:'donor@synthetic-cic-mail.org',board:'board@synthetic-cic-mail.org',admin:'admin@synthetic-cic-mail.org',changedDonor:'donor-updated@synthetic-cic-mail.org',changedBoard:'board-updated@synthetic-cic-mail.org'};
const env={EMAIL_DELIVERY_MODE:'test',RESEND_API_KEY:'synthetic-injected-key',EMAIL_FROM:'sender@synthetic-cic-mail.org',EMAIL_TEST_INBOXES:Object.values(addresses).join(','),APP_ORIGIN:'https://colorloop.vercel.app',VERCEL:'1'};
const now=new Date('2026-11-17T18:00:00Z');
function transport(){
 const posts=[],states=new Map();
 const provider=createEmailProvider({env,fetcher:async(url,options)=>{
  if(options.method==='POST'){const id=`injected-${posts.length+1}`;posts.push({id,...JSON.parse(options.body)});states.set(id,'queued');return Response.json({id});}
  const id=url.split('/').at(-1);return Response.json({id,last_event:states.get(id)});
 }});return {provider,posts,states};
}
async function fixture(){
 const f=await mentorFixture();
 await f.db.query('UPDATE users SET email=$2 WHERE id=$1',[f.admin.id,addresses.admin]);
 const member=await f.board('routing');await f.db.query('UPDATE users SET email=$2 WHERE id=$1',[member.id,addresses.board]);
 const donor=await f.tx(q=>createManualDonor(q,{display_name:'Synthetic Jordan Ellis',normalized_email:addresses.donor,email_consent:true,owner_id:member.id,idempotency_key:'synthetic-routing-gift',initial_donation:{amount:'1',currency:'USD',status:'completed',source:'check',donation_date:'2026-11-15'}},f.admin));
 await f.db.query("UPDATE tasks SET status='cancelled' WHERE event_key LIKE 'onboarding:%'");
 return {...f,member,donor,task:()=>saveTask(f.store,f.admin,{donorId:donor.id,assigneeId:member.id,nextAction:'Review the fictional donor relationship',dueAt:'2026-11-20'},now)};
}
const enable=(f,donorEnabled,boardEnabled)=>saveEmailSettings(f.store,f.admin,{donorEnabled,boardEnabled,confirmed:true,reason:'Explicit approval of synthetic routing and scheduler tests'},now,env);
const run=(f,mail,options={})=>processEmailAutomation(f.store,f.admin.id,now,{env,...options,provider:mail.provider});

test('scheduled reminders block a board account outside the test allowlist without redirecting or editing its email',async()=>{
 const f=await fixture();let sends=0;
 try{
  await f.task();await enable(f,false,true);
  const restricted={...env,EMAIL_TEST_INBOXES:addresses.admin};
  const provider=createEmailProvider({env:restricted,fetcher:async()=>{sends++;assert.fail('No email can be redirected to the allowlisted admin inbox');}});
  const result=await processEmailAutomation(f.store,f.admin.id,now,{env:restricted,provider});
  assert.equal(result.blocked,1);assert.equal(sends,0);
  assert.equal((await f.db.query('SELECT email FROM users WHERE id=$1',[f.member.id])).rows[0].email,addresses.board);
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM audit_events WHERE action='email.dispatch.blocked' AND details->>'code'='EMAIL_TEST_INBOX_REQUIRED'")).rows[0].n,1);
 }finally{await f.db.close();}
});

test('thank-you and follow-up recipients come from current donor SQL records, with approval, consent and duplicate checks',async()=>{
 const f=await fixture(),mail=transport();
 try{
  await enable(f,true,false);
  const thanks=await f.store.read(s=>s.drafts.find(d=>d.donorId===f.donor.id&&d.channel==='email'));
  assert.equal((await run(f,mail)).queued,0,'unapproved thank-you cannot send');
  await approveDraft(f.store,f.admin,{id:thanks.id,revision:thanks.revision},now);
  await Promise.all([run(f,mail),run(f,mail)]);
  assert.deepEqual(mail.posts.map(p=>p.to),[[addresses.donor]]);
  const follow=await saveDraft(f.store,f.admin,{donorId:f.donor.id,templateId:'follow-up'},now);
  await approveDraft(f.store,f.admin,{id:follow.id,revision:follow.revision},now);
  await f.db.query('UPDATE donors SET normalized_email=$2,opted_out=true WHERE id=$1',[f.donor.id,addresses.changedDonor]);
  assert.equal((await run(f,mail)).blocked,1);assert.equal(mail.posts.length,1);
  await f.db.query('UPDATE donors SET opted_out=false,email_consent=false WHERE id=$1',[f.donor.id]);
  assert.equal((await run(f,mail)).blocked,1);assert.equal(mail.posts.length,1);
  await f.db.query('UPDATE donors SET email_consent=true WHERE id=$1',[f.donor.id]);
  await run(f,mail);await run(f,mail);
  assert.deepEqual(mail.posts.map(p=>p.to),[[addresses.donor],[addresses.changedDonor]]);
  assert.ok(mail.posts.every(p=>!p.to.includes(addresses.admin)&&!p.to.includes(addresses.board)));
  assert.deepEqual((await f.db.query("SELECT recipient FROM outreach_delivery_history WHERE status='sending' ORDER BY occurred_at,id")).rows.map(r=>r.recipient).sort(),[addresses.donor,addresses.changedDonor].sort());
 }finally{await f.db.close();}
});
test('board reminders resolve the assigned account email dynamically and include a deployed task link',async()=>{
 const f=await fixture(),mail=transport();
 try{
  const task=await f.task();await enable(f,false,true);
  await f.db.query('UPDATE users SET email=$2 WHERE id=$1',[f.member.id,addresses.changedBoard]);
  await Promise.all([run(f,mail),run(f,mail)]);await run(f,mail);
  assert.deepEqual(mail.posts.map(p=>p.to),[[addresses.changedBoard]]);
  assert.match(mail.posts[0].text,/Synthetic Jordan Ellis\nNext action: Review the fictional donor relationship\nDue: 2026-11-20 \(America\/Phoenix\)\nStatus: approaching/);
  assert.ok(mail.posts[0].text.endsWith(`https://colorloop.vercel.app/#tasks?task=${task.id}`));
  assert.doesNotMatch(mail.posts[0].text,/localhost/);
  const history=(await f.db.query('SELECT status,recipient FROM outreach_delivery_history ORDER BY occurred_at,id')).rows;
  assert.deepEqual(history.map(h=>h.status).sort(),['queued','sending']);assert.equal(history.find(h=>h.status==='sending').recipient,addresses.changedBoard);
 }finally{await f.db.close();}
});
test('completed, cancelled and reassigned reminders are suppressed; new authorized assignees receive fresh reminders',async()=>{
 const f=await fixture(),mail=transport();
 try{
  const tasks=await Promise.all([f.task(),f.task(),f.task()]);await enable(f,false,true);
  const blocked={provider:{...mail.provider,validateRecipient(){throw Object.assign(new Error(),{code:'TEST_HOLD'});}}};
  await processEmailAutomation(f.store,f.admin.id,now,{env,...blocked});assert.equal(mail.posts.length,0);
  const other=await f.board('reassigned');await f.db.query('UPDATE users SET email=$2 WHERE id=$1',[other.id,addresses.changedBoard]);
  for(const [i,change] of [{status:'completed'},{status:'cancelled'},{assigneeId:other.id}].entries())await saveTask(f.store,f.admin,{id:tasks[i].id,...change},now,true);
  await run(f,mail);assert.equal(mail.posts.length,0,'no old recipient and no unauthorized new recipient');
  await assignDonor(f.store,{donorId:f.donor.id,assigneeId:other.id},f.admin.id,now,f.admin);
  await run(f,mail);await run(f,mail);
  assert.deepEqual(mail.posts.map(p=>p.to),[[addresses.changedBoard]]);
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM audit_events WHERE action='email.dispatch.blocked' AND details->>'code'='REMINDER_CHANGED'")).rows[0].n,3);
 }finally{await f.db.close();}
});
test('missing board email never falls back to donor or administrator; invalid task dates do not abort valid work',async()=>{
 const f=await fixture(),mail=transport();
 try{
  await f.task();await enable(f,false,true);
  await f.db.query('UPDATE users SET email=$2 WHERE id=$1',[f.member.id,'']);
  assert.equal((await run(f,mail)).blocked,1);assert.equal(mail.posts.length,0);
  await f.db.query('UPDATE users SET email=$2 WHERE id=$1',[f.member.id,addresses.board]);
  const state=await f.store.read(s=>s),task=state.tasks.find(t=>t.status==='open');
  state.tasks.push({...task,id:'synthetic-invalid-date',dueAt:'invalid'}, {...task,id:'synthetic-missing-date',dueAt:null},{...task,id:'synthetic-empty-action',nextAction:''});
  const memory=createMemoryStore(state);await processEmailAutomation(memory,f.admin.id,now,{env,provider:mail.provider});
  assert.deepEqual(mail.posts.map(p=>p.to),[[addresses.board]]);
  for(const value of [null,undefined,'','invalid'])assert.equal(reminderWindow(value,now),null);
  assert.equal(reminderWindow('2026-11-17T00:00:00Z',new Date('2026-11-17T06:59:00Z')),'approaching:2026-11-17');
  assert.equal(reminderWindow('2026-11-17T00:00:00Z',new Date('2026-11-17T07:00:00Z')),'due:2026-11-17');
 }finally{await f.db.close();}
});
test('hosted reminders reject localhost and refuse to send previously approved links from another origin',async()=>{
 const f=await fixture(),mail=transport();
 try{
  await f.task();await enable(f,false,true);
  for(const origin of ['https://localhost:3000','https://localhost.','https://127.0.0.1','https://[::1]'])await assert.rejects(run(f,mail,{env:{...env,APP_ORIGIN:origin}}),{code:'EMAIL_ORIGIN_UNCONFIGURED'});
  await processEmailAutomation(f.store,f.admin.id,now,{env,provider:{...mail.provider,validateRecipient(){throw Object.assign(new Error(),{code:'TEST_HOLD'});}}});
  assert.equal((await run(f,mail,{env:{...env,APP_ORIGIN:'https://colorloop-new.vercel.app'}})).blocked,1);
  assert.equal(mail.posts.length,0);
 }finally{await f.db.close();}
});
test('protected scheduled jobs require a separate send opt-in, genuine operator and approved board policy; retries cannot duplicate',async()=>{
 const f=await fixture(),mail=transport(),secret='synthetic-cron-secret-at-least-32-characters';
 try{
  await f.task();await enable(f,false,true);
  const call=async(options={})=>{const res={setHeader(){},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};await preparationJob({method:'GET',headers:{authorization:`Bearer ${secret}`,...options.headers}},res,{store:f.store,secret,userId:options.userId||f.admin.id,now,env:{...env,...options.env},provider:mail.provider});return res;};
  assert.equal((await call({headers:{authorization:'Bearer forged'}})).statusCode,401);
  assert.equal((await call({userId:'missing'})).statusCode,403);
  assert.equal((await call()).body.data.email.scheduledDeliveryDisabled,true);assert.equal(mail.posts.length,0);
  const enabled={env:{EMAIL_CRON_ENABLED:'true'}};
  const first=await call(enabled);assert.equal(first.statusCode,200);assert.equal(first.body.data.email.queued,1);
  await Promise.all([call(enabled),call(enabled)]);assert.deepEqual(mail.posts.map(p=>p.to),[[addresses.board]]);
  mail.states.set(mail.posts[0].id,'delivered');assert.equal((await call(enabled)).body.data.email.deliveryUpdates,1);
  assert.deepEqual((await f.db.query('SELECT status FROM outreach_delivery_history')).rows.map(r=>r.status).sort(),['delivered','queued','sending']);
  await enable(f,false,false);await f.task();await call(enabled);assert.equal(mail.posts.length,1,'server gate never bypasses approved policy');
  await f.db.query('UPDATE users SET active=false WHERE id=$1',[f.admin.id]);assert.equal((await call(enabled)).statusCode,403);
 }finally{await f.db.close();}
});
