import test from 'node:test';
import assert from 'node:assert/strict';
import {createEmailProvider,emailConfiguration} from '../lib/email-provider.js';
import {mentorFixture} from '../test-support/mentor-fixture.js';
import {createManualDonor} from '../lib/manual-entry.js';
import {approveDraft,sendDraft,saveDraft} from '../lib/outreach.js';
import {saveDraft as prepareDraft} from '../lib/outreach.js';
import {previewMerge,confirmMerge} from '../lib/merge-review.js';
import {outreachStatus} from '../public/js/donor-view.js';
import {approvalSteps} from '../public/js/outreach-ui.js';
const inbox='verified-inbox@cic-approved-mail.org'; // Synthetic transport fixture; never contacted.
const env={EMAIL_DELIVERY_MODE:'test',RESEND_API_KEY:'synthetic-transport-credential',EMAIL_FROM:'notifications@cic-approved-mail.org',EMAIL_TEST_INBOXES:inbox};
const payload={to:inbox,subject:'Synthetic approved email',text:'Synthetic body only.',idempotencyKey:'synthetic-draft:1'};
const response=(value,status=200)=>new Response(JSON.stringify(value),{status});

test('email delivery is disabled by default; reserved addresses and unverified test inboxes never reach transport',async()=>{
 assert.equal(emailConfiguration({}).mode,'disabled');assert.throws(()=>createEmailProvider({env:{}}),{code:'EMAIL_DISABLED'});
 assert.throws(()=>createEmailProvider({env:{EMAIL_DELIVERY_MODE:'test'}}),{code:'EMAIL_UNCONFIGURED'});
 let calls=0;const provider=createEmailProvider({env,fetcher:async()=>{calls++;return response({id:'synthetic-provider-id'});}});
 for(const to of ['synthetic@example.com','synthetic@sub.example.org','synthetic@example.test','synthetic@localhost.invalid','delivered@resend.dev','not-allowed@cic-approved-mail.org'])await assert.rejects(provider.sendEmail({...payload,to}),e=>['EMAIL_RECIPIENT_BLOCKED','EMAIL_TEST_INBOX_REQUIRED'].includes(e.code));
 assert.equal(calls,0);
 const forcedTest=createEmailProvider({env:{...env,EMAIL_DELIVERY_MODE:'live',COLORLOOP_DEMO:'true',NODE_ENV:'production'},fetcher:async()=>{calls++;}});
 await assert.rejects(forcedTest.sendEmail({...payload,to:'not-allowed@cic-approved-mail.org'}),{code:'EMAIL_TEST_INBOX_REQUIRED'});assert.equal(calls,0);
});
test('real Resend request contract uses server credential, plain text and stable idempotency; acceptance is not delivery',async()=>{
 const calls=[];const provider=createEmailProvider({env,fetcher:async(url,options)=>{calls.push({url,options});return response(options.method==='POST'?{id:'synthetic-provider-id'}:{id:'synthetic-provider-id',last_event:'delivered'});}});
 assert.deepEqual(await provider.sendEmail(payload),{id:'synthetic-provider-id',status:'accepted'});
 assert.equal(calls[0].url,'https://api.resend.com/emails');assert.equal(calls[0].options.headers['Idempotency-Key'],'colorloop/synthetic-draft:1');assert.match(calls[0].options.headers.Authorization,/^Bearer /);
 assert.deepEqual(JSON.parse(calls[0].options.body),{from:env.EMAIL_FROM,to:[inbox],subject:payload.subject,text:payload.text});
 assert.deepEqual(await provider.getStatus('synthetic-provider-id'),{id:'synthetic-provider-id',status:'delivered',event:'delivered'});
 await assert.rejects(provider.sendEmail({...payload,subject:'Unsafe\nHeader'}),{code:'EMAIL_INPUT_INVALID'});
 await assert.rejects(provider.getStatus('../private'),{code:'EMAIL_ID_INVALID'});
});
test('rate limits are definitively unsent; ambiguous transport failures are sanitized and never claim success',async()=>{
 const limited=createEmailProvider({env,fetcher:async()=>response({message:'private provider detail'},429)});
 await assert.rejects(limited.sendEmail(payload),e=>e.code==='EMAIL_RATE_LIMITED'&&e.definitelyNotSent&&e.retryable&&!e.message.includes('private'));
 const uncertain=createEmailProvider({env,fetcher:async()=>{throw new Error('credential or donor PII must not escape');}});
 await assert.rejects(uncertain.sendEmail(payload),e=>e.code==='EMAIL_TRANSPORT_UNKNOWN'&&!e.definitelyNotSent&&!e.message.includes('credential or donor'));
});
test('SQL send claims deliver once and store queued rather than sent until provider evidence exists',async()=>{
 const {db,store,admin,tx}=await mentorFixture();
 try{
  const donor=await tx(q=>createManualDonor(q,{display_name:'Synthetic provider donor',normalized_email:inbox,email_consent:true},admin));
  const draft=await prepareDraft(store,admin,{donorId:donor.id,templateId:'follow-up'},new Date());
  await approveDraft(store,admin,{id:draft.id,revision:1},new Date());
  let calls=0;const provider=createEmailProvider({env,fetcher:async()=>{calls++;return response({id:'synthetic-sql-provider-id'});}});
  const attempts=await Promise.allSettled([sendDraft(store,admin,{id:draft.id,revision:1},new Date(),provider),sendDraft(store,admin,{id:draft.id,revision:1},new Date(),provider)]);assert.ok(attempts.some(a=>a.status==='fulfilled'));assert.equal(calls,1);
  const again=await sendDraft(store,admin,{id:draft.id,revision:1},new Date(),provider);assert.equal(again.status,'queued');assert.equal(again.sentAt,null);assert.equal(calls,1);
  assert.deepEqual((await db.query('SELECT status FROM outreach_delivery_history ORDER BY occurred_at,id')).rows.map(r=>r.status).sort(),['queued','sending']);
  await assert.rejects(saveDraft(store,admin,{id:draft.id,revision:1,body:'Do not edit a queued send'},new Date(),true),{code:'DRAFT_LOCKED'});
  const target=await tx(q=>createManualDonor(q,{display_name:'Synthetic merge target'},admin));
  const merge={canonical_donor_id:target.id,merged_donor_id:donor.id,reason:'Synthetic independent source review'};
  const preview=await tx(q=>previewMerge(q,merge,admin));assert.equal(preview.blockers[0].code,'MERGE_OUTREACH_IN_FLIGHT');
  await assert.rejects(tx(q=>confirmMerge(q,{...merge,preview_id:preview.preview_id,confirmed:true,identity_confirmed:true},admin)),{code:'MERGE_OUTREACH_IN_FLIGHT'});
 }finally{await db.close();}
});
test('UI labels distinguish provider acceptance, delivery evidence, bounce and human attestation',()=>{
 assert.match(outreachStatus({status:'queued'}),/delivery pending/);assert.equal(outreachStatus({status:'delivered'}),'Provider-confirmed delivered');assert.match(outreachStatus({status:'bounced'}),/bounce/);
 assert.match(approvalSteps({status:'queued',providerId:'synthetic-receipt'}),/Provider accepted/);
 assert.equal(outreachStatus({status:'sent',providerId:'human-attested'}),'Human-reported sent');
});
