import {signIn} from './auth-support.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createIsolatedDatabase } from '../lib/isolated-database.js';
import { migrate } from '../lib/database-setup.js';
import { createSqlStore } from '../lib/retention-sql-store.js';
import { bootstrapAdministrator, saveUser, login } from '../lib/auth.js';
import { createDonor, addDonation, editDonor } from '../lib/donor-data.js';
import { previewImport, confirmImport } from '../lib/import-data.js';
import { mergeDonors } from '../lib/matching.js';
import { request, now, password } from './retention-support.js';

test('normalized SQL persists accounts, relationships, approval, consent, imports and canonical merges', async () => {
  const db = await createIsolatedDatabase();
  try {
    await db.transaction(migrate);
    const store = createSqlStore(db);
    const admin = { ...await bootstrapAdministrator(store,{name:'Synthetic admin',email:'sql-admin@example.test',password},now),administrator:true };
    const member = await saveUser(store,admin,{name:'Synthetic member',email:'sql-member@example.test',password,roleId:'board-member',boardMember:true},now);
    const session = await signIn(store,{email:admin.email,password},'test',now);
    const api = (route,method='GET',input={}) => request(store,route,method,input,session);
    const donor = await db.transaction(q=>createDonor(q,{donor_type:'person',display_name:'Synthetic donor',normalized_email:'synthetic@example.test',email_consent:true},admin.id));
    assert.equal(donor.assigned_board_member_id,member.id);
    await db.transaction(q=>addDonation(q,{donor_id:donor.id,amount:'12.34',donation_date:'2025-01-01',source:'test',currency:'USD',status:'completed'}));
    assert.equal((await api('retention/at-risk')).body.data[0].donorId,donor.id);
    const nudge = await api('retention/at-risk','POST',{donorId:donor.id});
    assert.equal(nudge.statusCode,201,JSON.stringify(nudge.body));
    const draft = nudge.body.data.draft;
    const input = {id:draft.id,revision:draft.revision};
    assert.equal((await api('outreach/send','POST',input)).statusCode,409);
    assert.equal((await api('outreach/approve','POST',input)).statusCode,200);
    assert.equal((await api('outreach/send','POST',input)).statusCode,503);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM outreach_approval_history')).rows[0].n,1);
    assert.equal((await api('outreach/drafts','PATCH',{...input,body:'Reviewed synthetic draft'})).statusCode,200);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM outreach_revisions')).rows[0].n,1);
    const activity = await api('activities','POST',{donorId:donor.id,type:'note',content:'Synthetic interaction'});
    assert.equal(activity.statusCode,201);
    assert.equal((await api('activities','PATCH',{id:activity.body.data.id,type:'note',content:'Corrected synthetic interaction'})).statusCode,200);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM activity_history')).rows[0].n,1);
    const csv='Name,Email,Amount,Date,Transaction ID,Currency,Status\nSynthetic import,import@example.test,25.10,2025-02-01,sql-import-1,USD,completed';
    const upload={filename:'synthetic.csv',source:'test',content_base64:Buffer.from(csv).toString('base64')};
    const preview=await db.transaction(q=>previewImport(q,upload,admin));
    const imported=await db.transaction(q=>confirmImport(q,{batch_id:preview.batch_id},admin));
    const importedId=imported.rows[0].donor_id;
    assert.equal((await db.query('SELECT assigned_board_member_id FROM donors WHERE id=$1',[importedId])).rows[0].assigned_board_member_id,member.id);
    assert.deepEqual(await db.transaction(q=>confirmImport(q,{batch_id:preview.batch_id},admin)),imported);
    await db.transaction(q=>editDonor(q,importedId,{opted_out:true}));
    await db.transaction(q=>mergeDonors(q,{canonical_donor_id:importedId,merged_donor_id:donor.id,reason:'Synthetic confirmed duplicate'},admin));
    assert.equal((await db.query('SELECT donor_id FROM activities WHERE id=$1',[activity.body.data.id])).rows[0].donor_id,importedId);
    assert.equal((await db.query('SELECT donor_id FROM tasks WHERE id=$1',[nudge.body.data.task.id])).rows[0].donor_id,importedId);
    assert.equal((await db.query('SELECT donor_id FROM outreach_messages WHERE id=$1',[draft.id])).rows[0].donor_id,importedId);
    const denied=await api('outreach/approve','POST',{id:draft.id,revision:2});
    assert.equal(denied.body.error.code,'CONTACT_NOT_ALLOWED');
    assert.equal((await api('retention/at-risk')).body.data.some(d=>d.donorId===donor.id),false);
    assert.equal((await api('auth/logout','POST')).statusCode,200);
    assert.equal((await api('auth/me')).statusCode,401);
  } finally { await db.close(); }
});

test('SQL claims, expiry, permissions, balanced assignment and immutable history survive independent store objects',async()=>{
  const db=await createIsolatedDatabase();
  try{
    await db.transaction(migrate);const store=createSqlStore(db),other=createSqlStore(db);
    const admin={...await bootstrapAdministrator(store,{name:'Synthetic operator',email:'claims@example.test',password},now),administrator:true};
    const a=await saveUser(store,admin,{name:'Board A',email:'a@example.test',password,roleId:'board-member',boardMember:true},now);
    const b=await saveUser(store,admin,{name:'Board B',email:'b@example.test',password,roleId:'board-member',boardMember:true},now);
    await saveUser(store,admin,{name:'Inactive',email:'inactive@example.test',password,roleId:'board-member',boardMember:true,active:false},now);
    const created=await Promise.all(Array.from({length:8},(_,i)=>db.transaction(q=>createDonor(q,{donor_type:'person',display_name:`Synthetic ${i}`,normalized_email:`claim-${i}@example.test`,email_consent:true},admin.id))));
    assert.equal(created.filter(d=>d.assigned_board_member_id===a.id).length,4);
    assert.equal(created.filter(d=>d.assigned_board_member_id===b.id).length,4);
    await db.transaction(q=>addDonation(q,{donor_id:created[0].id,amount:'10.00',donation_date:'2025-01-01',currency:'USD',status:'completed',source:'synthetic'}));
    const session=await signIn(store,{email:admin.email,password},'claims',now);
    const draft=(await request(store,'outreach/drafts','POST',{donorId:created[0].id,templateId:'thank-you-email'},session)).body.data;
    const input={id:draft.id,revision:draft.revision};
    await request(store,'outreach/approve','POST',input,session);
    let delivered=0;const provider={sendEmail:async()=>{delivered++;return {status:'sent',id:'synthetic-receipt'};}};
    const results=await Promise.all([store,other,store,other].map(s=>request(s,'outreach/send','POST',input,session,{options:{provider,env:{EMAIL_DELIVERY_MODE:'test'}}})));
    assert.ok(results.some(r=>r.statusCode===200));assert.equal(delivered,1);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM outreach_delivery_history WHERE status='sent'")).rows[0].n,1);
    await assert.rejects(db.transaction(q=>q('DELETE FROM audit_events')),/append-only/);
    const memberSession=await signIn(store,{email:a.email,password},'member',now);
    assert.equal((await request(store,'users','GET',{},memberSession)).statusCode,403);
    assert.equal((await request(store,'users','PATCH',{id:a.id,roleId:'administrator'},memberSession)).statusCode,403);
    const broken=createSqlStore({transaction(){throw new Error('private transport error');}});
    const failure=await request(broken,'auth/me','GET',{},session);
    assert.equal(failure.statusCode,503);assert.doesNotMatch(JSON.stringify(failure.body),/private transport/);
  }finally{await db.close();}
});
