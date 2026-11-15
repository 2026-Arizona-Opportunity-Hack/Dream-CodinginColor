import test from 'node:test';
import assert from 'node:assert/strict';
import {mentorFixture} from '../test-support/mentor-fixture.js';
import {createManualDonor} from '../lib/manual-entry.js';
import {editDonor} from '../lib/donor-data.js';
import {assignDonor} from '../lib/assignment.js';
import {recognizedOwners} from '../public/js/import-review.js';
import {previewImport,confirmImport} from '../lib/import-data.js';

test('least-loaded ties rotate durably across SQL and state-based writers',async()=>{
 const {db,admin,board,tx,store}=await mentorFixture();
 try{
  const members=[await board('rotation-a'),await board('rotation-b')].sort((a,b)=>a.id.localeCompare(b.id));
  const first=await tx(q=>createManualDonor(q,{display_name:'Synthetic rotation first'},admin));assert.equal(first.assigned_board_member_id,members[0].id);
  await tx(q=>editDonor(q,first.id,{archived:true},admin.id));
  const second=await tx(q=>createManualDonor(q,{display_name:'Synthetic rotation second'},admin));assert.equal(second.assigned_board_member_id,members[1].id,'equal loads must rotate rather than restart at the lowest UUID');
  await tx(q=>editDonor(q,second.id,{archived:true},admin.id));
  const third=(await db.query("INSERT INTO donors(donor_type,display_name) VALUES ('person','Synthetic state rotation') RETURNING id")).rows[0];
  const assigned=await assignDonor(store,{donorId:third.id},admin.id,new Date(),admin);assert.equal(assigned.assigneeId,members[0].id);
  const override=await assignDonor(store,{donorId:third.id,assigneeId:members[1].id},admin.id,new Date(),admin);assert.equal(override.assigneeId,members[1].id);
  const cursor=(await db.query("SELECT details FROM audit_events WHERE action='assignments.auto-rotate' ORDER BY (details->>'sequence')::int")).rows;assert.deepEqual(cursor.map(r=>r.details.sequence),[1,2,3]);
  await db.query("UPDATE roles SET active=false WHERE id='board-member'");
  const none=await tx(q=>createManualDonor(q,{display_name:'Synthetic no eligible role'},admin));assert.equal(none.assigned_board_member_id,null);
 }finally{await db.close();}
});
test('bulk recognition approves only unique contacts; server preserves owners and revalidates stale recognition',async()=>{
 const {db,admin,board,tx}=await mentorFixture();
 try{
  const member=await board('recognized-owner');
  const file={filename:'synthetic-owners.csv',source:'synthetic-owner-review',content_base64:Buffer.from(`Name,Contact person,Board contact\nSynthetic owned donor,Synthetic Human,${member.email}`).toString('base64')};
  const preview=await tx(q=>previewImport(q,file,admin));const recognized=recognizedOwners(preview.rows);assert.deepEqual(recognized,[{row:2,owner:member.id}]);
  assert.deepEqual(recognizedOwners([{row_number:4,data:{board_contact:'Ambiguous'},board_candidates:[{id:'a'},{id:'b'}]},{row_number:5,data:{board_contact:'Missing'},board_candidates:[]}]),[]);
  await db.query('UPDATE users SET active=false WHERE id=$1',[member.id]);
  await assert.rejects(tx(q=>confirmImport(q,{batch_id:preview.batch_id,decisions:{2:{assignee_id:recognized[0].owner}}},admin)),{code:'OWNERSHIP_CONFLICT'});
  assert.equal((await db.query('SELECT count(*)::int AS n FROM donors')).rows[0].n,0);
  await db.query('UPDATE users SET active=true WHERE id=$1',[member.id]);
  const result=await tx(q=>confirmImport(q,{batch_id:preview.batch_id,decisions:{2:{assignee_id:recognized[0].owner}}},admin));
  const donor=(await db.query('SELECT * FROM donors WHERE id=$1',[result.rows[0].donor_id])).rows[0];assert.equal(donor.assigned_board_member_id,member.id);assert.equal(donor.contact_person,'Synthetic Human');
 }finally{await db.close();}
});
