import test from 'node:test';import assert from 'node:assert/strict';
import {mentorFixture} from '../test-support/mentor-fixture.js';
import {createManualDonor,recordManualGift} from '../lib/manual-entry.js';
import {calculateRetention,parseFilters} from '../lib/reporting.js';
const person=(name,email)=>({display_name:name,normalized_email:email});
const gift=(donor,extra={})=>({donor_id:donor.id,amount:'25.00',donation_date:'2026-11-14',source:'cash',currency:'USD',status:'completed',...extra});
test('manual donors, cash/check gifts, retries, review and assignment preserve the ledger',async t=>{
 const {db,admin,board,tx}=await mentorFixture();let donor,a,b;
 try{
  await t.test('minimal creation handles empty roster, optional contacts and linked notes',async()=>{
   donor=await tx(q=>createManualDonor(q,{...person('Synthetic minimal'),notes:'Synthetic relationship note',idempotency_key:'donor-request-001'},admin));
   assert.equal(donor.donor_type,'person');assert.equal(donor.normalized_email,null);assert.equal(donor.assigned_board_member_id,null);assert.ok(donor.note_activity_id);
   const replay=await tx(q=>createManualDonor(q,{...person('Synthetic minimal'),notes:'Synthetic relationship note',idempotency_key:'donor-request-001'},admin));assert.equal(replay.id,donor.id);assert.equal(replay.replayed,true);
   await assert.rejects(tx(q=>createManualDonor(q,{display_name:'Different input',idempotency_key:'donor-request-001'},admin)),{code:'IDEMPOTENCY_CONFLICT'});
   await assert.rejects(tx(q=>createManualDonor(q,person('Synthetic minimal'),admin)),{code:'DUPLICATE_DONOR'});
   const distinct=await tx(q=>createManualDonor(q,{...person('Synthetic minimal'),allow_duplicate:true,duplicate_reason:'Synthetic independent identity confirmation'},admin));assert.notEqual(distinct.id,donor.id);
   const archivedInput={display_name:'Synthetic archived record',archived:true,idempotency_key:'archived-request-001'};
   const archived=await tx(q=>createManualDonor(q,archivedInput,admin));assert.equal((await tx(q=>createManualDonor(q,archivedInput,admin))).id,archived.id);
  });
  await t.test('one and multiple eligible owners balance workloads; owner selection requires genuine active members',async()=>{
   a=await board('board-a');const one=await tx(q=>createManualDonor(q,person('Synthetic one','one@example.test'),admin));assert.equal(one.assigned_board_member_id,a.id);
   b=await board('board-b');for(let i=0;i<7;i++)await tx(q=>createManualDonor(q,person(`Synthetic balanced ${i}`,`balanced-${i}@example.test`),admin));
   const counts=(await db.query('SELECT assigned_board_member_id,count(*)::int AS n FROM donors WHERE assigned_board_member_id IS NOT NULL GROUP BY assigned_board_member_id')).rows;assert.equal(counts.length,2);assert.ok(Math.abs(counts[0].n-counts[1].n)<=1);
   const selected=await tx(q=>createManualDonor(q,{...person('Synthetic selected','selected@example.test'),owner_id:b.id},admin));assert.equal(selected.assigned_board_member_id,b.id);
   const before=(await db.query('SELECT count(*)::int AS n FROM donors')).rows[0].n;
   await assert.rejects(tx(q=>createManualDonor(q,{display_name:'Synthetic invalid owner',owner_id:admin.id},admin)),{code:'INVALID_ASSIGNEE'});assert.equal((await db.query('SELECT count(*)::int AS n FROM donors')).rows[0].n,before);
  });
  await t.test('parallel retries create one cash gift and one note/draft; missing references require duplicate review',async()=>{
   const input=gift(donor,{idempotency_key:'cash-request-001',notes:'Synthetic cash received at event'});
   const results=await Promise.all([tx(q=>recordManualGift(q,input,admin)),tx(q=>recordManualGift(q,input,admin))]);assert.equal(results[0].donation.id,results[1].donation.id);assert.equal(results.filter(r=>!r.duplicate).length,1);
   assert.equal((await db.query('SELECT count(*)::int AS n FROM outreach_messages WHERE donation_id=$1',[results[0].donation.id])).rows[0].n,1);
   assert.equal((await db.query('SELECT count(*)::int AS n FROM activities WHERE id=$1',[results[0].note_activity_id])).rows[0].n,1);
   await assert.rejects(tx(q=>recordManualGift(q,{...input,amount:'26'},admin)),{code:'IDEMPOTENCY_CONFLICT'});
   await assert.rejects(tx(q=>recordManualGift(q,gift(donor),admin)),{code:'POSSIBLE_DUPLICATE_GIFT'});
   await tx(q=>recordManualGift(q,gift(donor,{allow_duplicate:true,duplicate_reason:'Synthetic separate envelope confirmed'}),admin));
  });
  await t.test('check reference retries retain the gift and notes; unknown payment stays outside verified totals',async()=>{
   const check=gift(donor,{source:'check',external_transaction_id:'SYNTHETIC-CHECK-001',amount:'75',notes:'Synthetic check verified'});
   const first=await tx(q=>recordManualGift(q,check,admin)),again=await tx(q=>recordManualGift(q,check,admin));assert.equal(first.donation.id,again.donation.id);assert.equal(again.duplicate,true);assert.equal(first.note_activity_id,again.note_activity_id);
   await assert.rejects(tx(q=>recordManualGift(q,{...check,amount:'76'},admin)),{code:'TRANSACTION_CONFLICT'});
   await tx(q=>recordManualGift(q,gift(donor,{source:'offline',amount:'99',currency:null,status:null,idempotency_key:'unknown-gift-001'}),admin));
   const rows=(await db.query('SELECT donor_id,donated_at::text,amount_cents::text,program,board_member_id FROM reporting_gifts')).rows;const report=calculateRetention(rows,parseFilters({from:'2026-01-01',to:'2026-12-31'}));assert.equal(report.giftTotal,125);assert.equal(report.giftCount,3);
   await assert.rejects(tx(q=>recordManualGift(q,{...gift(donor),card_number:'not-accepted'},admin)),{code:'VALIDATION_ERROR'});
  });
  await t.test('service authorization and board ownership cannot be forged',async()=>{
   await assert.rejects(tx(q=>createManualDonor(q,{display_name:'Synthetic denied'},a)),{code:'FORBIDDEN'});
   await assert.rejects(tx(q=>recordManualGift(q,gift(donor,{idempotency_key:'denied-gift-001'}),a)),{code:'FORBIDDEN'});
  });
 }finally{await db.close();}
});

