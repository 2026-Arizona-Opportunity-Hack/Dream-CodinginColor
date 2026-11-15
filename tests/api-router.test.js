import test from 'node:test';
import assert from 'node:assert/strict';
import {createRouter} from '../lib/api-router.js';
import {createMemoryStore} from '../lib/retention-store.js';
import {preparationJob} from '../lib/preparation-job.js';
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(value){this.body=value;return this;}});
const id='50000000-0000-4000-8000-000000000001';
test('consolidated dispatcher preserves protected URLs and methods without database access before auth',async()=>{
 const router=createRouter({store:createMemoryStore(),database:{transaction(){assert.fail('Unauthenticated requests cannot access donor SQL');}}});
 const routes={donors:['GET','POST'],[`donors/${id}`]:['GET','PATCH'],[`donors/${id}/donations`]:['GET'],donations:['POST'],[`donations/${id}`]:['PATCH'],'imports/preview':['POST'],'imports/confirm':['POST'],'merges/candidates':['GET'],merges:['POST'],'custom-fields':['GET','POST'],[`custom-fields/${id}`]:['PATCH'],campaigns:['GET','POST'],[`campaigns/${id}`]:['PATCH'],outcomes:['POST'],'auth/me':['GET'],'auth/logout':['POST'],users:['GET','POST','PATCH'],roles:['GET','POST','PATCH'],'roles/retire':['POST'],assignments:['GET','POST'],'assignments/balance':['POST'],'assignments/members':['GET'],activities:['GET','POST','PATCH'],tasks:['GET','POST','PATCH'],'tasks/reminders':['POST'],'outreach/templates':['GET','POST'],'outreach/drafts':['GET','POST','PATCH'],'outreach/approve':['POST'],'outreach/send':['POST'],'outreach/handoff':['POST'],'outreach/confirm-manual':['POST'],'outreach/history':['GET'],'retention/at-risk':['GET','POST'],'retention/settings':['GET','PATCH']};
 for(const [route,methods] of Object.entries(routes)){
  for(const method of methods){const res=response();await router({method,query:{route},headers:{}},res);assert.equal(res.statusCode,401,`${method} ${route}`);}
  const res=response();await router({method:'DELETE',query:{route},headers:{}},res);assert.equal(res.statusCode,405,route);
 }
 for(const route of ['unknown','donors/../users',['auth','me'],'donors/%2fusers']){const res=response();await router({method:'GET',query:{route},headers:{}},res);assert.equal(res.statusCode,404);}
});
test('scheduled preparation requires its separate machine credential and a genuine authorized account',async()=>{
 const secret='synthetic-job-credential-with-at-least-32-characters';
 const store=createMemoryStore({users:[{id:'operator',roleId:'preparer',active:true},{id:'member',active:true,boardMember:true,email:'board@example.test'}],roles:[{id:'preparer',permissions:['tasks.manage','outreach.write']}],donors:[{id:'donor',name:'Synthetic donor',active:true}],assignments:[{id:'assignment',donorId:'donor',assigneeId:'member',active:true}]});
 const call=async(headers,userId='operator')=>{const res=response();await preparationJob({method:'GET',headers},res,{secret,userId,store,now:new Date('2026-11-14T18:00:00Z')});return res;};
 assert.equal((await call({})).statusCode,401);assert.equal((await call({authorization:`Bearer ${secret}`},'missing')).statusCode,403);
 const result=await call({authorization:`Bearer ${secret}`});assert.equal(result.statusCode,200);assert.equal(result.body.data.messagesSent,0);assert.equal(result.body.data.quarterlyDonorDrafts,1);
 await call({authorization:`Bearer ${secret}`});assert.equal((await store.read(s=>s.drafts)).length,2);assert.equal((await store.read(s=>s.tasks)).length,1);
});
