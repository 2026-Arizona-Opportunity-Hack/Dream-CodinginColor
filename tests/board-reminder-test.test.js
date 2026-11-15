import test from 'node:test';
import assert from 'node:assert/strict';
import {mentorFixture} from '../test-support/mentor-fixture.js';
import {createEmailProvider} from '../lib/email-provider.js';
import {sendBoardReminderTest,boardReminderTestHistory} from '../lib/board-reminder-test.js';
const inbox='verified-inbox@synthetic-cic-mail.org';
const env={EMAIL_DELIVERY_MODE:'test',RESEND_API_KEY:'synthetic-injected-key',EMAIL_FROM:'sender@synthetic-cic-mail.org',EMAIL_TEST_INBOXES:inbox,APP_ORIGIN:'https://colorloop.vercel.app',VERCEL:'1'};
const now=new Date('2026-11-17T06:59:00Z');
const input={recipient:inbox,confirmed:true,idempotencyKey:'synthetic-one-time-request'};
function mail(response=()=>Response.json({id:'synthetic-test-receipt'})){
 const posts=[];return {posts,provider:createEmailProvider({env,fetcher:async(url,options)=>{posts.push(JSON.parse(options.body));return response();}})};
}
test('admin test explicitly addresses only an allowlisted inbox, labels TEST, logs results and deduplicates without donor/task records',async()=>{
 const f=await mentorFixture(),m=mail();
 try{
  const before=(await f.db.query('SELECT id,email,totp_enabled,totp_secret_ciphertext FROM users ORDER BY id')).rows;
  const results=await Promise.all([sendBoardReminderTest(f.store,f.admin,input,now,{env,provider:m.provider}),sendBoardReminderTest(f.store,f.admin,input,now,{env,provider:m.provider})]);
  assert.equal(m.posts.length,1);assert.deepEqual(m.posts[0].to,[inbox]);assert.match(m.posts[0].subject,/^\[TEST\]/);assert.match(m.posts[0].text,/no real donor or follow-up/);
  assert.match(m.posts[0].text,/Deadline: 2026-11-16 \(America\/Phoenix\)/);assert.match(m.posts[0].text,/https:\/\/colorloop.vercel.app\/#tasks/);
  assert.ok(results.some(r=>r.status==='queued'));assert.ok(results.some(r=>r.alreadyAttempted));
  await sendBoardReminderTest(f.store,f.admin,input,now,{env,provider:m.provider});assert.equal(m.posts.length,1);
  const history=await boardReminderTestHistory(f.store,f.admin);assert.equal(history.length,1);assert.equal(history[0].status,'queued');assert.equal(history[0].providerId,'synthetic-test-receipt');
  for(const table of ['donors','donations','tasks','outreach_messages'])assert.equal((await f.db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n,0);
  assert.deepEqual((await f.db.query('SELECT id,email,totp_enabled,totp_secret_ciphertext FROM users ORDER BY id')).rows,before);
  assert.equal((await f.db.query('SELECT email_policy FROM retention_settings')).rows[0].email_policy.donorEnabled,undefined);
  assert.deepEqual((await f.db.query("SELECT action FROM audit_events WHERE action LIKE 'email.board-test.%' ORDER BY action")).rows.map(r=>r.action),['email.board-test.attempt','email.board-test.result']);
 }finally{await f.db.close();}
});
test('one-time tests enforce explicit approval, test mode, allowlist, invalid-address checks, administrator authority and rate limits',async()=>{
 const f=await mentorFixture(),m=mail();
 try{
  const send=(values=input,options={})=>sendBoardReminderTest(f.store,f.admin,values,now,{env,provider:m.provider,...options});
  await assert.rejects(send({...input,confirmed:false}),{code:'INVALID_INPUT'});
  for(const mode of ['disabled','live'])await assert.rejects(send(input,{env:{...env,EMAIL_DELIVERY_MODE:mode}}),{code:'EMAIL_TEST_MODE_REQUIRED'});
  await assert.rejects(send({...input,recipient:'shorya@synthetic-cic-mail.org'}),{code:'EMAIL_TEST_INBOX_REQUIRED'});
  await assert.rejects(send({...input,recipient:'invalid email'}),{code:'EMAIL_RECIPIENT_BLOCKED'});
  const board=await f.board('test-restriction');await assert.rejects(sendBoardReminderTest(f.store,board,input,now,{env,provider:m.provider}),{code:'FORBIDDEN'});
  assert.equal(m.posts.length,0);
  for(let i=0;i<3;i++)await send({...input,idempotencyKey:`synthetic-one-time-${i}`});
  await assert.rejects(send({...input,idempotencyKey:'synthetic-one-time-extra'}),{code:'EMAIL_TEST_RATE_LIMITED'});assert.equal(m.posts.length,3);
 }finally{await f.db.close();}
});
test('uncertain and rejected test sends are safely recorded and never automatically retried',async()=>{
 for(const unknown of [true,false]){
  const f=await mentorFixture(),m=mail(()=>{if(unknown)throw new Error('private provider details must never escape');return Response.json({message:'private rejection details'},{status:403});});
  try{
   const result=await sendBoardReminderTest(f.store,f.admin,input,now,{env,provider:m.provider});assert.equal(result.status,'failed');assert.equal(result.outcomeUnknown,unknown);
   await sendBoardReminderTest(f.store,f.admin,input,now,{env,provider:m.provider});assert.equal(m.posts.length,1);
   assert.doesNotMatch(JSON.stringify(await boardReminderTestHistory(f.store,f.admin)),/private provider|private rejection/);
  }finally{await f.db.close();}
 }
});
test('test-reminder APIs preserve MFA, administrator permissions and CSRF',async()=>{
 const f=await mentorFixture();
 try{
  assert.equal((await f.call('email/test-reminder')).statusCode,401);
  const board=await f.board('api-restriction'),boardAuth=await f.session(board);
  assert.equal((await f.call('email/test-reminder','GET',{},boardAuth)).statusCode,403);
  const auth=await f.session(f.admin);
  assert.equal((await f.call('email/test-reminder','GET',{},auth)).statusCode,200);
  assert.equal((await f.call('email/test-reminder','POST',input,auth,{'x-csrf-token':'forged'})).statusCode,403);
 }finally{await f.db.close();}
});
