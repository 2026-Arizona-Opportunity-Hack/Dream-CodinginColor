import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createIsolatedDatabase} from '../lib/isolated-database.js';
import {migrate} from '../lib/database-setup.js';
import {createSqlStore} from '../lib/retention-sql-store.js';
import {bootstrapAdministrator,login,saveUser} from '../lib/auth.js';
import {startEnrollment,completeEnrollment,verifySecondFactor,changeSecurity,requestAccount,reviewAccountRequest} from '../lib/account-security.js';
import {authenticator,decryptTotp} from '../lib/totp.js';
import {createHandler} from '../lib/retention-api.js';
import {createRouter} from '../lib/api-router.js';
const password='SyntheticSecurity123!',now=new Date('2026-11-14T18:00:00Z'),origin='https://colorloop.example';
const reqFor=session=>({headers:{cookie:`__Host-colorloop=${session.token}`,'x-csrf-token':session.csrfToken,origin},socket:{remoteAddress:'192.0.2.30'}});
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(value){this.body=value;this.headersSent=true;return this;}});
const codeFor=(user,at,pending=false)=>authenticator(decryptTotp(pending?user.totpPendingCiphertext:user.totpSecretCiphertext,user.id),user.email).generate({timestamp:+at});

test('real mandatory MFA, encrypted storage, replay, recovery, reauthentication, approval and API boundaries',async(t)=>{
 process.env.MFA_ENCRYPTION_KEY=randomBytes(32).toString('base64');const db=await createIsolatedDatabase();
 try{
  await db.transaction(migrate);const store=createSqlStore(db),admin={...await bootstrapAdministrator(store,{name:'Synthetic security admin',email:'security@example.test',password},now),administrator:true};
  let partial=await login(store,{email:admin.email,password},'192.0.2.30',now),full,codes;
  const call=async(route,method,input,session,at=now)=>{const req={...reqFor(session),method,body:input,query:input};const res=response();await createHandler(route,{store,origin,now:()=>at})(req,res);return res;};
  await t.test('password-only sessions cannot access protected routes or skip CSRF during enrollment',async()=>{
   assert.equal(partial.authentication,'enrollment_required');
   const res=await call('auth/me','GET',{},partial);assert.equal(res.body.data.authentication,'enrollment_required');assert.deepEqual(res.body.data.user.permissions,[]);
   const router=createRouter({database:db,store,origin,now:()=>now});
   for(const route of ['donors','tasks','users','reports/retention']){const req={...reqFor(partial),method:'GET',query:{route}};const denied=response();await router(req,denied);assert.equal(denied.statusCode,403,route);assert.equal(denied.body.error.code,'MFA_REQUIRED');}
   const req={...reqFor(partial),method:'POST',body:{currentPassword:password}};delete req.headers['x-csrf-token'];const denied=response();await createHandler('auth/mfa/enroll',{store,origin,now:()=>now})(req,denied);assert.equal(denied.statusCode,403);
  });
  await t.test('QR enrollment requires password and a genuine TOTP; secrets stay encrypted in PostgreSQL',async()=>{
   await assert.rejects(startEnrollment(store,reqFor(partial),{currentPassword:'wrong'},'192.0.2.30',now),{code:'REAUTHENTICATION_FAILED'});
   const setup=await startEnrollment(store,reqFor(partial),{currentPassword:password},'192.0.2.30',now);assert.ok(setup.qrDataUrl.startsWith('data:image/png;base64,'));assert.equal(setup.secret,undefined);
   const user=await store.read(s=>s.users.find(u=>u.id===admin.id));const secret=decryptTotp(user.totpPendingCiphertext,user.id);
   assert.ok(user.totpPendingCiphertext.startsWith('v1.'));assert.notEqual(user.totpPendingCiphertext,secret);
   await assert.rejects(completeEnrollment(store,reqFor(partial),{code:'not-a-code'},'192.0.2.30',now),{code:'INVALID_FACTOR'});
   full=await completeEnrollment(store,reqFor(partial),{code:codeFor(user,now,true)},'192.0.2.30',now);codes=full.recoveryCodes;
   assert.equal(full.authentication,'authenticated');assert.equal(codes.length,10);
   const stored=await store.read(s=>s.users.find(u=>u.id===admin.id));assert.equal(stored.totpEnabled,true);assert.equal(stored.totpPendingCiphertext,null);assert.ok(stored.recoveryHashes.every(h=>!codes.includes(h)));
   assert.throws(()=>decryptTotp(stored.totpSecretCiphertext,'different-user'),{code:'MFA_UNAVAILABLE'});
   const status=await call('account/security','GET',{},full);assert.equal(status.body.data.enabled,true);assert.equal(status.body.data.recoveryCodesRemaining,10);
   assert.equal(JSON.stringify(status.body).includes(secret),false);assert.equal(JSON.stringify(status.body).includes(codes[0]),false);
   assert.equal((await call('auth/me','GET',{},full)).statusCode,200);
   assert.equal((await call('auth/me','GET',{},partial)).statusCode,401);
  });
  await t.test('login challenges reject replay; recovery codes are consumed atomically once',async()=>{
   partial=await login(store,{email:admin.email,password},'192.0.2.30',now);assert.equal(partial.authentication,'verification_required');
   const user=await store.read(s=>s.users.find(u=>u.id===admin.id));
   await assert.rejects(verifySecondFactor(store,reqFor(partial),{code:codeFor(user,now)},'192.0.2.30',now),{code:'INVALID_FACTOR'});
   const sessions=await Promise.all([login(store,{email:admin.email,password},'192.0.2.31',now),login(store,{email:admin.email,password},'192.0.2.32',now)]);
   const results=await Promise.allSettled(sessions.map(session=>verifySecondFactor(store,reqFor(session),{recoveryCode:codes[0]},'192.0.2.30',now)));
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
   assert.equal((await store.read(s=>s.users.find(u=>u.id===admin.id))).recoveryHashes.length,9);
  });
  await t.test('profile edits cannot escalate roles; password changes require reauthentication and revoke other sessions',async()=>{
   assert.equal((await call('account/profile','PATCH',{name:'Updated synthetic admin'},full)).statusCode,200);
   assert.equal((await call('account/profile','PATCH',{name:'Unsafe',roleId:'administrator'},full)).statusCode,400);
   const changed=await changeSecurity(store,reqFor(full),{currentPassword:password,newPassword:'NewSyntheticPassword123!',recoveryCode:codes[1]},'192.0.2.30',now,'password');
   assert.equal((await call('auth/me','GET',{},full)).statusCode,401);full=changed;
   assert.equal((await call('auth/me','GET',{},full)).statusCode,200);
  });
  await t.test('public signup never grants access; approval cannot grant administrator',async()=>{
   const input={name:'Synthetic applicant',email:'applicant@example.test',password};
   await requestAccount(store,input,'192.0.2.40',now);assert.equal((await store.read(s=>s.users)).length,1);
   await assert.rejects(requestAccount(store,{...input,roleId:'administrator'},'192.0.2.40',now));
   const pending=await store.read(s=>s.accountRequests[0]);
   await assert.rejects(reviewAccountRequest(store,admin,{id:pending.id,decision:'approve',roleId:'administrator'},now));
   await reviewAccountRequest(store,admin,{id:pending.id,decision:'approve',roleId:'board-member'},now);
   const applicant=await login(store,{email:input.email,password},'192.0.2.40',now);assert.equal(applicant.authentication,'enrollment_required');assert.equal((await call('tasks','GET',{},applicant)).statusCode,403);
   assert.equal((await store.read(s=>s.accountRequests[0])).passwordHash,null);
  });
  await t.test('secure reset revokes full access and requires fresh enrollment; old recovery codes stop working',async()=>{
   const reset=await changeSecurity(store,reqFor(full),{currentPassword:'NewSyntheticPassword123!',recoveryCode:codes[2]},'192.0.2.30',now,'disable');
   assert.equal(reset.authentication,'enrollment_required');assert.equal((await call('tasks','GET',{},reset)).statusCode,403);
   const user=await store.read(s=>s.users.find(u=>u.id===admin.id));assert.equal(user.totpSecretCiphertext,null);assert.deepEqual(user.recoveryHashes,[]);
  });
 }finally{await db.close();}
});

