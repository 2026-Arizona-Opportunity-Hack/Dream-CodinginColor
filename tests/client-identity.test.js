import test from 'node:test';
import assert from 'node:assert/strict';
import {clientIdentity} from '../lib/client-identity.js';
import {createMemoryStore} from '../lib/retention-store.js';
import {login} from '../lib/auth.js';
import {digest} from '../lib/permissions.js';
import {now} from './retention-support.js';
const request=(ip,headers={})=>({socket:{remoteAddress:ip},headers});

test('direct clients cannot forge network identity using proxy headers',()=>{
 const forged={'x-forwarded-for':'203.0.113.99','x-vercel-forwarded-for':'203.0.113.98','x-real-ip':'203.0.113.97','x-vercel-id':'spoof'};
 assert.equal(clientIdentity(request('192.0.2.1',forged),{vercel:false}),'192.0.2.1');
 assert.equal(clientIdentity(request('::ffff:192.0.2.1'),{vercel:false}),'192.0.2.1');
 assert.equal(clientIdentity(request('2001:0db8:0:0:0:0:0:1'),{vercel:false}),'2001:db8::1');
 assert.throws(()=>clientIdentity(request(undefined,forged),{vercel:false}),e=>e.code==='CLIENT_IDENTITY_UNAVAILABLE');
});
test('Vercel uses its ingress-owned address and fails closed for missing, duplicate or invalid values',()=>{
 assert.equal(clientIdentity(request('10.0.0.1',{'x-vercel-forwarded-for':'192.0.2.1','x-forwarded-for':'203.0.113.5'}),{vercel:true}),'192.0.2.1');
 assert.equal(clientIdentity(request('10.0.0.1',{'x-vercel-forwarded-for':'192.0.2.2'}),{vercel:true}),'192.0.2.2');
 for(const value of [undefined,'unknown','192.0.2.1, 203.0.113.5',['192.0.2.1','192.0.2.2']]) {
  assert.throws(()=>clientIdentity(request('10.0.0.1',{'x-vercel-forwarded-for':value}),{vercel:true}),e=>e.code==='CLIENT_IDENTITY_UNAVAILABLE');
 }
});
test('a throttled client cannot evade its limit, other clients remain usable, and account throttling remains shared',async()=>{
 const store=createMemoryStore({loginAttempts:Array.from({length:25},()=>({networkKey:digest('192.0.2.1'),accountKey:digest('other@example.test'),at:now.toISOString()}))});
 const first=clientIdentity(request('10.0.0.1',{'x-vercel-forwarded-for':'192.0.2.1','x-forwarded-for':'203.0.113.9'}),{vercel:true});
 await assert.rejects(login(store,{email:'missing@example.test',password:'wrong'},first,now),e=>e.code==='RATE_LIMITED');
 const second=clientIdentity(request('10.0.0.1',{'x-vercel-forwarded-for':'192.0.2.2'}),{vercel:true});
 await assert.rejects(login(store,{email:'missing@example.test',password:'wrong'},second,now),e=>e.code==='INVALID_CREDENTIALS');
 await store.transaction(s=>{s.loginAttempts=Array.from({length:5},()=>({networkKey:digest('192.0.2.1'),accountKey:digest('locked@example.test'),at:now.toISOString()}));});
 await assert.rejects(login(store,{email:'locked@example.test',password:'wrong'},second,now),e=>e.code==='RATE_LIMITED');
});
