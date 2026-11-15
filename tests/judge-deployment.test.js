import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {judgeDeploymentConfig,fingerprint,normalizedDatabaseHost,guardJudgeDatabase} from '../lib/judge-deployment.js';
import {provisionJudgeDatabase,JUDGE_PERMISSIONS} from '../lib/judge-provision.js';
import {createIsolatedDatabase} from '../lib/isolated-database.js';
import {createSqlStore} from '../lib/retention-sql-store.js';
import {createRouter} from '../lib/api-router.js';
import {createEmailProvider} from '../lib/email-provider.js';
import {preparationJob} from '../lib/preparation-job.js';
import {bootstrapAdministrator,login} from '../lib/auth.js';
import {migrate} from '../lib/database-setup.js';
import {signIn} from './auth-support.js';
import {provisioningDiagnostic} from '../lib/judge-diagnostics.js';
const protectedMain={databaseHostHash:fingerprint('ep-protected.neon.tech'),mfaKeyHash:fingerprint(Buffer.alloc(32,1)),origin:'https://main.synthetic.test',projectId:'prj_main'};
const environment=()=>({COLORLOOP_ENVIRONMENT:'judge',JUDGE_DATABASE_URL:'postgresql://synthetic:synthetic-password@ep-judge-pooler.neon.tech/neondb',JUDGE_DATABASE_HOST:'ep-judge-pooler.neon.tech',JUDGE_ENVIRONMENT_ID:randomUUID(),MFA_ENCRYPTION_KEY:process.env.MFA_ENCRYPTION_KEY,APP_ORIGIN:'https://judge.synthetic.test',EMAIL_DELIVERY_MODE:'disabled',EMAIL_CRON_ENABLED:'false',CIC_DONOR_AUTOMATION_APPROVED:'false'});
const account=name=>({name,email:`${randomUUID()}@judge.invalid`,password:'Aa1!'+randomBytes(24).toString('base64url')});
const accounts=()=>({operator:account('Synthetic private operator'),judges:[account('Synthetic Judge One'),account('Synthetic Judge Two')],boards:[account('Synthetic Board A'),account('Synthetic Board B'),account('Synthetic Board C')]});
const response=()=>({setHeader(){},status(code){this.statusCode=code;return this;},json(body){this.body=body;this.headersSent=true;return this;}});
test('password policy fails at the exact private account before any database access',async()=>{
 const input=accounts();input.judges[1].password='LongWithoutDigitsOrSymbols';let touched=false;
 await assert.rejects(provisionJudgeDatabase({transaction(){touched=true;}},{},input),error=>{
  assert.deepEqual(error.provisionDiagnostic,{code:'JUDGE_PASSWORD_POLICY',stage:'accounts.judge.2',message:'Use 20–128 characters with uppercase, lowercase, a digit and a special character.'});return true;
 });assert.equal(touched,false);
});
test('diagnostics discard secret-bearing messages, details, stacks and queries',()=>{
 const secret='synthetic-private-credential';const diagnostic=provisioningDiagnostic({code:'23505',message:secret,detail:secret,stack:secret,query:secret},'seed.gifts');
 assert.deepEqual(Object.keys(diagnostic),['code','stage','message']);assert.doesNotMatch(JSON.stringify(diagnostic),new RegExp(secret));
 assert.equal(provisioningDiagnostic({code:secret,message:secret},secret).code,'PROVISION_FAILED');
});
test('failed SQL provisioning reports its exact stage and rolls back all schema changes',async()=>{
 const db=await createIsolatedDatabase();try{
  const wrapped={transaction:work=>db.transaction(q=>work(async(sql,params)=>{if(sql.startsWith('CREATE TABLE colorloop_judge_environment'))throw Object.assign(new Error('synthetic secret-bearing driver message'),{code:'42501'});return q(sql,params);} ))};
  await assert.rejects(provisionJudgeDatabase(wrapped,judgeDeploymentConfig(environment(),protectedMain),accounts()),error=>{assert.equal(error.provisionDiagnostic.stage,'database.identity-marker');assert.equal(error.provisionDiagnostic.code,'42501');assert.doesNotMatch(error.provisionDiagnostic.message,/secret-bearing/);return true;});
  assert.equal((await db.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")).rows[0].n,0);
 }finally{await db.close();}
});
function call(router,origin,path,method='GET',input={},auth){const res=response();return router({method,query:{route:path,...input},body:input,headers:{origin,'content-type':'application/json',...(auth?{cookie:`__Host-colorloop=${auth.token}`,'x-csrf-token':auth.csrfToken}:{})},socket:{remoteAddress:'192.0.2.80'}},res).then(()=>res);}

test('judge configuration requires dedicated credentials, host, key, origin, flags and Vercel project',()=>{
 const env=environment();assert.equal(judgeDeploymentConfig(env,protectedMain).environmentId,env.JUDGE_ENVIRONMENT_ID);
 const invalid=[{JUDGE_DATABASE_URL:''},{DATABASE_URL:env.JUDGE_DATABASE_URL},{JUDGE_DATABASE_HOST:'other.neon.tech'},{JUDGE_DATABASE_URL:'postgresql://synthetic:synthetic-password@ep-protected-pooler.neon.tech/neondb',JUDGE_DATABASE_HOST:'ep-protected-pooler.neon.tech'},{MFA_ENCRYPTION_KEY:Buffer.alloc(32,1).toString('base64')},{APP_ORIGIN:protectedMain.origin},{EMAIL_DELIVERY_MODE:'live'},{EMAIL_CRON_ENABLED:'true'},{RESEND_API_KEY:'synthetic-key'},{CRON_SECRET:'synthetic-secret'},{COLORLOOP_STORE:'mock'},{COLORLOOP_DEMO:'true'},{JUDGE_ENVIRONMENT_ID:''},{VERCEL:'1',JUDGE_PROJECT_ID:'prj_judge',VERCEL_PROJECT_ID:'prj_main'},{VERCEL:'1',JUDGE_PROJECT_ID:'prj_judge'}];
 for(const patch of invalid)assert.throws(()=>judgeDeploymentConfig({...env,...patch},protectedMain),{code:'JUDGE_DEMO_UNAVAILABLE'});
 assert.equal(judgeDeploymentConfig({...env,VERCEL:'1',JUDGE_PROJECT_ID:'prj_judge',VERCEL_PROJECT_ID:'prj_judge'},protectedMain).origin,env.APP_ORIGIN);
 assert.equal(normalizedDatabaseHost('EP-Protected-pooler.neon.tech'),'ep-protected.neon.tech');
});
test('judge storage refuses an unmarked database and provisioning rolls back failures without deleting records',async()=>{
 const db=await createIsolatedDatabase(),env=environment(),configuration=judgeDeploymentConfig(env,protectedMain);
 try{
  const guarded=guardJudgeDatabase(db,configuration);await assert.rejects(guarded.query('SELECT 1'),{code:'JUDGE_DEMO_UNAVAILABLE'});
  const invalid=accounts();invalid.boards[2].password='a'.repeat(24);
  await assert.rejects(provisionJudgeDatabase(db,configuration,invalid));
  assert.equal((await db.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")).rows[0].n,0);
  await db.query('CREATE TABLE protected_existing_record(id int)');await db.query('INSERT INTO protected_existing_record VALUES (1)');
  await assert.rejects(provisionJudgeDatabase(db,configuration,accounts()),{code:'JUDGE_DATABASE_NOT_EMPTY'});assert.equal((await db.query('SELECT id FROM protected_existing_record')).rows[0].id,1);
 }finally{await db.close();}
});
test('dedicated judge provisioning supports real MFA, scoped roles, synthetic history and cross-database session denial',async()=>{
 const db=await createIsolatedDatabase(),main=await createIsolatedDatabase(),env=environment(),configuration=judgeDeploymentConfig(env,protectedMain),input=accounts();
 try{
  assert.deepEqual(await provisionJudgeDatabase(db,configuration,input),{donors:8,gifts:10,campaigns:3,judges:2,boardMembers:3});
  const guarded=guardJudgeDatabase(db,configuration),store=createSqlStore(guarded);
  assert.equal((await store.read(s=>s.donors)).length,8,'read-only snapshot must work after marker check');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM users WHERE totp_enabled')).rows[0].n,0);
  await assert.rejects(guardJudgeDatabase(db,{...configuration,environmentId:randomUUID()}).query('SELECT * FROM donors'),{code:'JUDGE_DEMO_UNAVAILABLE'});
  await assert.rejects(guardJudgeDatabase(db,{...configuration,mfaFingerprint:'wrong'}).query('SELECT * FROM donors'),{code:'JUDGE_DEMO_UNAVAILABLE'});
  const router=createRouter({database:guarded,store,origin:env.APP_ORIGIN,checkDeployment:()=>judgeDeploymentConfig(env,protectedMain)});
  const previousMode=process.env.COLORLOOP_ENVIRONMENT;
  try{process.env.COLORLOOP_ENVIRONMENT='judge';assert.equal((await call(router,env.APP_ORIGIN,'auth/signup','POST',{name:'Synthetic uninvited',email:'uninvited@judge.invalid',password:account('unused').password})).statusCode,403);}
  finally{if(previousMode===undefined)delete process.env.COLORLOOP_ENVIRONMENT;else process.env.COLORLOOP_ENVIRONMENT=previousMode;}
  assert.equal((await db.query('SELECT count(*)::int AS n FROM account_requests')).rows[0].n,0);
  const partial=await login(store,{email:input.judges[0].email,password:input.judges[0].password},'192.0.2.80',new Date());assert.equal(partial.authentication,'enrollment_required');assert.equal((await call(router,env.APP_ORIGIN,'donors','GET',{},partial)).statusCode,403);
  const auth=await signIn(store,{email:input.judges[0].email,password:input.judges[0].password},'192.0.2.80',new Date());
  for(const path of ['donors','campaigns','tasks','outreach/drafts','v1/campaign-summaries'])assert.equal((await call(router,env.APP_ORIGIN,path,'GET',{},auth)).statusCode,200,path);
  for(const path of ['users','roles','outreach/send','email/test-reminder'])assert.equal((await call(router,env.APP_ORIGIN,path,'POST',{},auth)).statusCode,403,path);
  const principal=(await call(router,env.APP_ORIGIN,'auth/me','GET',{},auth)).body.data.user;assert.deepEqual(principal.permissions,[...JUDGE_PERMISSIONS]);
  await main.transaction(migrate);const mainStore=createSqlStore(main);await bootstrapAdministrator(mainStore,account('Synthetic main operator'));
  const mainRouter=createRouter({database:main,store:mainStore,origin:protectedMain.origin,checkDeployment:()=>null});
  assert.equal((await call(mainRouter,protectedMain.origin,'donors','GET',{},auth)).statusCode,401);
  await assert.rejects(login(mainStore,{email:input.judges[0].email,password:input.judges[0].password},'192.0.2.80',new Date()),{code:'INVALID_CREDENTIALS'});
  assert.equal((await main.query('SELECT count(*)::int AS n FROM donors')).rows[0].n,0);
 }finally{await db.close();await main.close();}
});
test('judge deployment blocks real transport and all preparation jobs regardless of credentials',async()=>{
 let calls=0;const env={...environment(),EMAIL_DELIVERY_MODE:'live',RESEND_API_KEY:'synthetic-key',EMAIL_FROM:'sender@synthetic-cic-mail.org'};
 assert.throws(()=>createEmailProvider({env,fetcher:()=>{calls++;}}),{code:'JUDGE_EMAIL_DISABLED'});assert.equal(calls,0);
 const res=response();await preparationJob({method:'GET',headers:{authorization:'Bearer '+('x'.repeat(32))}},res,{env:{...env,CRON_SECRET:'x'.repeat(32)},store:{transaction(){throw new Error('Must not touch storage');}}});assert.equal(res.statusCode,403);assert.equal(res.body.error.code,'JUDGE_AUTOMATION_DISABLED');
});
