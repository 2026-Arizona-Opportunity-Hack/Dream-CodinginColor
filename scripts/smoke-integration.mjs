import assert from 'node:assert/strict';
import { request as httpsRequest } from 'node:https';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createIsolatedDatabase } from '../lib/isolated-database.js';
import { migrate } from '../lib/database-setup.js';
import { initializeSyntheticDemo } from '../lib/demo-data.js';
import { startServer } from './dev.js';
import { createApiClient } from '../public/js/api.js';
import { buildStatic } from './build-static.js';

const directory=await mkdtemp(join(tmpdir(),'colorloop-smoke-'));
const database=await createIsolatedDatabase();let server;
const password=randomBytes(24).toString('hex');
try {
  await database.transaction(migrate);
  const store=await initializeSyntheticDemo(database,password);
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-keyout',join(directory,'tls.key'),'-out',join(directory,'tls.crt')],{stdio:'ignore'});
  const key=await readFile(join(directory,'tls.key')),cert=await readFile(join(directory,'tls.crt'));
  // Reserve a real origin first; each request still receives exact same-origin/CSRF checks.
  const staticBuild=await buildStatic(join(directory,'dist'));
  server=await startServer({database,store,port:0,tls:{key,cert},origin:'https://localhost',staticRoot:staticBuild.output});
  const base=`https://127.0.0.1:${server.address().port}`;
  let cookie='';
  const fetcher=(path,options={})=>new Promise((resolve,reject)=>{
    const req=httpsRequest(`${base}${path}`,{method:options.method||'GET',rejectUnauthorized:false,
      headers:{...options.headers,Origin:'https://localhost',...(cookie?{Cookie:cookie}:{})}},res=>{
      if(res.headers['set-cookie'])cookie=res.headers['set-cookie'][0].split(';')[0];
      let data='';res.on('data',chunk=>data+=chunk);res.on('end',()=>resolve({ok:res.statusCode>=200&&res.statusCode<300,status:res.statusCode,headers:res.headers,text:async()=>data,json:async()=>JSON.parse(data)}));
    });req.on('error',reject);req.end(options.body);
  });
  const api=createApiClient(fetcher);
  assert.equal((await fetcher('/')).status,200);
  for(const asset of ['/public/js/app.js','/public/js/api.js','/public/js/account-forms.js','/public/css/app.css'])assert.equal((await fetcher(asset)).status,200);
  for(const privatePath of ['/lib/auth.js','/.env','/db/migrations/002_relationship_security.sql','/package.json'])assert.equal((await fetcher(privatePath)).status,404);
  await assert.rejects(api('/donors'),e=>e.status===401);
  const me=await api('/auth/login',{method:'POST',body:{email:'admin@example.test',password}});
  assert.equal(me.administrator,undefined); // Login returns a public account; /me supplies permissions.
  assert.ok((await api('/auth/me')).permissions.includes('reports.read'));
  const donor=await api('/donors',{method:'POST',body:{name:'Synthetic HTTP donor',email:'http@example.test'}});
  assert.ok(donor.assigned_board_member_id);
  const list=await api('/donors?search=Synthetic HTTP');assert.equal(list[0].name,'Synthetic HTTP donor');
  await api(`/donors/${donor.id}`,{method:'PATCH',body:{name:'Synthetic HTTP donor',email:'http@example.test',email_consent:true}});
  await api(`/donors/${donor.id}/donations`,{method:'POST',body:{amount:'123.45',donated_at:'2024-01-01',source:'synthetic-http',currency:'USD',status:'completed'}});
  assert.equal((await api(`/donors/${donor.id}/donations`))[0].currency,'USD');
  const members=await api('/board-members');
  await api('/tasks',{method:'POST',body:{title:'Synthetic HTTP follow-up',donor_id:donor.id,assignee_id:members[0].id,due_date:'2026-11-20'}});
  const tasks=await api('/tasks');const task=tasks.find(t=>t.donor_id===donor.id);
  await api(`/tasks/${task.id}`,{method:'PATCH',body:{status:'completed'}});
  assert.equal((await api('/tasks?status=open')).some(t=>t.id===task.id),false);
  await api('/activities',{method:'POST',body:{donor_id:donor.id,note:'Synthetic HTTP note',type:'call'}});
  assert.equal((await api(`/activities?donorId=${donor.id}`))[0].type,'call');
  await api('/outreach/drafts',{method:'POST',body:{donor_id:donor.id,type:'thank_you'}});
  const drafts=await api('/outreach/drafts'),draft=drafts.find(d=>d.donorId===donor.id);
  await assert.rejects(api(`/outreach/drafts/${draft.id}/send`,{method:'POST'}),e=>e.status===409);
  await api(`/outreach/drafts/${draft.id}/approve`,{method:'POST'});
  await assert.rejects(api(`/outreach/drafts/${draft.id}/send`,{method:'POST'}),e=>e.status===503&&e.code==='DRAFT_MODE');
  assert.equal((await api('/outreach/history')).length,0);
  const year=new Date().getUTCFullYear(),report=await api(`/reports/retention?from=${year}-01-01&to=${year}-12-31`);
  assert.ok(report.giftTotal>0);
  const funder=await api(`/reports/funder?donorId=${donor.id}&from=2024-01-01&to=2024-12-31`);
  assert.equal(funder.gifts[0].amount,123.45);assert.deepEqual(funder.outcomes,[]);
  assert.ok((await api('/retention/at-risk')).some(d=>d.donorId===donor.id));
  await api('/retention/at-risk',{method:'POST',body:{donorId:donor.id}});
  await api('/outreach/drafts',{method:'POST',body:{type:'quarterly_board_summary'}});
  await api('/custom-fields',{method:'POST',body:{label:'Synthetic interest',type:'text',options:[],active:true,hidden:false}});
  const fields=await api('/custom-fields');assert.equal(fields[0].type,'text');
  await api(`/donors/${donor.id}`); // Refresh field definitions and donor edit snapshot.
  await api(`/donors/${donor.id}`,{method:'PATCH',body:{custom_fields:{[fields[0].id]:'STEM'}}});
  assert.equal((await api(`/donors/${donor.id}`)).custom_fields[fields[0].id],'STEM');
  await api('/campaigns',{method:'POST',body:{name:'Synthetic HTTP campaign'}});
  assert.ok((await api('/campaigns')).some(c=>c.name==='Synthetic HTTP campaign'));
  const upload=new FormData();upload.set('source','synthetic-http');upload.set('file',new File(['Name,Email,Amount,Date,Currency,Status,Transaction ID\nSynthetic HTTP import,import-http@example.test,20.00,2024-02-01,USD,completed,http-gift-1'],'synthetic.csv'));
  const inspected=await api('/imports/preview',{method:'POST',body:upload});
  const preview=await api('/imports/preview',{method:'POST',body:{importId:inspected.importId,mapping:{name:'Name',email:'Email',amount:'Amount',donated_at:'Date',currency:'Currency',status:'Status',external_transaction_id:'Transaction ID'}}});
  assert.deepEqual(preview.errors,[]);
  const imported=await api('/imports/confirm',{method:'POST',body:{importId:preview.importId}});
  assert.equal(imported.rows.length,1);
  assert.deepEqual(await api('/imports/confirm',{method:'POST',body:{importId:preview.importId}}),imported);
  await api('/auth/logout',{method:'POST',body:{}});
  await assert.rejects(api('/auth/me'),e=>e.status===401);
  console.log('PASS: real HTTPS + SQL + browser API adapter: sessions, CSRF, donors, gifts, tasks, activities, reviewed outreach, radar, reports, custom fields, campaigns and imports. No live database or delivery provider used.');
} finally {
  if(server)await new Promise(resolve=>server.close(resolve));
  await database.close();await rm(directory,{recursive:true,force:true});
}
