// Manual, approval-gated rehearsal: disposable PostgreSQL, real allowlisted mail.
// Startup never sends. Each SEND command requires a separate operator approval.
import {readFile,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {createInterface} from 'node:readline';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';

const local=dotenv.parse(await readFile(new URL('../.env',import.meta.url)));
const inboxes=(local.EMAIL_TEST_INBOXES||'').split(',').map(v=>v.trim()).filter(Boolean);
assert.equal(inboxes.length,1,'Rehearsal requires exactly one operator-owned test inbox.');
assert.ok(local.RESEND_API_KEY&&local.EMAIL_FROM,'Configure the private provider credential and sender first.');
// Copy only transport configuration. This process cannot use the Neon URL.
delete process.env.DATABASE_URL;
for(const key of ['RESEND_API_KEY','EMAIL_FROM','EMAIL_TEST_INBOXES'])process.env[key]=local[key];
process.env.EMAIL_DELIVERY_MODE='test';
process.env.CIC_DONOR_AUTOMATION_APPROVED='false';
process.env.EMAIL_CRON_ENABLED='false';
process.env.APP_ORIGIN='https://localhost:3000';
process.env.CRON_SECRET=randomBytes(32).toString('hex');
const {mentorFixture}=await import('../test-support/mentor-fixture.js');
const {createManualDonor}=await import('../lib/manual-entry.js');
const {createEmailProvider}=await import('../lib/email-provider.js');
const f=await mentorFixture(),auth=await f.session(f.admin);
process.env.AUTOMATION_USER_ID=f.admin.id;
const checked=async(path,method='GET',body={},headers={})=>{
 const r=await f.call(path,method,body,auth,headers);
 assert.ok(r.statusCode>=200&&r.statusCode<300,`${path}: ${r.body?.error?.code||r.statusCode}`);
 return r.body.data;
};
const member=await f.board('email-rehearsal');
await f.db.query('UPDATE users SET email=$2 WHERE id=$1',[member.id,inboxes[0]]);
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Phoenix',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const donor=await f.tx(q=>createManualDonor(q,{display_name:'Synthetic Jordan Ellis',normalized_email:inboxes[0],email_consent:true,owner_id:member.id,
 idempotency_key:'real-email-rehearsal-gift',initial_donation:{amount:'1.00',currency:'USD',status:'completed',source:'cash',donation_date:day}},f.admin));
