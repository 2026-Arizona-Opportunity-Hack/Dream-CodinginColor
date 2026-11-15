import test from 'node:test';
import assert from 'node:assert/strict';
import {impactPreview,impactPreviewHtml} from '../public/js/impact-preview.js';
import {mentorFixture,password} from '../test-support/mentor-fixture.js';
import {createDonor,addDonation} from '../lib/donor-data.js';
import {recordOutcome} from '../lib/evidence-data.js';
import {assignReviewedOwner} from '../lib/assignment-sql.js';
import {saveRole,saveUser,login} from '../lib/auth.js';
const now=new Date('2026-11-15T18:00:00Z');
const report={name:'Synthetic donor',currency:'USD',gifts:[{amount:12.34,donated_at:'2025-06-10',program:'Synthetic coding camp'},{amount:0.1,donated_at:'2026-03-01',program:'Synthetic coding camp'},{amount:0.2,donated_at:'2026-10-01',program:null}],outcomes:[{description:'Synthetic workshop completed; no donor-specific allocation established.',verified_at:'2026-11-01',evidence_reference:'synthetic-evidence'}]};

test('internal impact preview uses exact cents, year-to-date history, programs and verified evidence',()=>{
 const model=impactPreview(report,now);assert.equal(model.lifetimeCents,1264);assert.equal(model.yearToDateCents,30);assert.equal(model.gifts.length,3);assert.equal(model.gifts[0].date,'2026-10-01');assert.deepEqual(model.programs,['Synthetic coding camp']);assert.equal(model.outcomes.length,1);
 const html=impactPreviewHtml(model);assert.match(html,/Internal staff preview/);assert.match(html,/has not been published/);assert.match(html,/No impact metrics have been inferred/);assert.match(html,/\$12.64/);
});
test('impact preview excludes future, malformed, nonpositive gifts and unverified outcome evidence',()=>{
 const model=impactPreview({...report,gifts:[...report.gifts,{amount:999,donated_at:'2027-01-01'},{amount:-1,donated_at:'2026-01-01'},{amount:1,donated_at:'2026-02-30'},{amount:'5',donated_at:'2026-01-01'}],outcomes:[...report.outcomes,{description:'No evidence',verified_at:'2026-01-01',evidence_reference:''},{description:'Future claim',verified_at:'2027-01-01',evidence_reference:'x'}]},now);
 assert.equal(model.lifetimeCents,1264);assert.equal(model.outcomes.length,1);assert.throws(()=>impactPreview({...report,currency:'EUR'},now),/verified USD/);
});
test('impact preview escapes donor names, programs and outcomes; empty state invents no results',()=>{
 const html=impactPreviewHtml(impactPreview({...report,name:'<img src=x onerror=alert(1)>',gifts:[{amount:1,donated_at:'2026-01-01',program:'<script>unsafe</script>'}],outcomes:[{description:'<img src=x>',verified_at:'2026-01-01',evidence_reference:'internal-secret-reference'}]},now));
 assert.doesNotMatch(html,/<img|<script>|internal-secret-reference/);assert.match(html,/&lt;img/);
 const empty=impactPreviewHtml(impactPreview({name:'Synthetic empty',currency:'USD'},now));assert.match(empty,/No verified outcome evidence/);assert.match(empty,/No verified completed USD gifts/);assert.doesNotMatch(empty,/students supported/i);
});
test('internal impact data stays behind existing MFA, reporting and donor-assignment authorization',async()=>{
 const f=await mentorFixture();
 try{
  const role=await saveRole(f.store,f.admin,{name:'Synthetic assigned reporting reviewer',permissions:['donors.read','reports.read']},now);
  const owner=await saveUser(f.store,f.admin,{name:'Synthetic owner',email:'owner-impact@example.test',password,roleId:role.id,boardMember:true},now);
  const other=await saveUser(f.store,f.admin,{name:'Synthetic unrelated reviewer',email:'other-impact@example.test',password,roleId:role.id,boardMember:true},now);
  const donor=await f.tx(async q=>{const d=await createDonor(q,{donor_type:'person',display_name:'Synthetic private impact donor',normalized_email:'private-impact@example.test'},f.admin.id);await addDonation(q,{donor_id:d.id,amount:'25.00',donation_date:'2026-06-10',source:'synthetic-impact',currency:'USD',status:'completed'});await assignReviewedOwner(q,d.id,owner.id,f.admin.id);await recordOutcome(q,{donor_id:d.id,description:'Synthetic approved workshop evidence',evidence_reference:'Synthetic staff-only reference',verified_at:'2026-06-11',period_start:'2026-06-01',period_end:'2026-06-10',program:'Synthetic workshop'},f.admin);return d;});
  const query={donorId:donor.id,fullHistory:'true'};
  assert.equal((await f.call('reports/funder','GET',query)).statusCode,401);
  const partial=await login(f.store,{email:owner.email,password},'192.0.2.92',new Date());assert.equal((await f.call('reports/funder','GET',query,partial)).statusCode,403);
  const ownerSession=await f.session(owner),otherSession=await f.session(other);
  const result=await f.call('reports/funder','GET',query,ownerSession);assert.equal(result.statusCode,200);assert.equal(impactPreview(result.body.data,now).lifetimeCents,2500);assert.equal(result.body.data.outcomes.length,1);
  const denied=await f.call('reports/funder','GET',query,otherSession);assert.equal(denied.statusCode,403);assert.doesNotMatch(JSON.stringify(denied.body),/Synthetic private impact donor|staff-only reference/);
 }finally{await f.db.close();}
});
test('manual local judge role uses real MFA and cannot send email or administer accounts',async()=>{
 const f=await mentorFixture();
 try{
  const role=await saveRole(f.store,f.admin,{name:'Synthetic local judge review',permissions:['donors.read','donors.write','donations.write','imports.manage','assignments.manage','activities.write','tasks.manage','outreach.write','outreach.approve','reports.read','settings.manage']},now);
  const judge=await saveUser(f.store,f.admin,{name:'Synthetic local judge',email:'judge-private@example.test',password,roleId:role.id,boardMember:false},now);
  const partial=await login(f.store,{email:judge.email,password},'192.0.2.93',new Date());assert.equal(partial.authentication,'enrollment_required');assert.equal((await f.call('donors','GET',{},partial)).statusCode,403);
  const auth=await f.session(judge);assert.equal((await f.call('donors','GET',{},auth)).statusCode,200);
  const reviewed={id:'10000000-0000-4000-8000-000000000001',revision:1,recipient:'synthetic@example.test',subject:'Synthetic review',body:'Synthetic message; never send.',confirmed:true};
  for(const route of ['outreach/send','outreach/approve-send','email/test-reminder','users','roles'])assert.equal((await f.call(route,'POST',reviewed,auth)).statusCode,403,route);
  assert.equal((await f.call('account/profile','GET',{},auth)).statusCode,200);
 }finally{await f.db.close();}
});
