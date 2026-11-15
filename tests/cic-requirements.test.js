import test from 'node:test';
import assert from 'node:assert/strict';
import {createIsolatedDatabase} from '../lib/isolated-database.js';
import {migrate} from '../lib/database-setup.js';
import {createSqlStore} from '../lib/retention-sql-store.js';
import {bootstrapAdministrator,saveUser,saveRole,retireRole,login} from '../lib/auth.js';
import {previewImport,confirmImport} from '../lib/import-data.js';
import {parseImport} from '../lib/import-parser.js';
import {importDate} from '../lib/import-date.js';
import {saveField,saveCampaign} from '../lib/custom-field-data.js';
import {generateReminders,approveDraft,handoffDraft,confirmManualSend} from '../lib/outreach.js';
import {recordOutcome} from '../lib/evidence-data.js';
import {reviewDonation,createDonor,addDonation} from '../lib/donor-data.js';
import {calculateRetention,parseFilters} from '../lib/reporting.js';
import {atRisk,createReengagement} from '../lib/retention.js';
import {workbook} from '../test-support/workbook.js';
import funderPacket from '../api/reports/funder.js';
import {contextKey} from '../lib/permissions.js';
import {createRouter} from '../lib/api-router.js';
import {request,password,now} from './retention-support.js';
const header=['First name','Last name','Email','Secondary email','Amount','First payment date (America/Phoenix)'];
const row=['Synthetic','Supporter','synthetic@example.test','secondary@example.test','25','10/19/2026, 8:23 PM'];
const csv=matrix=>matrix.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n');
const upload=(content,extra={})=>({filename:'synthetic.csv',source:'zeffy',content_base64:Buffer.from(content).toString('base64'),...extra});

test('Phoenix CSV/XLSX dates and separate names parse without inventing payment metadata',async()=>{
  for(const kind of ['csv','xlsx']){
    const content=kind==='csv'?csv([header,row]):workbook([header,row]);
    const result=await parseImport(upload(content,{filename:`synthetic.${kind}`}));
    assert.deepEqual(result.rows[0].errors,[]);const data=result.rows[0].data;
    assert.equal(data.donor.first_name,'Synthetic');assert.equal(data.donor.last_name,'Supporter');
    assert.equal(data.donor.secondary_email,'secondary@example.test');assert.equal(data.donation.donation_date,'2026-10-19');
    assert.equal(data.donation.currency,null);assert.equal(data.donation.status,null);
  }
  assert.equal(importDate(new Date('2026-10-19T20:23:00Z')),'2026-10-19');
  assert.equal(importDate('2026-10-20T03:23:00Z'),'2026-10-19');
  for(const value of ['02/30/2026','10/19/2026, 13:23 PM','2026-02-30'])assert.throws(()=>importDate(value));
});

test('genuine styled Excel numeric date cells preserve the source calendar day',async()=>{
 const serial=(Date.UTC(2026,9,19,20,23)-Date.UTC(1899,11,30))/86400000;
 const data=workbook([['Name','Amount','Date']],{
  'xl/styles.xml':'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="mm/dd/yyyy hh:mm"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164" applyNumberFormat="1"/></cellXfs></styleSheet>',
  'xl/worksheets/sheet1.xml':`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c><c r="B1" t="inlineStr"><is><t>Amount</t></is></c><c r="C1" t="inlineStr"><is><t>Date</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Synthetic Excel</t></is></c><c r="B2"><v>25</v></c><c r="C2" s="1"><v>${serial}</v></c></row></sheetData></worksheet>`
 });
 const result=await parseImport(upload(data,{filename:'synthetic.xlsx'}));
 assert.deepEqual(result.rows[0].errors,[]);assert.equal(result.rows[0].data.donation.donation_date,'2026-10-19');
});