// Cancel only this isolated fixture's generated onboarding task.
await f.db.query("UPDATE tasks SET status='cancelled' WHERE event_key LIKE 'onboarding:%'");
const task=await checked('tasks','POST',{donorId:donor.id,assigneeId:member.id,nextAction:'TEST ONLY: review the fictional donor follow-up; no donor contact is required.',dueAt:day});
const original=await f.store.read(s=>s.drafts.find(d=>d.donorId===donor.id&&d.channel==='email'));
const subject='ColorLoop TEST: thank-you email';
const body=`Hello Synthetic Jordan Ellis,\n\nThank you for your synthetic USD 1.00 contribution dated ${day}.\n\nThis is an approved ColorLoop delivery test sent only to the operator-owned test inbox. No real donation was received or charged. No action is required.`;
const draft=await checked('outreach/drafts','PATCH',{id:original.id,revision:original.revision,subject,body});
const provider=createEmailProvider();provider.validateRecipient(inboxes[0]);
const nativeFetch=globalThis.fetch,posts=[];let allowed=null;
// A second guard limits this process to the two reviewed messages and one attempt each.
globalThis.fetch=async(url,options={})=>{
 const target=new URL(url);
 assert.equal(target.origin,'https://api.resend.com');
 if(options.method==='POST'){
  assert.equal(target.pathname,'/emails');
  const payload=JSON.parse(options.body),kind=payload.subject===subject?'thank-you':payload.subject==='Coding in Color: donor follow-up reminder'?'board':null;
  assert.ok(kind&&allowed===kind,'No approval for this provider send.');
  assert.deepEqual(payload.to,[inboxes[0]]);
  assert.ok(!posts.some(p=>p.kind===kind),'Rehearsal prevents a second provider POST for this message.');
  if(kind==='thank-you')assert.equal(payload.text,body);
  if(kind==='board')assert.equal(payload.text,`Follow-up for Synthetic Jordan Ellis\nNext action: ${task.nextAction}\nDue: ${day} (America/Phoenix)\nStatus: due\nOpen ColorLoop: https://localhost:3000/#tasks?task=${task.id}`);
  posts.push({kind,at:new Date().toISOString()});
 }
 return nativeFetch(url,options);
};
const policy=(donorEnabled,boardEnabled)=>checked('email/settings','POST',{donorEnabled,boardEnabled,confirmed:true,reason:'Operator explicitly approved this isolated verified-inbox email rehearsal only.'});
const report=async()=>{
 const data=await f.store.read(s=>({database:'disposable-in-memory-postgresql',mode:'test',liveDonorAutomation:false,
  providerPosts:posts.map(p=>({...p})),messages:s.drafts.filter(d=>d.id===draft.id||d.eventKey?.startsWith('board-reminder:')).map(d=>({id:d.id,audience:d.audience,subject:d.subject,status:d.status,providerId:d.providerId||null,revision:d.revision})),
  deliveryHistory:s.sendHistory.map(h=>({draftId:h.draftId,status:h.status,providerId:h.providerId||null,code:h.code||null})),
  receiptReadFailures:s.audit.filter(a=>a.action==='email.status.checked'&&a.details?.code==='EMAIL_STATUS_UNAVAILABLE').length,
  policy:{donorEnabled:s.settings.emailPolicy?.donorEnabled||false,boardEnabled:s.settings.emailPolicy?.boardEnabled||false}}));
 await writeFile('/tmp/colorloop-real-email-rehearsal.json',JSON.stringify(data,null,2),{mode:0o600});
 console.log(JSON.stringify(data));
};
assert.equal((await checked('email/settings')).policy.donorEnabled,false);
assert.equal((await checked('email/settings')).policy.boardEnabled,false);
assert.equal(posts.length,0);
console.log(JSON.stringify({ready:true,noEmailsSent:true,recipient:'the sole EMAIL_TEST_INBOXES inbox',thankYou:{subject,body},board:{subject:'Coding in Color: donor follow-up reminder',body:`Follow-up for Synthetic Jordan Ellis\nNext action: ${task.nextAction}\nDue: ${day} (America/Phoenix)\nStatus: due\nOpen ColorLoop: https://localhost:3000/#tasks?task=${task.id}`},commands:['SEND THANK-YOU','SEND BOARD','STATUS','QUIT']}));
const input=createInterface({input:process.stdin});
try{
 for await(const command of input){
  try{
   if(command==='QUIT')break;
   if(command==='SEND THANK-YOU'){
    assert.ok(!posts.some(p=>p.kind==='thank-you'),'Thank-you already attempted.');
    await checked('outreach/approve','POST',{id:draft.id,revision:draft.revision});
    await policy(true,false);allowed='thank-you';
    try{
     const first=await checked('email/run','POST',{confirmed:true});
     assert.equal(first.queued,1,'Provider did not accept the thank-you; review history before any retry.');
     const count=posts.length;
     const again=await checked('email/run','POST',{confirmed:true});
     assert.equal(again.queued,0);assert.equal(posts.length,count);
     console.log(JSON.stringify({thankYou:first,duplicateRun:again,duplicateProtected:true}));
    }finally{allowed=null;await policy(false,false);}
   }else if(command==='SEND BOARD'){
    assert.ok(!posts.some(p=>p.kind==='board'),'Board reminder already attempted.');
    await policy(false,true);allowed='board';process.env.EMAIL_CRON_ENABLED='true';
    try{
     assert.equal((await f.call('jobs/prepare')).statusCode,401,'Scheduler must reject unauthenticated callers.');
     // A one-shot timer invokes the actual protected job, independently of UI clicks.
     const first=await new Promise((resolve,reject)=>setTimeout(()=>checked('jobs/prepare','GET',{}, {authorization:`Bearer ${process.env.CRON_SECRET}`}).then(resolve,reject),1000));
     assert.equal(first.email.queued,1,'Provider did not accept the board reminder; review history before retrying.');
     const count=posts.length;
     const again=await checked('jobs/prepare','GET',{}, {authorization:`Bearer ${process.env.CRON_SECRET}`});
     assert.equal(again.email.queued,0);assert.equal(posts.length,count);
     console.log(JSON.stringify({automaticTimerJob:first,duplicateJob:again,schedulerCredentialEnforced:true,duplicateProtected:true}));
    }finally{allowed=null;process.env.EMAIL_CRON_ENABLED='false';await policy(false,false);}
   }else if(command!=='STATUS')throw new Error('Unknown rehearsal command.');
   await report();
  }catch(error){allowed=null;await policy(false,false).catch(()=>{});console.log(JSON.stringify({error:error.code||error.name,message:'Rehearsal stopped this action. Review the sanitized delivery report before retrying.'}));await report();}
 }
}finally{input.close();process.stdin.pause();await policy(false,false).catch(()=>{});await f.db.close();}
