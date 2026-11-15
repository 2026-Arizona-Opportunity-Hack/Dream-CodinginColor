import test from 'node:test';
import assert from 'node:assert/strict';
import {createIsolatedDatabase} from '../lib/isolated-database.js';
import {migrate} from '../lib/database-setup.js';
import {createSqlStore} from '../lib/retention-sql-store.js';
import {bootstrapAdministrator} from '../lib/auth.js';
import {PERMISSIONS} from '../lib/permissions.js';
import {previewImport,confirmImport} from '../lib/import-data.js';
import {saveCampaign} from '../lib/custom-field-data.js';
import {savePreset,listPresets,BUILTIN_PRESETS} from '../lib/import-presets.js';
import {parseImport} from '../lib/import-parser.js';
import {workbook} from '../test-support/workbook.js';
const password='SyntheticCampaign123!';
const header='First Name,Last Name,Email,Amount,Date,Currency,Status,Campaign,Transaction ID';
const upload=(csv,source='generic')=>({filename:'synthetic.csv',source,content_base64:Buffer.from(csv).toString('base64')});
const row=(id,campaign='Synthetic New Campaign',amount='25')=>`Synthetic,Supporter,import-campaign@example.test,${amount},2026-10-19,USD,completed,${campaign},${id}`;

test('campaign review creates and maps atomically without weakening donor or donation deduplication',async(t)=>{
 const db=await createIsolatedDatabase();
 try{
  await db.transaction(migrate);const admin={...await bootstrapAdministrator(createSqlStore(db),{name:'Synthetic campaign admin',email:'campaign-admin@example.test',password}),permissions:[...PERMISSIONS]};
  const preview=csv=>db.transaction(q=>previewImport(q,upload(csv),admin));
  const confirm=(batch,decisions,actor=admin)=>db.transaction(q=>confirmImport(q,{batch_id:batch.batch_id,decisions},actor));
  const csv=[header,row('CAMP-001'),row('CAMP-002')].join('\n');let result;
  await t.test('missing campaign is reviewable and preview creates nothing',async()=>{
   const batch=await preview(csv);assert.equal(batch.counts.invalid,0);assert.equal(batch.rows[0].campaign_review.status,'missing');
   assert.equal((await db.query('SELECT count(*)::int AS n FROM campaigns')).rows[0].n,0);
   await assert.rejects(confirm(batch),{code:'CAMPAIGN_REVIEW_REQUIRED'});
   await assert.rejects(confirm(batch,{2:{campaign:{action:'create'}}}),{code:'CAMPAIGN_APPROVAL_REQUIRED'});
   await assert.rejects(confirm(batch,{2:{campaign:{action:'create',approved:true}}},{...admin,permissions:['imports.manage']}),{code:'FORBIDDEN'});
   result=await confirm(batch,{2:{campaign:{action:'create',approved:true}},3:{campaign:{action:'create',name:' synthetic new campaign ',approved:true}}});
   assert.equal(result.rows[0].donor_id,result.rows[1].donor_id);
   assert.equal((await db.query('SELECT count(*)::int AS n FROM campaigns')).rows[0].n,1);
   assert.equal((await db.query('SELECT count(*)::int AS n FROM donations')).rows[0].n,2);
   assert.equal((await db.query("SELECT count(*)::int AS n FROM audit_events WHERE action='campaigns.create-from-import'")).rows[0].n,1);
  });
  await t.test('case/whitespace match and reimports reuse gifts and campaign',async()=>{
   const repeat=await preview(csv.replaceAll('Synthetic New Campaign','  SYNTHETIC NEW CAMPAIGN  '));
   assert.equal(repeat.rows[0].campaign_review.status,'matched');
   const imported=await confirm(repeat);assert.deepEqual(imported.rows.map(r=>r.result),['duplicate','duplicate']);
   assert.equal((await db.query('SELECT sum(amount)::text AS total FROM donations')).rows[0].total,'50.00');
   await assert.rejects(db.transaction(q=>saveCampaign(q,{name:' synthetic new campaign '})),{code:'CAMPAIGN_NAME_CONFLICT'});
  });
  await t.test('map and leave-unassigned decisions use only active campaigns',async()=>{
   const campaign=(await db.query('SELECT id FROM campaigns')).rows[0];
   const batch=await preview([header,row('CAMP-MAP','Unknown incoming name'),row('CAMP-NONE','Another incoming name')].join('\n'));
   const imported=await confirm(batch,{2:{campaign:{action:'map',id:campaign.id}},3:{campaign:{action:'none'}}});
   assert.equal((await db.query('SELECT campaign_id FROM donations WHERE id=$1',[imported.rows[0].donation_id])).rows[0].campaign_id,campaign.id);
   assert.equal((await db.query('SELECT campaign_id FROM donations WHERE id=$1',[imported.rows[1].donation_id])).rows[0].campaign_id,null);
  });
  await t.test('a later gift conflict rolls back approved campaigns, gifts, and row state',async()=>{
   const batch=await preview([header,row('CAMP-NEW','Rollback campaign'),row('CAMP-001','Synthetic New Campaign','99')].join('\n'));
   await assert.rejects(confirm(batch,{2:{campaign:{action:'create',approved:true}}}),{code:'TRANSACTION_CONFLICT'});
   assert.equal((await db.query("SELECT count(*)::int AS n FROM campaigns WHERE name='Rollback campaign'")).rows[0].n,0);
   assert.equal((await db.query("SELECT count(*)::int AS n FROM donations WHERE external_transaction_id='CAMP-NEW'")).rows[0].n,0);
   assert.equal((await db.query('SELECT status FROM import_batches WHERE id=$1',[batch.batch_id])).rows[0].status,'preview');
  });
  await t.test('saved Benevity mappings work for explicitly configured synthetic CSV/XLSX headings',async()=>{
   const mapping={first_name:'Given',last_name:'Family',email:'WorkEmail',amount:'Contribution',donation_date:'Processed'};
   const saved=await db.transaction(q=>savePreset(q,{name:'Synthetic employer export',source:'benevity',mapping},admin));
   const presets=await listPresets(db.query);assert.deepEqual(presets[0].mapping,mapping);assert.equal(saved.source,'benevity');
   for(const ext of ['csv','xlsx']){
    const matrix=[['Given','Family','WorkEmail','Contribution','Processed'],['Synthetic','Corporate','corporate@example.test','10','2026-10-19']];
    const content=ext==='csv'?Buffer.from(matrix.map(r=>r.join(',')).join('\n')):workbook(matrix);
    const parsed=await parseImport({filename:`synthetic.${ext}`,source:saved.source,mapping:saved.mapping,content_base64:content.toString('base64')});
    assert.deepEqual(parsed.rows[0].errors,[]);assert.equal(parsed.rows[0].data.donor.display_name,'Synthetic Corporate');assert.equal(parsed.rows[0].data.donation.status,null);
   }
   assert.equal(BUILTIN_PRESETS.find(p=>p.id==='zeffy').mapping.donation_date,'First payment date (America/Phoenix)');
   assert.deepEqual(BUILTIN_PRESETS.find(p=>p.id==='benevity').mapping,{});
  });
  await t.test('row-level validation reports the actual safe validation issue',async()=>{
   const batch=await preview([header,row('CAMP-BAD','Synthetic New Campaign','-25')].join('\n'));
   assert.equal(batch.counts.invalid,1);assert.ok(batch.rows[0].errors[0].length>0);
   assert.equal(batch.rows[0].errors[0].includes('current field or campaign definitions'),false);
  });
 }finally{await db.close();}
});