test('spreadsheet assignment handles zero, one and multiple eligible members with ownership review intact',async()=>{
 const {db,admin,board,tx}=await mentorFixture();
 try{
  const {previewImport,confirmImport}=await import('../lib/import-data.js');
  async function run(prefix,count,contact=''){
   const csv=['Name,Email,Amount,Date,Currency,Status,Transaction ID,Board member',...Array.from({length:count},(_,i)=>`Synthetic ${prefix} ${i},${prefix}-${i}@example.test,5,2026-11-14,USD,completed,${prefix}-${i},${contact}`)].join('\n');
   const preview=await tx(q=>previewImport(q,{filename:'synthetic-owners.csv',source:'synthetic-owners',content_base64:Buffer.from(csv).toString('base64')},admin));
   return {preview,confirm:decisions=>tx(q=>confirmImport(q,{batch_id:preview.batch_id,decisions},admin))};
  }
  const zero=await run('zero',2);await zero.confirm();assert.equal((await db.query('SELECT count(*)::int AS n FROM donors WHERE assigned_board_member_id IS NULL')).rows[0].n,2);
  const a=await board('import-a');const one=await run('one',2);const result=await one.confirm();for(const row of result.rows)assert.equal((await db.query('SELECT assigned_board_member_id FROM donors WHERE id=$1',[row.donor_id])).rows[0].assigned_board_member_id,a.id);
  await board('import-b');const multiple=await run('many',8);await multiple.confirm();const counts=(await db.query('SELECT assigned_board_member_id,count(*)::int AS n FROM donors WHERE assigned_board_member_id IS NOT NULL GROUP BY assigned_board_member_id')).rows;assert.equal(counts.length,2);assert.ok(Math.abs(counts[0].n-counts[1].n)<=1);
  const reviewed=await run('reviewed',1,'Synthetic unknown owner');await assert.rejects(reviewed.confirm(),{code:'OWNERSHIP_REVIEW_REQUIRED'});await reviewed.confirm({2:{use_balanced_assignment:true}});
 }finally{await db.close();}
});
