import test from 'node:test';
import assert from 'node:assert/strict';
import {mentorFixture} from '../test-support/mentor-fixture.js';
import {createManualDonor} from '../lib/manual-entry.js';

test('optional initial gifts are atomic, permission checked, reported and retry safe',async t=>{
 const {db,admin,tx,session,call}=await mentorFixture();
 const input={display_name:'Synthetic Initial Gift',idempotency_key:'initial-donor-request-001',initial_donation:{amount:'42.50',currency:'USD',status:'completed',donation_date:'2026-11-15',source:'check',notes:'Synthetic check received'}};
 try{
  await t.test('donor and cash/check gift share a transaction and durable retry receipt',async()=>{
   const [first,retry]=await Promise.all([tx(q=>createManualDonor(q,input,admin)),tx(q=>createManualDonor(q,input,admin))]);
   assert.equal(first.id,retry.id);assert.equal(first.initial_donation.id,retry.initial_donation.id);assert.equal(retry.replayed,true);
   assert.equal((await db.query('SELECT count(*)::int AS n FROM donations')).rows[0].n,1);
   const gift=(await db.query('SELECT * FROM reporting_gifts')).rows[0];assert.equal(String(gift.amount_cents),'4250');assert.equal(gift.donor_id,first.id);
   assert.equal((await db.query('SELECT count(*)::int AS n FROM outreach_messages WHERE donation_id=$1',[first.initial_donation.id])).rows[0].n,1);
   assert.equal((await db.query('SELECT count(*)::int AS n FROM activities WHERE donor_id=$1',[first.id])).rows[0].n,1);
   await assert.rejects(tx(q=>createManualDonor(q,{...input,initial_donation:{...input.initial_donation,amount:'43'}},admin)),{code:'IDEMPOTENCY_CONFLICT'});
  });
  await t.test('a failed gift rolls back the new donor; invalid nested fields and missing retry key fail',async()=>{
   const count=async()=> (await db.query('SELECT count(*)::int AS n FROM donors')).rows[0].n,before=await count();
   await assert.rejects(tx(q=>createManualDonor(q,{...input,display_name:'Synthetic rollback',idempotency_key:'rollback-donor-001',initial_donation:{...input.initial_donation,campaign_id:'50000000-0000-4000-8000-000000000099'}},admin)));
   assert.equal(await count(),before);
   await assert.rejects(tx(q=>createManualDonor(q,{...input,idempotency_key:undefined},admin)),{code:'VALIDATION_ERROR'});
   await assert.rejects(tx(q=>createManualDonor(q,{...input,initial_donation:{...input.initial_donation,donor_id:admin.id}},admin)),{code:'VALIDATION_ERROR'});
  });
  await t.test('real MFA/CSRF route accepts optional initial gift and donor-only creation',async()=>{
   const auth=await session(admin);
   const created=await call('donors','POST',{...input,display_name:'Synthetic HTTP cash',idempotency_key:'http-initial-001',initial_donation:{...input.initial_donation,source:'cash'}},auth);assert.equal(created.statusCode,201);assert.equal(created.body.data.initial_donation.source,'cash');
   const donorOnly=await call('donors','POST',{display_name:'Synthetic without gift',idempotency_key:'http-no-gift-001'},auth);assert.equal(donorOnly.statusCode,201);assert.equal(donorOnly.body.data.initial_donation,null);
  });
  await t.test('donor-edit permission cannot grant gift-write permission',async()=>{
   await db.query("DELETE FROM role_permissions WHERE role_id='administrator' AND permission_name='donations.write'");
   await assert.rejects(tx(q=>createManualDonor(q,{...input,display_name:'Synthetic forbidden',idempotency_key:'forbidden-initial-001'},admin)),{code:'FORBIDDEN'});
  });
 }finally{await db.close();}
});
