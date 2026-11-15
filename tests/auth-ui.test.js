import test from 'node:test';
import assert from 'node:assert/strict';
import {createApiClient} from '../public/js/api.js';
const reply=(status,data,error)=>({ok:status<400,status,json:async()=>error?{error}:{data}});

test('expired sessions clear cached CSRF and notify the UI; login errors stay on the sign-in form',async()=>{
 const calls=[];let expired=0;
 const client=createApiClient(async(path,options)=>{
  calls.push({path,...options});
  if(path==='/api/auth/login'){
   if(JSON.parse(options.body).password==='incorrect')return reply(401,null,{code:'INVALID_CREDENTIALS',message:'Invalid email or password.'});
   return reply(200,{user:{id:'synthetic-user'},csrfToken:'synthetic-csrf'});
  }
  return reply(401,null,{code:'UNAUTHENTICATED',message:'Please sign in.'});
 },{onUnauthorized:()=>expired++});
 await assert.rejects(client('/auth/login',{method:'POST',body:{email:'synthetic@example.test',password:'incorrect'}}),{status:401});
 assert.equal(expired,0);
 await client('/auth/login',{method:'POST',body:{email:'synthetic@example.test',password:'synthetic password'}});
 await assert.rejects(client('/users'),{status:401});assert.equal(expired,1);
 await assert.rejects(client('/users',{method:'POST',body:{}}),{status:401});
 assert.equal(calls.at(-1).path,'/api/auth/me');assert.equal(calls.at(-1).headers['X-CSRF-Token'],undefined);
 assert.ok(calls.every(call=>call.credentials==='same-origin'));
 assert.equal(calls.filter(call=>call.path==='/api/users'&&call.method==='POST').length,0);
});

test('late responses from a previous session cannot restore cached data or expire a newer session',async()=>{
 let complete;let expired=0;const requests=[];
 const client=createApiClient(async(path,options)=>{
  requests.push({path,...options});
  if(path==='/api/users')return new Promise(resolve=>{complete=resolve;});
  if(path==='/api/auth/me')return reply(200,{user:{id:'synthetic-user'},csrfToken:'synthetic-csrf'});
  if(path==='/api/auth/logout')return reply(200,{loggedOut:true});
  return reply(200,{user:{id:'new-synthetic-user'},csrfToken:'new-synthetic-csrf'});
 },{onUnauthorized:()=>expired++});
 const oldRequest=client('/users');
 const rejected=assert.rejects(oldRequest,{code:'STALE_SESSION'});
 await client('/auth/logout',{method:'POST'});
 await client('/auth/login',{method:'POST',body:{email:'new@example.test',password:'synthetic password'}});
 complete(reply(401,null,{code:'UNAUTHENTICATED',message:'Expired old session'}));await rejected;
 assert.equal(expired,0);
 const logout=requests.find(r=>r.path==='/api/auth/logout');assert.equal(logout.method,'POST');assert.equal(logout.headers['X-CSRF-Token'],'synthetic-csrf');
});

test('permission failures do not sign the user out',async()=>{
 let expired=0;
 const client=createApiClient(async()=>reply(403,null,{code:'FORBIDDEN',message:'Insufficient permission.'}),{onUnauthorized:()=>expired++});
 await assert.rejects(client('/users'),{status:403});assert.equal(expired,0);
});