test('verification failures reserve durable rate-limit attempts instead of rolling them back',async()=>{
 process.env.MFA_ENCRYPTION_KEY=randomBytes(32).toString('base64');const db=await createIsolatedDatabase();
 try{
  await db.transaction(migrate);const store=createSqlStore(db);await bootstrapAdministrator(store,{name:'Synthetic limited admin',email:'limited@example.test',password},now);
  const partial=await login(store,{email:'limited@example.test',password},'192.0.2.50',now);
  await startEnrollment(store,reqFor(partial),{currentPassword:password},'192.0.2.50',now);
  for(let i=0;i<8;i++)await assert.rejects(completeEnrollment(store,reqFor(partial),{code:'invalid'},'192.0.2.50',now),{code:'INVALID_FACTOR'});
  await assert.rejects(completeEnrollment(store,reqFor(partial),{code:'invalid'},'192.0.2.51',now),{code:'RATE_LIMITED'});
  assert.equal((await db.query("SELECT count(*)::int AS n FROM security_attempts WHERE purpose='second-factor'")).rows[0].n,8);
 }finally{await db.close();}
});

test('fresh login TOTP, recovery rotation, administrator recovery and fail-closed encryption',async()=>{
 process.env.MFA_ENCRYPTION_KEY=randomBytes(32).toString('base64');const db=await createIsolatedDatabase();
 try{
  await db.transaction(migrate);const store=createSqlStore(db);
  const admin={...await bootstrapAdministrator(store,{name:'Synthetic recovery admin',email:'recovery-admin@example.test',password},now),administrator:true};
  const target=await saveUser(store,admin,{name:'Synthetic recovery member',email:'recovery-member@example.test',password,roleId:'board-member'},now);
  async function enroll(user){
   const partial=await login(store,{email:user.email,password},'192.0.2.70',now);
   await startEnrollment(store,reqFor(partial),{currentPassword:password},'192.0.2.70',now);
   const stored=await store.read(s=>s.users.find(u=>u.id===user.id));
   return completeEnrollment(store,reqFor(partial),{code:codeFor(stored,now,true)},'192.0.2.70',now);
  }
  const member=await enroll(target),adminSession=await enroll(admin),later=new Date(+now+30000);
  const {updatePreferences}=await import('../lib/account-security.js');
  await assert.rejects(updatePreferences(store,{...target,permissions:[]},{startPage:'reports',timeZone:'UTC'},now),{code:'FORBIDDEN'});
  const partial=await login(store,{email:admin.email,password},'192.0.2.71',later);
  let stored=await store.read(s=>s.users.find(u=>u.id===admin.id));
  const verified=await verifySecondFactor(store,reqFor(partial),{code:codeFor(stored,later)},'192.0.2.71',later);
  assert.equal(verified.authentication,'authenticated');
  await assert.rejects(saveUser(store,admin,{id:admin.id,password:'BypassPassword123!'},later,true),{code:'REAUTHENTICATION_REQUIRED'});
  await assert.rejects(changeSecurity(store,reqFor(verified),{currentPassword:'incorrect',recoveryCode:adminSession.recoveryCodes[0]},'192.0.2.71',later,'recovery'),{code:'REAUTHENTICATION_FAILED'});
  const rotated=await changeSecurity(store,reqFor(verified),{currentPassword:password,recoveryCode:adminSession.recoveryCodes[0]},'192.0.2.71',later,'recovery');
  assert.equal(rotated.recoveryCodes.length,10);
  const challenge=await login(store,{email:admin.email,password},'192.0.2.72',later);
  await assert.rejects(verifySecondFactor(store,reqFor(challenge),{recoveryCode:adminSession.recoveryCodes[1]},'192.0.2.72',later),{code:'INVALID_FACTOR'});
  await assert.rejects(changeSecurity(store,reqFor(member),{currentPassword:password,recoveryCode:member.recoveryCodes[0],userId:admin.id,reason:'Synthetic identity check'},'192.0.2.73',later,'reset'),{code:'ADMINISTRATOR_REQUIRED'});
  await assert.rejects(changeSecurity(store,reqFor(verified),{currentPassword:password,recoveryCode:rotated.recoveryCodes[0],userId:admin.id,reason:'Synthetic identity check'},'192.0.2.71',later,'reset'));
  await changeSecurity(store,reqFor(verified),{currentPassword:password,recoveryCode:rotated.recoveryCodes[0],userId:target.id,reason:'Synthetic offline identity verification'},'192.0.2.71',later,'reset');
  const state=await store.read(s=>s);assert.equal(state.sessions.some(s=>s.userId===target.id),false);assert.equal(state.users.find(u=>u.id===target.id).totpEnabled,false);
  assert.ok(state.audit.some(a=>a.action==='security.admin-reset'&&a.entityId===target.id));
  const targetLogin=await login(store,{email:target.email,password},'192.0.2.73',later);assert.equal(targetLogin.authentication,'enrollment_required');
  stored=await store.read(s=>s.users.find(u=>u.id===admin.id));const key=process.env.MFA_ENCRYPTION_KEY;delete process.env.MFA_ENCRYPTION_KEY;
  assert.throws(()=>decryptTotp(stored.totpSecretCiphertext,admin.id),{code:'MFA_UNCONFIGURED'});
  process.env.MFA_ENCRYPTION_KEY=key;
  const pending=await startEnrollment(store,reqFor(targetLogin),{currentPassword:password},'192.0.2.73',later);
  assert.ok(pending.expiresAt);
  await assert.rejects(completeEnrollment(store,reqFor(targetLogin),{code:'123456'},'192.0.2.73',new Date(+later+5*60000)),{code:'UNAUTHENTICATED'});
 }finally{await db.close();}
});
