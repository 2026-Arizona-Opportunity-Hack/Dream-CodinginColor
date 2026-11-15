import test from 'node:test';
import assert from 'node:assert/strict';
import {createIsolatedDatabase} from '../lib/isolated-database.js';
import {migrate} from '../lib/database-setup.js';
import {createSqlStore} from '../lib/retention-sql-store.js';
import {bootstrapAdministrator,login} from '../lib/auth.js';
import {createDonor,addDonation} from '../lib/donor-data.js';
import {mergeDonors} from '../lib/matching.js';
import funderPacket from '../api/reports/funder.js';
import {contextKey} from '../lib/permissions.js';
import {now,password,origin} from './retention-support.js';

test('merges retain verified funder evidence in the canonical packet, preserve attribution, and roll back atomically',async()=>{
 const db=await createIsolatedDatabase();
 try{
  await db.transaction(migrate);const store=createSqlStore(db);
  const operator=await bootstrapAdministrator(store,{name:'Synthetic operator',email:'outcomes@example.test',password},now);
  const session=await login(store,{email:operator.email,password},'192.0.2.1',now);
  const main=await db.transaction(q=>createDonor(q,{donor_type:'organization',display_name:'Synthetic canonical'},operator.id));
  const old=await db.transaction(q=>createDonor(q,{donor_type:'organization',display_name:'Synthetic alias'},operator.id));
  await db.transaction(q=>addDonation(q,{donor_id:old.id,amount:'12.50',donation_date:'2026-03-01',currency:'USD',status:'completed',source:'synthetic'}));
  const evidence=(await db.query("INSERT INTO verified_funder_outcomes(donor_id,description,verified_at,evidence_reference,period_start,period_end) VALUES ($1,'Synthetic verified outcome','2026-06-30','https://example.test/evidence','2026-01-01','2026-06-30') RETURNING *",[old.id])).rows[0];
  const input={canonical_donor_id:main.id,merged_donor_id:old.id,reason:'Synthetic verified duplicate'};
  await assert.rejects(db.transaction(q=>mergeDonors(async(sql,params)=>{
   if(sql.startsWith('UPDATE donor_aliases'))throw new Error('Synthetic interruption');return q(sql,params);
  },input,operator)),/Synthetic interruption/);
  assert.equal((await db.query('SELECT donor_id FROM verified_funder_outcomes WHERE id=$1',[evidence.id])).rows[0].donor_id,old.id);
  const result=await db.transaction(q=>mergeDonors(q,input,operator));
  assert.equal(result.outcomes_moved,1);
  const audit=(await db.query('SELECT audit_details FROM donor_merge_history WHERE id=$1',[result.history_id])).rows[0].audit_details;
  assert.equal(audit.original_verified_outcomes[0].id,evidence.id);
  assert.equal(audit.original_verified_outcomes[0].donor_id,old.id);
  assert.equal(audit.original_verified_outcomes[0].evidence_reference,evidence.evidence_reference);
  const sql=async(strings,...params)=>(await db.query(strings.reduce((value,part,i)=>value+(i?`$${i}`:'')+part,''),params)).rows;
  const req={method:'GET',query:{donorId:main.id,from:'2026-01-01',to:'2026-12-31'},headers:{cookie:`__Host-colorloop=${session.token}`},[contextKey]:{store,now:()=>now,origin,sql}};
  const res={setHeader(){},status(n){this.statusCode=n;return this;},json(value){this.body=value;this.headersSent=true;return this;}};
  await funderPacket(req,res);
  assert.equal(res.statusCode,200);assert.equal(res.body.data.gifts.length,1);
  assert.equal(res.body.data.outcomes.length,1);
  assert.equal(res.body.data.outcomes[0].evidence_reference,evidence.evidence_reference);
  await assert.rejects(db.transaction(q=>mergeDonors(q,input,operator)),e=>e.code==='MERGE_CONFLICT');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM verified_funder_outcomes')).rows[0].n,1);
 }finally{await db.close();}
});
