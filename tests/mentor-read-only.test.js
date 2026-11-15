import test from 'node:test';import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';
import {mentorFixture} from '../test-support/mentor-fixture.js';
import {createDonor,addDonation} from '../lib/donor-data.js';
import {assignReviewedOwner} from '../lib/assignment-sql.js';
import {saveTask} from '../lib/assignment.js';
import {previewImport} from '../lib/import-data.js';
import spec from '../docs/openapi-readonly.json' with {type:'json'};

test('read-only contracts enforce MFA, RBAC, ownership, pagination, method safety and aggregate privacy',async t=>{
 const {db,store,admin,board,tx,session,call}=await mentorFixture();
 try{
  const a=await board('read-board-a'),b=await board('read-board-b');
  const own=await tx(q=>createDonor(q,{donor_type:'person',display_name:'Synthetic own donor',normalized_email:'own@example.test'},admin.id));
  const other=await tx(q=>createDonor(q,{donor_type:'person',display_name:'Private outside donor',normalized_email:'private-outside@example.test'},admin.id));
  await tx(q=>assignReviewedOwner(q,own.id,a.id,admin.id));await tx(q=>assignReviewedOwner(q,other.id,b.id,admin.id));
  for(const donor of [own,other])await tx(q=>addDonation(q,{donor_id:donor.id,amount:'25',donation_date:'2026-06-15',currency:'USD',status:'completed',source:'synthetic-read',external_transaction_id:donor.id}));
  for(const [donor,title] of [[own,'Synthetic own today'],[own,'Synthetic own second'],[other,'Private outside task']])await saveTask(store,admin,{donorId:donor.id,assigneeId:admin.id,nextAction:title,dueAt:'2026-11-14T18:00:00Z'},new Date());
  const adminSession=await session(admin),boardSession=await session(a);
  await t.test('public spec contains schemas only; protected endpoints require genuine verified sessions',async()=>{
   const publicSpec=await call('v1/openapi');assert.equal(publicSpec.statusCode,200);assert.deepEqual(publicSpec.body,spec);assert.equal(JSON.stringify(publicSpec.body).includes(process.env.MFA_ENCRYPTION_KEY),false);
   for(const route of ['v1/follow-ups','v1/campaign-summaries','v1/overview','imports/history'])assert.equal((await call(route,'GET',{on:'2026-11-14'})).statusCode,401);
   const {login}=await import('../lib/auth.js');const partial=await login(store,{email:admin.email,password:'SyntheticMentor123!'},'192.0.2.91',new Date());
   assert.equal((await call('v1/follow-ups','GET',{},partial)).body.error.code,'MFA_REQUIRED');
  });
  await t.test('bounded pages and today data expose only assigned donor work',async()=>{
   const page=await call('v1/follow-ups','GET',{limit:'1'},boardSession);assert.equal(page.statusCode,200);assert.equal(page.body.data.items.length,1);assert.equal(page.body.data.has_more,true);assert.equal(JSON.stringify(page.body).includes('Private outside'),false);
   const overview=await call('v1/overview','GET',{on:'2026-11-14',time_zone:'America/Phoenix',limit:'1'},boardSession);assert.equal(overview.statusCode,200);assert.equal(overview.body.data.counts.due_today,2);assert.equal(overview.body.data.counts.unassigned_donors,0);assert.equal(overview.body.data.tasks.has_more,true);
   assert.equal((await call(`donors/${other.id}`,'GET',{},boardSession)).statusCode,403);
   assert.equal((await call('v1/follow-ups','GET',{limit:'101'},boardSession)).statusCode,400);
   assert.equal((await call('v1/overview','GET',{on:'2026-02-30'},adminSession)).statusCode,400);
   assert.equal((await call('v1/overview','GET',{on:'2026-11-14',time_zone:'untrusted'},adminSession)).statusCode,400);
  });
  await t.test('GET exports create no records, reject writes and keep import history private',async()=>{
   const upload={filename:'synthetic-read.csv',source:'generic',content_base64:Buffer.from('Name,Email\nSynthetic preview,preview@example.test').toString('base64')};
   const batch=await tx(q=>previewImport(q,upload,admin));
   const before=(await db.query('SELECT count(*)::int AS n FROM audit_events')).rows[0].n;
   for(const route of ['v1/follow-ups','v1/campaign-summaries','v1/overview','imports/history'])assert.equal((await call(route,'GET',route==='v1/overview'?{on:'2026-11-14'}:{},adminSession)).statusCode,200);
   const detail=await call(`imports/${batch.batch_id}`,'GET',{},adminSession);assert.equal(detail.statusCode,200);assert.equal(detail.body.data.rows.items.length,1);assert.equal(JSON.stringify(detail.body).includes('preview@example.test'),false);
   assert.equal((await call('imports/history','GET',{},boardSession)).statusCode,403);
   for(const route of ['v1/follow-ups','v1/campaign-summaries','v1/overview','imports/history','v1/openapi'])assert.equal((await call(route,'POST',{},adminSession)).statusCode,405);
   assert.equal((await db.query('SELECT count(*)::int AS n FROM audit_events')).rows[0].n,before);
  });
  await t.test('existing machine bearer credential exposes aggregates, never donor PII or donor access',async()=>{
   const previous=process.env.REPORTING_API_KEY,key=randomBytes(32).toString('hex');process.env.REPORTING_API_KEY=key;
   try{
    const input={from:'2026-01-01',to:'2026-12-31'},res=await call('v1/metrics','GET',input,undefined,{authorization:`Bearer ${key}`});assert.equal(res.statusCode,200);assert.equal(res.body.data.giftTotal,50);assert.equal(res.body.data.donorTotal,2);
    const body=JSON.stringify(res.body);for(const forbidden of ['private-outside@example.test','Private outside donor',own.id,other.id])assert.equal(body.includes(forbidden),false);
    assert.equal((await call('donors','GET',{},undefined,{authorization:`Bearer ${key}`})).statusCode,401);
    assert.equal((await call('v1/metrics','GET',input,undefined,{authorization:'Bearer invalid'})).statusCode,401);
   }finally{if(previous===undefined)delete process.env.REPORTING_API_KEY;else process.env.REPORTING_API_KEY=previous;}
  });
  await t.test('manual mutation contracts still reject bad CSRF and board merge attempts',async()=>{
   assert.equal((await call('donors','POST',{display_name:'Synthetic rejected'},adminSession,{'x-csrf-token':'invalid'})).statusCode,403);
   assert.equal((await call('merges/preview','POST',{canonical_donor_id:own.id,merged_donor_id:other.id,reason:'Synthetic check'},boardSession)).statusCode,403);
   const created=await call('donors','POST',{display_name:'Synthetic API manual',idempotency_key:'api-donor-001'},adminSession);assert.equal(created.statusCode,201);
   const donated=await call('donations','POST',{donor_id:created.body.data.id,amount:'10',donation_date:'2026-11-14',source:'offline',currency:'USD',status:'completed',idempotency_key:'api-gift-001'},adminSession);assert.equal(donated.statusCode,201);
  });
 }finally{await db.close();}
});

test('OpenAPI documents real GET-only contracts, security schemes and resolvable schemas',()=>{
 assert.equal(spec.openapi,'3.1.1');assert.equal(spec.components.securitySchemes.SessionCookie.name,'__Host-colorloop');assert.equal(spec.components.securitySchemes.ReportingBearer.scheme,'bearer');
 for(const [path,item] of Object.entries(spec.paths)){assert.deepEqual(Object.keys(item),['get'],path);assert.ok(item.get.responses['200']);assert.ok(item.get.operationId);if(path!=='/v1/openapi')assert.ok(item.get.security.length);}
 const walk=value=>{if(!value||typeof value!=='object')return;if(value.$ref){assert.ok(value.$ref.startsWith('#/'));assert.ok(value.$ref.slice(2).split('/').reduce((a,k)=>a?.[k],spec),value.$ref);}for(const v of Object.values(value))walk(v);};walk(spec);
});
