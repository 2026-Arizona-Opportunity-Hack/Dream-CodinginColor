import test from 'node:test';
import assert from 'node:assert/strict';
import {mentorFixture} from '../test-support/mentor-fixture.js';
import {createManualDonor} from '../lib/manual-entry.js';
import {createEmailProvider} from '../lib/email-provider.js';
import {request} from './retention-support.js';
const inbox=process.env.EMAIL_TEST_INBOXES?.split(',')[0]?.trim()||'verified-inbox@synthetic-cic-mail.org';
const env={EMAIL_DELIVERY_MODE:'test',EMAIL_CRON_ENABLED:'false',RESEND_API_KEY:'synthetic-injected-key',EMAIL_FROM:'sender@synthetic-cic-mail.org',EMAIL_TEST_INBOXES:inbox,CIC_DONOR_AUTOMATION_APPROVED:'false'};
async function fixture(){
 const f=await mentorFixture(),auth=await f.session(f.admin),now=new Date(),posts=[];let event='queued';
 const provider=createEmailProvider({env,fetcher:async(url,options)=>{
  if(options.method==='POST'){posts.push(JSON.parse(options.body));return Response.json({id:'synthetic-direct-receipt'});}
  return Response.json({id:'synthetic-direct-receipt',last_event:event});
 }});
 const call=(route,input={},session=auth,extra={})=>request(f.store,route,'POST',input,session,{...extra,options:{env,provider,now:()=>now,...extra.options}});
 const donor=await f.tx(q=>createManualDonor(q,{display_name:'Synthetic direct-mail donor',normalized_email:inbox,email_consent:true},f.admin));
 const draft=(await call('outreach/drafts',{donorId:donor.id,templateId:'follow-up'})).body.data;
 return {...f,auth,now,posts,call,donor,draft,input:{id:draft.id,revision:draft.revision},delivered:()=>{event='delivered';}};
}
test('genuine API approval to direct Resend send uses the donor inbox and exact revision while automation remains OFF',async()=>{
 const f=await fixture();
 try{
  assert.equal((await f.call('outreach/send',f.input)).statusCode,409);
  assert.equal((await f.call('outreach/approve',f.input)).statusCode,200);
  assert.equal((await f.call('outreach/approve',f.input)).statusCode,200,'same-revision approval retry is idempotent');
  assert.equal((await f.call('outreach/approve',{...f.input,revision:2})).statusCode,409,'stale/wrong revisions remain conflicts');
  const results=await Promise.all([f.call('outreach/send',f.input),f.call('outreach/send',f.input)]);assert.ok(results.some(r=>r.statusCode===200));
  assert.equal((await f.call('outreach/send',f.input)).body.data.status,'queued');assert.equal(f.posts.length,1);
  assert.deepEqual(f.posts[0].to,[inbox]);assert.equal(f.posts[0].subject,f.draft.subject);assert.equal(f.posts[0].text,f.draft.body);
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM outreach_approval_history')).rows[0].n,1);
  const history=await f.store.read(s=>s.sendHistory);assert.equal(history.length,2);assert.ok(history.some(h=>h.recipient===inbox));
  assert.equal((await f.call('outreach/status',f.input)).body.data.draft.status,'queued');
  f.delivered();assert.equal((await f.call('outreach/status',f.input)).body.data.draft.status,'delivered');assert.equal(f.posts.length,1);
  const policy=(await f.db.query('SELECT email_policy FROM retention_settings')).rows[0].email_policy;assert.ok(!policy.donorEnabled&&!policy.boardEnabled);
 }finally{await f.db.close();}
});
test('manual donor sends preserve consent, allowlist, CIC, RBAC and CSRF restrictions',async()=>{
 const f=await fixture();
 try{
  await f.call('outreach/approve',f.input);
  await f.db.query('UPDATE donors SET email_consent=false WHERE id=$1',[f.donor.id]);assert.equal((await f.call('outreach/send',f.input)).body.error.code,'CONTACT_NOT_ALLOWED');
  await f.db.query('UPDATE donors SET email_consent=true,opted_out=true WHERE id=$1',[f.donor.id]);assert.equal((await f.call('outreach/send',f.input)).body.error.code,'CONTACT_NOT_ALLOWED');
  await f.db.query('UPDATE donors SET opted_out=false,normalized_email=$2 WHERE id=$1',[f.donor.id,'not-allowlisted@synthetic-cic-mail.org']);assert.equal((await f.call('outreach/send',f.input)).body.error.code,'EMAIL_TEST_INBOX_REQUIRED');
  await f.db.query('UPDATE donors SET normalized_email=$2 WHERE id=$1',[f.donor.id,inbox]);
  assert.equal((await f.call('outreach/send',f.input,f.auth,{options:{env:{...env,EMAIL_DELIVERY_MODE:'live',NODE_ENV:'production'}}})).body.error.code,'CIC_APPROVAL_REQUIRED');
  assert.equal((await f.call('outreach/send',f.input,undefined,{headers:{'x-csrf-token':'forged'}})).statusCode,403);
  assert.equal((await f.call('outreach/send',f.input,null)).statusCode,401);
  const board=await f.board('no-send'),session=await f.session(board);assert.equal((await f.call('outreach/send',f.input,session)).statusCode,403);
  assert.equal(f.posts.length,0);
 }finally{await f.db.close();}
});
test('edited approved drafts still require fresh revision approval',async()=>{
 const f=await fixture();
 try{
  await f.call('outreach/approve',f.input);
  const edit=await f.call('outreach/drafts',{...f.input,body:'A changed exact message'});assert.equal(edit.statusCode,400,'POST cannot impersonate an edit');
  const {saveDraft}=await import('../lib/outreach.js');await saveDraft(f.store,f.admin,{...f.input,body:'A changed exact message'},f.now,true);
  assert.equal((await f.call('outreach/approve',f.input)).body.error.code,'REVISION_CONFLICT');
  assert.equal((await f.call('outreach/send',{...f.input,revision:2})).body.error.code,'APPROVAL_REQUIRED');assert.equal(f.posts.length,0);
 }finally{await f.db.close();}
});
