import test from 'node:test';
import assert from 'node:assert/strict';
import {parseImport} from '../lib/import-parser.js';
import {previewImport,confirmImport} from '../lib/import-data.js';
import {mentorFixture} from '../test-support/mentor-fixture.js';
import {editDonor} from '../lib/donor-data.js';
import {reviewedImportRows} from '../public/js/import-review.js';
import {workbook} from '../test-support/workbook.js';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createIsolatedDatabase} from '../lib/isolated-database.js';
import {migrate} from '../lib/database-setup.js';
import {donorInput} from '../lib/data-validation.js';
const header=['Name','Donor type','Company','Organization name','Contact person','Board contact'];
const upload=(matrix,kind='csv')=>({filename:`synthetic-organizations.${kind}`,source:'synthetic-org',content_base64:(kind==='csv'?Buffer.from(matrix.map(r=>r.join(',')).join('\n')):workbook(matrix)).toString('base64')});

test('CSV/XLSX preserve independent organization, employer, human contact and board fields',async()=>{
 for(const kind of ['csv','xlsx']){
  const p=await parseImport(upload([header,['Opportunity Hack','organization','Synthetic Employer','Opportunity Hack','Synthetic Human','Synthetic Board']],kind));
  assert.deepEqual(p.rows[0].errors,[]);const data=p.rows[0].data;
  assert.equal(data.donor.organization_name,'Opportunity Hack');assert.equal(data.donor.company,'Synthetic Employer');assert.equal(data.donor.contact_person,'Synthetic Human');assert.equal(data.board_contact,'Synthetic Board');assert.equal(data.donor.donor_type,'organization');assert.equal(data.organization_suggestion,null);
 }
});
test('company never establishes organization identity; name suggestions require review and preserve explicit types',async()=>{
 const p=await parseImport(upload([header,['Synthetic Alex','','Synthetic Foundation','','',''],['Opportunity Hack','','','','',''],['Opportunity Hack','person','','','',''],['','','Opportunity Hack','','','']]));
 assert.equal(p.rows[0].data.donor.donor_type,'person');assert.equal(p.rows[0].data.organization_suggestion,null);
 assert.equal(p.rows[1].data.donor.donor_type,'person');assert.equal(p.rows[1].data.organization_suggestion.type,'organization');
 assert.equal(p.rows[2].data.donor.donor_type,'person');assert.equal(p.rows[2].data.organization_suggestion,null);
 assert.equal(p.rows[3].data.donor.donor_type,'person');assert.equal(p.rows[3].data.organization_suggestion,null,'employer-only rows must not generate organization suggestions');
 assert.throws(()=>reviewedImportRows({rows:[p.rows[1]]},{}),/Review donor type/);
 assert.equal(reviewedImportRows({rows:[p.rows[1]]},{'type:3':'organization'})[3].donor_type,'organization');
});
test('reviewed import creates the selected type; human contact is not an ownership assignment',async()=>{
 const {db,admin,tx}=await mentorFixture();
 try{
  const p=await tx(q=>previewImport(q,upload([header,['Opportunity Hack','','Synthetic Employer','','Synthetic Human','']]),admin));
  await assert.rejects(tx(q=>confirmImport(q,{batch_id:p.batch_id},admin)),{code:'TYPE_REVIEW_REQUIRED'});
  const result=await tx(q=>confirmImport(q,{batch_id:p.batch_id,decisions:{2:{donor_type:'organization'}}},admin));
  const donor=(await db.query('SELECT * FROM donors WHERE id=$1',[result.rows[0].donor_id])).rows[0];assert.equal(donor.donor_type,'organization');assert.equal(donor.contact_person,'Synthetic Human');assert.equal(donor.company,'Synthetic Employer');assert.equal(donor.assigned_board_member_id,null);
  const corrected=await tx(q=>editDonor(q,donor.id,{donor_type:'person'},admin.id));assert.equal(corrected.contact_person,'Synthetic Human');assert.equal(corrected.company,'Synthetic Employer');
  const explicit=await tx(q=>previewImport(q,upload([header,['Synthetic Explicit','person','','','','']]),admin));
  await assert.rejects(tx(q=>confirmImport(q,{batch_id:explicit.batch_id,decisions:{2:{donor_type:'organization'}}},admin)),{code:'TYPE_CONFLICT'});
 }finally{await db.close();}
});
test('008 upgrades populated 007 storage without inferring identities or changing historical data',async()=>{
 const db=await createIsolatedDatabase(),directory=new URL('../db/migrations/',import.meta.url);
 try{
  await db.transaction(async q=>{
   await q('CREATE TABLE colorloop_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now(),checksum text)');
   for(const name of (await readdir(directory)).filter(n=>n.endsWith('.sql')&&n<'008').sort()){
    const sql=await readFile(new URL(name,directory),'utf8');await q(sql);await q('INSERT INTO colorloop_migrations(name,checksum) VALUES ($1,$2)',[name,createHash('sha256').update(sql).digest('hex')]);
   }
  });
  const before=(await db.query("INSERT INTO donors(donor_type,display_name,company,custom_data) VALUES ('person','Synthetic historical contact','Synthetic Foundation','{\"legacy\":\"preserved\"}') RETURNING *")).rows[0];
  await assert.rejects(donorInput(db.query,{donor_type:'person',display_name:'Synthetic pending new fields',organization_name:'Synthetic Organization'}),{code:'MIGRATION_REQUIRED'});
  assert.equal(Object.hasOwn(await donorInput(db.query,{donor_type:'person',display_name:'Synthetic legacy-compatible',organization_name:'',contact_person:''}),'organization_name'),false);
  await db.transaction(migrate);await db.transaction(migrate);
  const after=(await db.query('SELECT * FROM donors WHERE id=$1',[before.id])).rows[0];
  assert.equal(after.organization_name,null);assert.equal(after.contact_person,null);
  for(const [key,value] of Object.entries(before))assert.deepEqual(after[key],value);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM users')).rows[0].n,0);
 }finally{await db.close();}
});