test('required CIC workflows persist together in disposable PostgreSQL',async(t)=>{
 const db=await createIsolatedDatabase();
 try{
  await db.transaction(migrate);const store=createSqlStore(db);
  const admin={...await bootstrapAdministrator(store,{name:'Synthetic CIC admin',email:'cic-admin@example.test',password},now),administrator:true,permissions:['tasks.manage','outreach.write']};
  const member=await saveUser(store,admin,{name:'Synthetic Board',email:'cic-board@example.test',password,roleId:'board-member',boardMember:true},now);
  const campaign=await db.transaction(q=>saveCampaign(q,{name:'Synthetic camp'}));
  await db.transaction(q=>saveField(q,{key:'volunteer',label:'Volunteer',field_type:'boolean'}));
  const content=csv([[...header,'Phone','Company','Campaign','Board member','Transaction ID','Volunteer'],[...row,'+16025550123','Synthetic Company',campaign.name,member.email,'CIC-001','true']]);
  const input=upload(content,{mapping:{first_name:header[0],last_name:header[1],email:header[2],secondary_email:header[3],amount:header[4],donation_date:header[5],phone:'Phone',company:'Company',campaign:'Campaign',board_contact:'Board member',external_transaction_id:'Transaction ID','custom:volunteer':'Volunteer'}});
  const preview=input=>db.transaction(q=>previewImport(q,input,admin));
  const confirm=(batch,decisions)=>db.transaction(q=>confirmImport(q,{batch_id:batch.batch_id,decisions},admin));
  let donorId,giftId;
  await t.test('payment and imported ownership require explicit review; every field survives confirmation',async()=>{
    const unreviewed=await preview(input);
    await assert.rejects(confirm(unreviewed),{code:'PAYMENT_REVIEW_REQUIRED'});
    const reviewed=await preview({...input,payment_review:{currency:'USD',status:'completed'}});
    assert.equal(reviewed.rows[0].board_candidates[0].id,member.id);
    await assert.rejects(confirm(reviewed),{code:'OWNERSHIP_REVIEW_REQUIRED'});
    await assert.rejects(confirm(reviewed,{2:{assignee_id:admin.id}}),{code:'OWNERSHIP_CONFLICT'});
    const result=await confirm(reviewed,{2:{assignee_id:member.id}});donorId=result.rows[0].donor_id;giftId=result.rows[0].donation_id;
    const donor=(await db.query('SELECT * FROM donors WHERE id=$1',[donorId])).rows[0];
    assert.equal(donor.first_name,'Synthetic');assert.equal(donor.last_name,'Supporter');assert.equal(donor.phone,'+16025550123');assert.equal(donor.company,'Synthetic Company');assert.equal(donor.secondary_email,'secondary@example.test');assert.equal(donor.assigned_board_member_id,member.id);assert.equal(donor.custom_data.volunteer,true);
    assert.equal((await db.query('SELECT campaign_id FROM donations WHERE id=$1',[giftId])).rows[0].campaign_id,campaign.id);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM outreach_messages WHERE donation_id=$1',[giftId])).rows[0].n,1);
    await confirm(reviewed);const repeat=await preview({...input,payment_review:{currency:'USD',status:'completed'}});
    assert.equal((await confirm(repeat,{2:{assignee_id:member.id}})).rows[0].result,'duplicate');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM donations')).rows[0].n,1);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM outreach_messages')).rows[0].n,1);
  });
  await t.test('quarterly donor updates and board summaries are separate and idempotent',async()=>{
    const a=await generateReminders(store,admin,now,'donor-quarterly');const b=await generateReminders(store,admin,now,'donor-quarterly');
    assert.equal(a[0].id,b[0].id);assert.equal(a[0].donorId,donorId);assert.match(a[0].body,/USD 25.00/);
    const boards=await generateReminders(store,admin,now,'quarterly');assert.equal(boards[0].audience,'board');assert.notEqual(a[0].id,boards[0].id);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM tasks WHERE event_key LIKE 'donor-quarterly:%'")).rows[0].n,1);
    const later=await generateReminders(store,admin,new Date('2027-01-10T12:00:00Z'),'donor-quarterly');assert.notEqual(later[0].id,a[0].id);
  });
  await t.test('manual handoff is consent-checked, distinct from sent, audited, and retry-safe',async()=>{
    const draft=await store.read(s=>s.drafts.find(d=>d.eventKey===`thank-you:${giftId}`));const args={id:draft.id,revision:1};
    await assert.rejects(handoffDraft(store,admin,args,now),{code:'APPROVAL_REQUIRED'});
    await assert.rejects(approveDraft(store,admin,args,now),{code:'CONTACT_NOT_ALLOWED'});
    await db.query('UPDATE donors SET email_consent=true WHERE id=$1',[donorId]);
    await approveDraft(store,admin,args,now);const handoff=await handoffDraft(store,admin,args,now);
    assert.equal(handoff.draft.status,'handed_off');assert.equal(handoff.draft.sentAt,null);assert.equal(handoff.to,'synthetic@example.test');
    await handoffDraft(store,admin,args,now);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM outreach_delivery_history WHERE status='handed_off'")).rows[0].n,1);
    await db.query("UPDATE donors SET normalized_email='changed@example.test' WHERE id=$1",[donorId]);
    await assert.rejects(confirmManualSend(store,admin,{...args,reference:'Synthetic changed recipient'},now),{code:'RECIPIENT_CHANGED'});
    await db.query("UPDATE donors SET normalized_email='synthetic@example.test' WHERE id=$1",[donorId]);
    await assert.rejects(confirmManualSend(store,admin,{...args,reference:''},now));
    const sent=await confirmManualSend(store,admin,{...args,reference:'Synthetic attestation only; no real message sent'},now);assert.equal(sent.status,'sent');
    await confirmManualSend(store,admin,{...args,reference:'Synthetic retry'},now);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM outreach_delivery_history WHERE status='sent'")).rows[0].n,1);
    const session=await login(store,{email:member.email,password},'192.0.2.1',now);
    assert.equal((await request(store,'outreach/handoff','POST',args,session)).statusCode,403);
  });
  await t.test('reviewed evidence and multi-year giving preserve original gifts',async()=>{
    await db.transaction(q=>recordOutcome(q,{donor_id:donorId,description:'Synthetic verified students outcome',evidence_reference:'synthetic evidence only',verified_at:'2026-11-01',period_start:'2026-01-01',period_end:'2026-10-31'},admin));
    assert.equal((await db.query('SELECT recorded_by FROM verified_funder_outcomes')).rows[0].recorded_by,admin.id);
    await db.transaction(q=>addDonation(q,{donor_id:donorId,amount:'1000000.00',donation_date:'2027-07-01',source:'synthetic',external_transaction_id:'CIC-MILLION',currency:'USD',status:'completed'}));
    assert.equal((await db.query('SELECT count(*)::int AS n FROM donations WHERE donor_id=$1',[donorId])).rows[0].n,2);
    assert.doesNotThrow(()=>parseFilters({from:'2026-01-01',to:'2027-12-31'},{singleYear:false}));
    const session=await login(store,{email:admin.email,password},'192.0.2.3',now);
    const sql=async(strings,...params)=>(await db.query(strings.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),params)).rows;
    const req={method:'GET',query:{donorId,fullHistory:'true'},headers:{cookie:`__Host-colorloop=${session.token}`},[contextKey]:{store,sql,now:()=>now}};
    const res={setHeader(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;this.headersSent=true;return this;}};
    await funderPacket(req,res);assert.equal(res.statusCode,200);assert.equal(res.body.data.gifts.length,2);assert.equal(res.body.data.outcomes.length,1);
    assert.equal(res.body.data.to,'2027-07-01');
  });
  await t.test('unknown payment can be reviewed without changing financial identity',async()=>{
    const donor=await db.transaction(q=>createDonor(q,{donor_type:'person',display_name:'Synthetic Unknown'},admin.id));
    const gift=await db.transaction(q=>addDonation(q,{donor_id:donor.id,amount:'2.35',donation_date:'2026-01-01',source:'synthetic'}));
    await db.transaction(q=>reviewDonation(q,gift.donation.id,{currency:'USD',status:'completed',reason:'Synthetic source verified'},admin));
    assert.equal((await db.query('SELECT amount::text FROM donations WHERE id=$1',[gift.donation.id])).rows[0].amount,'2.35');
    await assert.rejects(db.transaction(q=>reviewDonation(q,gift.donation.id,{currency:'CAD',status:'completed',reason:'Synthetic conflict'},admin)),{code:'VERIFICATION_CONFLICT'});
  });
  await t.test('role retirement reassigns genuine users, revokes sessions and rejects inactive grants',async()=>{
    const role=await saveRole(store,admin,{name:'Synthetic retiring role',permissions:['donors.read']},now);
    const user=await saveUser(store,admin,{name:'Synthetic reassigned account',email:'retire@example.test',password,roleId:role.id},now);
    await login(store,{email:user.email,password},'192.0.2.2',now);
    await retireRole(store,admin,{id:role.id,replacementRoleId:'board-member'},now);
    assert.equal((await db.query('SELECT role_id FROM users WHERE id=$1',[user.id])).rows[0].role_id,'board-member');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM sessions WHERE user_id=$1',[user.id])).rows[0].n,0);
    await assert.rejects(saveUser(store,admin,{name:'Rejected',email:'retired-role@example.test',password,roleId:role.id},now));
  });
  await t.test('board accounts cannot read or modify another owner’s donors, tasks, messages or reports',async()=>{
    const other=await saveUser(store,admin,{name:'Synthetic Other Board',email:'other-board@example.test',password,roleId:'board-member',boardMember:true},now);
    const outside=await db.transaction(q=>createDonor(q,{donor_type:'person',display_name:'Synthetic Private Other Donor'},admin.id));
    assert.equal(outside.assigned_board_member_id,other.id);
    await saveRole(store,admin,{id:'board-member',name:'Board member',permissions:['donors.read','donors.write','donations.write','activities.write','tasks.manage','outreach.write','reports.read']},now,true);
    const session=await login(store,{email:member.email,password},'192.0.2.10',now);
    const router=createRouter({database:db,store,origin:'https://colorloop.example',now:()=>now});
    const call=async(route,method='GET',body={},query={},auth=session)=>{
      const req={method,query:{...query,route},body,headers:{cookie:`__Host-colorloop=${auth.token}`,origin:'https://colorloop.example','content-type':'application/json','x-csrf-token':auth.csrfToken}};
      const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(value){this.body=value;this.headersSent=true;return this;}};
      await router(req,res);return res;
    };
    const generalBoard=await saveUser(store,admin,{name:'Synthetic board role without assignment eligibility',email:'general-board@example.test',password,roleId:'board-member',boardMember:false},now);
    const generalSession=await login(store,{email:generalBoard.email,password},'192.0.2.11',now);
    assert.equal((await call('donors','GET',{},{},generalSession)).body.data.length,0);
    assert.equal((await call(`donors/${outside.id}`,'GET',{},{},generalSession)).statusCode,403);
    const listing=await call('donors');assert.equal(listing.statusCode,200);assert.ok(listing.body.data.every(d=>d.id!==outside.id));
    assert.equal((await call(`donors/${donorId}`)).statusCode,200);
    assert.equal((await call(`donors/${outside.id}`)).statusCode,403);
    assert.equal((await call(`donors/${outside.id}/donations`)).statusCode,403);
    assert.equal((await call('activities','POST',{donorId:outside.id,type:'note',content:'Rejected synthetic note'})).statusCode,403);
    assert.equal((await call('tasks','POST',{donorId:outside.id,assigneeId:member.id,nextAction:'Rejected synthetic task',dueAt:'2026-11-20'})).statusCode,403);
    assert.equal((await call('outreach/drafts','POST',{donorId:outside.id,templateId:'follow-up'})).statusCode,403);
    assert.equal((await call('merges/candidates','GET',{}, {id:donorId})).statusCode,403);
    assert.equal((await call('reports/funder','GET',{}, {donorId:outside.id,fullHistory:'true'})).statusCode,403);
  });
 }finally{await db.close();}
});

test('retention names categories and cycle radar distinguishes matched cycles from inactivity',()=>{
 const gifts=[{donor_id:'up',donated_at:'2025-01-01',amount_cents:'100',program:null,board_member_id:null},{donor_id:'up',donated_at:'2026-01-01',amount_cents:'200',program:null,board_member_id:null},{donor_id:'lapsed',donated_at:'2025-02-01',amount_cents:'100',program:null,board_member_id:null}];
 const report=calculateRetention(gifts,parseFilters({from:'2026-01-01',to:'2026-11-14'}));
 assert.deepEqual(report.categories.increased,['up']);assert.deepEqual(report.categories.lapsed,['lapsed']);
 const state={settings:{inactivityMonths:120},donors:[{id:'lapsed',name:'Synthetic cycle donor',active:true}],donations:[{id:'gift',donorId:'lapsed',amountCents:100,currency:'USD',status:'completed',donatedAt:'2025-02-01'}],assignments:[],users:[],tasks:[],drafts:[],templates:[]};
 assert.equal(atRisk(state,now).length,0);assert.equal(atRisk(state,now,'cycle').length,1);assert.match(atRisk(state,now,'cycle')[0].reason,/provisional/);
});
