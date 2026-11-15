import test from 'node:test';import assert from 'node:assert/strict';
import {mentorFixture} from '../test-support/mentor-fixture.js';
import {createDonor,addDonation} from '../lib/donor-data.js';
import {previewMerge,confirmMerge,confirmAlias} from '../lib/merge-review.js';
import {matchDonor,mergeCandidates,mergedEventKey} from '../lib/matching.js';
import {previewImport,confirmImport} from '../lib/import-data.js';
import {saveActivity,saveTask} from '../lib/assignment.js';
import {approveDraft,handoffDraft} from '../lib/outreach.js';
import {recordOutcome} from '../lib/evidence-data.js';
import {calculateRetention,parseFilters} from '../lib/reporting.js';
const upload=()=>({filename:'synthetic-merge.csv',source:'synthetic',content_base64:Buffer.from('Name,Email,Amount,Date,Currency,Status,Transaction ID,Donor ID\nSynthetic Alias,alias@example.test,25,2026-06-15,USD,completed,MERGE-001,ALIAS-001').toString('base64')});
const confirmed=(input,preview)=>({...input,preview_id:preview.preview_id,confirmed:true,identity_confirmed:true});
test('guarded merge preserves all relationships, audit attribution, imports, reports and human approval',async t=>{
 const {db,store,admin,board,tx}=await mentorFixture();let main,source,input,preview,batch,gift,activity,task,draft;
 try{
  await board('merge-board');
  main=await tx(q=>createDonor(q,{donor_type:'person',display_name:'Synthetic Canonical',normalized_email:'canonical@example.test',email_consent:true},admin.id));
  source=await tx(q=>createDonor(q,{donor_type:'person',display_name:'Synthetic Alias',normalized_email:'alias@example.test',email_consent:true},admin.id));
  input={canonical_donor_id:main.id,merged_donor_id:source.id,reason:'Synthetic independent identity confirmation from original records'};
  batch=await tx(q=>previewImport(q,upload(),admin));await tx(q=>confirmImport(q,{batch_id:batch.batch_id},admin));
  gift=(await db.query("SELECT * FROM donations WHERE external_transaction_id='MERGE-001'")).rows[0];
  await tx(q=>addDonation(q,{donor_id:main.id,amount:'75',donation_date:'2026-10-20',source:'synthetic',external_transaction_id:'MERGE-002',currency:'USD',status:'completed'}));
  activity=await saveActivity(store,admin,{donorId:source.id,type:'note',content:'Synthetic original note'},new Date());
  await saveActivity(store,admin,{id:activity.id,type:'note',content:'Synthetic revised note'},new Date(),true);
  task=await saveTask(store,admin,{donorId:source.id,assigneeId:admin.id,nextAction:'Synthetic retained follow-up',dueAt:'2026-11-20'},new Date());
  draft=(await db.query('SELECT * FROM outreach_messages WHERE donation_id=$1',[gift.id])).rows[0];
  await approveDraft(store,admin,{id:draft.id,revision:draft.revision},new Date());await handoffDraft(store,admin,{id:draft.id,revision:draft.revision},new Date());
  await tx(q=>recordOutcome(q,{donor_id:source.id,description:'Synthetic evidence-backed outcome',evidence_reference:'https://example.test/evidence',verified_at:'2026-10-01',period_start:'2026-01-01',period_end:'2026-10-01'},admin));
  await t.test('preview compares identity and records, requires actor-bound explicit identity confirmation',async()=>{
   preview=await tx(q=>previewMerge(q,input,admin));assert.equal(preview.canonical.normalized_email,'canonical@example.test');assert.equal(preview.source.normalized_email,'alias@example.test');assert.equal(preview.affected.donations,1);assert.equal(preview.affected.outreach_messages,1);assert.equal(preview.affected.outreach_delivery_history,1);assert.deepEqual(preview.blockers,[]);
   await assert.rejects(tx(q=>confirmMerge(q,{...input,preview_id:preview.preview_id},admin)),{code:'MERGE_CONFIRMATION_REQUIRED'});
   await assert.rejects(tx(q=>confirmMerge(q,confirmed({...input,canonical_donor_id:source.id,merged_donor_id:main.id},preview),admin)),{code:'INVALID_MERGE_PREVIEW'});
  });
  await t.test('a changed relationship invalidates the preview before any data moves',async()=>{
   await saveActivity(store,admin,{donorId:source.id,type:'call',content:'Synthetic concurrent relationship update'},new Date());
   await assert.rejects(tx(q=>confirmMerge(q,confirmed(input,preview),admin)),{code:'STALE_MERGE_PREVIEW'});
   assert.equal((await db.query('SELECT donor_id FROM donations WHERE id=$1',[gift.id])).rows[0].donor_id,source.id);
   await db.query('UPDATE outreach_messages SET outcome_unknown=true WHERE id=$1',[draft.id]);
   const unsafe=await tx(q=>previewMerge(q,input,admin));assert.equal(unsafe.blockers[0].code,'MERGE_OUTREACH_IN_FLIGHT');await assert.rejects(tx(q=>confirmMerge(q,confirmed(input,unsafe),admin)),{code:'MERGE_OUTREACH_IN_FLIGHT'});
   await db.query('UPDATE outreach_messages SET outcome_unknown=false WHERE id=$1',[draft.id]);
   preview=await tx(q=>previewMerge(q,input,admin));
  });
  await t.test('transaction interruption rolls back movements and leaves the preview unused',async()=>{
   await assert.rejects(tx(q=>confirmMerge(async(sql,args)=>{if(sql.startsWith('UPDATE donor_aliases'))throw new Error('Synthetic interrupted merge');return q(sql,args);},confirmed(input,preview),admin)),/Synthetic interrupted merge/);
   assert.equal((await db.query('SELECT donor_id FROM donations WHERE id=$1',[gift.id])).rows[0].donor_id,source.id);
   assert.equal((await db.query('SELECT status FROM outreach_messages WHERE id=$1',[draft.id])).rows[0].status,'handed_off');
  });
  await t.test('concurrent confirmation has one winner, preserves gifts and forces renewed approval',async()=>{
   const outcomes=await Promise.allSettled([tx(q=>confirmMerge(q,confirmed(input,preview),admin)),tx(q=>confirmMerge(q,confirmed(input,preview),admin))]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(outcomes.find(x=>x.status==='rejected').reason.code,'MERGE_PREVIEW_CONSUMED');
   const result=outcomes.find(x=>x.status==='fulfilled').value;assert.equal(result.donations_moved,1);assert.equal(result.outcomes_moved,1);assert.equal(result.drafts_requiring_review,1);
   for(const [table,id] of [['activities',activity.id],['tasks',task.id],['outreach_messages',draft.id],['donations',gift.id]])assert.equal((await db.query(`SELECT donor_id FROM ${table} WHERE id=$1`,[id])).rows[0].donor_id,main.id);
   const moved=(await db.query('SELECT * FROM donations WHERE id=$1',[gift.id])).rows[0];assert.equal(moved.amount,gift.amount);assert.equal(moved.external_transaction_id,gift.external_transaction_id);
   assert.equal((await db.query('SELECT donor_id FROM import_rows WHERE donation_id=$1',[gift.id])).rows[0].donor_id,main.id);
   assert.equal((await db.query('SELECT donor_id FROM activity_history WHERE activity_id=$1',[activity.id])).rows[0].donor_id,source.id);
   const message=(await db.query('SELECT * FROM outreach_messages WHERE id=$1',[draft.id])).rows[0];assert.equal(message.status,'draft');assert.equal(message.revision,draft.revision+1);assert.equal(message.approved_by,null);
   assert.equal((await db.query('SELECT count(*)::int AS n FROM outreach_approval_history WHERE message_id=$1',[draft.id])).rows[0].n,1);
   assert.equal((await db.query('SELECT count(*)::int AS n FROM outreach_delivery_history WHERE message_id=$1',[draft.id])).rows[0].n,1);
   const history=(await db.query('SELECT audit_details FROM donor_merge_history WHERE id=$1',[result.history_id])).rows[0].audit_details;assert.equal(history.original_donor.id,source.id);assert.equal(history.original_outreach[0].donor_id,source.id);
   const rows=(await db.query('SELECT donor_id,donated_at::text,amount_cents::text,program,board_member_id FROM reporting_gifts')).rows;const report=calculateRetention(rows,parseFilters({from:'2026-01-01',to:'2026-12-31'}));assert.equal(report.giftTotal,100);assert.equal(report.giftCount,2);assert.equal(report.donorTotal,1);
  });
  await t.test('reimport and confirmed source aliases resolve to the canonical donor without new gifts',async()=>{
   const again=await tx(q=>previewImport(q,upload(),admin));assert.equal(again.rows[0].matching.reason,'existing_transaction');const result=await tx(q=>confirmImport(q,{batch_id:again.batch_id},admin));assert.equal(result.rows[0].result,'duplicate');assert.equal(result.rows[0].donor_id,main.id);
   await tx(q=>confirmAlias(q,main.id,{source:'benevity',source_identifier:'SYNTHETIC-ALIAS',original_name:'Synthetic alternative organization',reason:'Synthetic source identity independently confirmed',confirmed:true},admin));
   assert.equal((await tx(q=>matchDonor(q,{donor_type:'person',display_name:'A different export name',normalized_email:'other@example.test'},'benevity','SYNTHETIC-ALIAS'))).match,main.id);
   await assert.rejects(tx(q=>confirmAlias(q,source.id,{source:'benevity',source_identifier:'SYNTHETIC-ALIAS',original_name:'Invalid',reason:'Synthetic verified reason',confirmed:true},admin)));
   const aliased={filename:'synthetic-alias.csv',source:'benevity',content_base64:Buffer.from('Name,Email,Amount,Date,Currency,Status,Transaction ID,Donor ID\nDifferent export name,different@example.test,10,2026-11-14,USD,completed,ALIAS-GIFT-001,SYNTHETIC-ALIAS').toString('base64')};
   for(let repeat=0;repeat<2;repeat++){const p=await tx(q=>previewImport(q,aliased,admin));const imported=await tx(q=>confirmImport(q,{batch_id:p.batch_id},admin));assert.equal(imported.rows[0].donor_id,main.id);assert.equal(imported.rows[0].result,repeat?'duplicate':'imported');}
   assert.equal((await db.query('SELECT count(*)::int AS n FROM donations')).rows[0].n,3);
  });
 }finally{await db.close();}
});
test('unsafe ambiguity, in-flight delivery, expired previews and unauthorized actors fail closed',async()=>{
 const {db,admin,board,tx}=await mentorFixture();
 try{
  const member=await board('restricted');
  const a=await tx(q=>createDonor(q,{donor_type:'person',display_name:'Same synthetic name',normalized_email:'a@example.test'},admin.id)),b=await tx(q=>createDonor(q,{donor_type:'person',display_name:'Same synthetic name',normalized_email:'b@example.test'},admin.id));
  const input={canonical_donor_id:a.id,merged_donor_id:b.id,reason:'Synthetic evidence review'};
  assert.equal((await tx(q=>mergeCandidates(q,{q:'a@example.test'})))[0].reason,'name_only_not_identity_proof');
  await assert.rejects(tx(q=>previewMerge(q,input,member)),{code:'FORBIDDEN'});
  const expired=await tx(q=>previewMerge(q,input,admin,new Date('2000-01-01')));await assert.rejects(tx(q=>confirmMerge(q,confirmed(input,expired),admin)),{code:'STALE_MERGE_PREVIEW'});
  for(const donor of [a,b])await tx(q=>addDonation(q,{donor_id:donor.id,amount:'20',donation_date:'2026-11-14',source:'cash',currency:'USD',status:'completed'}));
  const blocked=await tx(q=>previewMerge(q,input,admin));assert.equal(blocked.blockers[0].code,'MERGE_AMBIGUOUS_GIFTS');await assert.rejects(tx(q=>confirmMerge(q,confirmed(input,blocked),admin)),{code:'MERGE_AMBIGUOUS_GIFTS'});
  assert.equal((await db.query('SELECT count(*)::int AS n FROM donors WHERE archived_at IS NULL')).rows[0].n,2);
 }finally{await db.close();}
});

test('scheduled-work collisions block merges; distinct keys follow the canonical donor',async()=>{
 const {db,store,admin,tx}=await mentorFixture();
 try{
  const main=await tx(q=>createDonor(q,{donor_type:'person',display_name:'Synthetic Scheduled Canonical'},admin.id));
  const source=await tx(q=>createDonor(q,{donor_type:'person',display_name:'Synthetic Scheduled Alias'},admin.id));
  const input={canonical_donor_id:main.id,merged_donor_id:source.id,reason:'Synthetic independent source verification'};
  const mainTask=await saveTask(store,admin,{donorId:main.id,assigneeId:admin.id,nextAction:'Synthetic quarterly review',dueAt:'2026-11-20'},new Date());
  const sourceTask=await saveTask(store,admin,{donorId:source.id,assigneeId:admin.id,nextAction:'Synthetic duplicate quarterly review',dueAt:'2026-11-20'},new Date());
  await db.query('UPDATE tasks SET event_key=$2 WHERE id=$1',[mainTask.id,`donor-quarterly:2026-Q4:${main.id}`]);
  await db.query('UPDATE tasks SET event_key=$2 WHERE id=$1',[sourceTask.id,`donor-quarterly:2026-Q4:${source.id}`]);
  const blocked=await tx(q=>previewMerge(q,input,admin));assert.equal(blocked.blockers[0].code,'MERGE_EVENT_CONFLICT');
  await assert.rejects(tx(q=>confirmMerge(q,confirmed(input,blocked),admin)),{code:'MERGE_EVENT_CONFLICT'});
  assert.equal((await db.query('SELECT donor_id FROM tasks WHERE id=$1',[sourceTask.id])).rows[0].donor_id,source.id);
  // Synthetic reviewed work belongs to a different quarter; no row is discarded.
  await db.query('UPDATE tasks SET event_key=$2 WHERE id=$1',[sourceTask.id,`donor-quarterly:2026-Q3:${source.id}`]);
  const preview=await tx(q=>previewMerge(q,input,admin));await tx(q=>confirmMerge(q,confirmed(input,preview),admin));
  const moved=(await db.query('SELECT donor_id,event_key FROM tasks WHERE id=$1',[sourceTask.id])).rows[0];
  assert.equal(moved.donor_id,main.id);assert.equal(moved.event_key,`donor-quarterly:2026-Q3:${main.id}`);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM tasks')).rows[0].n,2);
  for(const key of [`lapse:${source.id}:gift`,`cycle-lapse:2026:${source.id}:gift`,`donor-quarterly:2026-Q4:${source.id}`])assert.equal(mergedEventKey(key,main.id,source.id),key.replace(source.id,main.id));
 }finally{await db.close();}
});
