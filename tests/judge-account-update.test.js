import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {createIsolatedDatabase} from '../lib/isolated-database.js';
import {provisionJudgeDatabase} from '../lib/judge-provision.js';
import {updateJudgeAccount} from '../lib/judge-account-update.js';
import {fingerprint} from '../lib/judge-deployment.js';
import {createSqlStore} from '../lib/retention-sql-store.js';
import {verifyPassword} from '../lib/auth.js';
import {signIn} from './auth-support.js';
const account=name=>({name,email:randomUUID()+'@judge.invalid',password:'Aa1!'+randomBytes(24).toString('hex')});
test('judge email/password update preserves other records, role and enrolled MFA while revoking only target sessions',async()=>{
 const db=await createIsolatedDatabase();
 try{
  const cfg={environmentId:randomUUID(),mfaFingerprint:fingerprint('synthetic-key')},input={operator:account('Private operator'),judges:[account('Judge A'),account('Judge B')],boards:[account('Board A'),account('Board B'),account('Board C')]};
  await provisionJudgeDatabase(db,cfg,input);const store=createSqlStore(db);
  for(const judge of input.judges)await signIn(store,{email:judge.email,password:judge.password},'192.0.2.80',new Date());
  const original=(await db.query('SELECT * FROM users WHERE email=$1',[input.judges[0].email])).rows[0];
  const others=(await db.query('SELECT * FROM users WHERE id<>$1 ORDER BY id',[original.id])).rows;
  const gifts=(await db.query('SELECT * FROM donations ORDER BY id')).rows;
  const password='Bb2!'+randomBytes(24).toString('hex');
  await assert.rejects(updateJudgeAccount(db,{...cfg,environmentId:randomUUID()},input,0,password),{code:'JUDGE_DEMO_UNAVAILABLE'});
  await assert.rejects(updateJudgeAccount(db,cfg,input,0,'A'.repeat(24)));
  await assert.rejects(updateJudgeAccount(db,cfg,{...input,operator:{...input.operator,password:'Wrong1!Password-LongEnough'}},0,password),{code:'JUDGE_UPDATE_REFUSED'});
  assert.deepEqual((await db.query('SELECT * FROM users WHERE id=$1',[original.id])).rows[0],original);
  await updateJudgeAccount(db,cfg,input,0,password);
  const changed=(await db.query('SELECT * FROM users WHERE id=$1',[original.id])).rows[0];
  assert.equal(changed.email,'judge123@gmail.com');assert.equal(await verifyPassword(password,changed.password_hash),true);
  for(const field of ['role_id','board_member','active','totp_enabled','totp_secret_ciphertext','totp_last_step','recovery_hashes','credential_version'])assert.deepEqual(changed[field],original[field],field);
  assert.deepEqual((await db.query('SELECT * FROM users WHERE id<>$1 ORDER BY id',[original.id])).rows,others);
  assert.deepEqual((await db.query('SELECT * FROM donations ORDER BY id')).rows,gifts);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM sessions WHERE user_id=$1',[original.id])).rows[0].n,0);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM sessions')).rows[0].n,1);
  await assert.rejects(updateJudgeAccount(db,cfg,input,0,password),{code:'JUDGE_UPDATE_REFUSED'});
  await assert.rejects(updateJudgeAccount(db,cfg,{...input,judges:[{...input.operator}]},0,password),{code:'JUDGE_UPDATE_REFUSED'});
 }finally{await db.close();}
});
