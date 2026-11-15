// Rotation rehearsal only: disposable PostgreSQL and synthetic keys, never Neon.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createIsolatedDatabase} from '../lib/isolated-database.js';
import {migrate} from '../lib/database-setup.js';
import {encryptTotp,decryptTotp,authenticator,recoveryCodes} from '../lib/totp.js';
const oldKey=Buffer.alloc(32,11).toString('base64'),newKey=Buffer.alloc(32,22).toString('base64');

// Rehearse the proposed operator transaction; there is no live rotation endpoint.
async function reencrypt(query,nextKey){
 const previous=process.env.MFA_ENCRYPTION_KEY;
 try{
  await query('SELECT pg_advisory_xact_lock(78234902)');
  const {rows}=await query('SELECT id,totp_secret_ciphertext,totp_pending_ciphertext FROM users ORDER BY email FOR UPDATE');
  for(const row of rows){
   process.env.MFA_ENCRYPTION_KEY=previous;
   const active=row.totp_secret_ciphertext?decryptTotp(row.totp_secret_ciphertext,row.id):null;
   const pending=row.totp_pending_ciphertext?decryptTotp(row.totp_pending_ciphertext,row.id):null;
   process.env.MFA_ENCRYPTION_KEY=nextKey;
   const sealedActive=active?encryptTotp(active,row.id):null,sealedPending=pending?encryptTotp(pending,row.id):null;
   if(active)assert.equal(decryptTotp(sealedActive,row.id),active);
   if(pending)assert.equal(decryptTotp(sealedPending,row.id),pending);
   await query('UPDATE users SET totp_secret_ciphertext=$1,totp_pending_ciphertext=$2 WHERE id=$3',[sealedActive,sealedPending,row.id]);
  }
 }finally{process.env.MFA_ENCRYPTION_KEY=previous;}
}

test('rotation rehearsal preserves active/pending TOTP, recovery, replay counters, identities and sessions; failures roll back',async()=>{
 const db=await createIsolatedDatabase();process.env.MFA_ENCRYPTION_KEY=oldKey;
 try{
  await db.transaction(migrate);await db.query("INSERT INTO roles(id,name) VALUES ('administrator','Administrator')");
  const admin=randomUUID(),pendingUser=randomUUID(),secret='JBSWY3DPEHPK3PXP',pendingSecret='GEZDGNBVGY3TQOJQ';
  const recoveryUser={id:admin};recoveryCodes(recoveryUser);
  await db.query("INSERT INTO users(id,name,email,password_hash,role_id,totp_enabled,totp_secret_ciphertext,totp_last_step,recovery_hashes) VALUES ($1,'Synthetic active','a-rotation@example.test','synthetic-unused-hash','administrator',true,$2,123,$3)",[admin,encryptTotp(secret,admin),JSON.stringify(recoveryUser.recoveryHashes)]);
  await db.query("INSERT INTO users(id,name,email,password_hash,role_id,totp_pending_ciphertext,totp_pending_expires_at) VALUES ($1,'Synthetic pending','b-rotation@example.test','synthetic-unused-hash','administrator',$2,now()+interval '5 minutes')",[pendingUser,encryptTotp(pendingSecret,pendingUser)]);
  await db.query("INSERT INTO sessions(id,user_id,token_hash,csrf_token,csrf_hash,expires_at,mfa_verified_at) VALUES ($1,$2,'synthetic-session-hash','synthetic-csrf','synthetic-csrf-hash',now()+interval '1 hour',now())",[randomUUID(),admin]);
  const snapshot=async()=>({users:(await db.query('SELECT * FROM users ORDER BY email')).rows,sessions:(await db.query('SELECT * FROM sessions')).rows});
  const before=await snapshot(),marker=new Error('Synthetic dry-run rollback');
  await assert.rejects(db.transaction(async q=>{await reencrypt(q,newKey);throw marker;}),e=>e===marker);
  assert.deepEqual(await snapshot(),before);
  await db.transaction(q=>reencrypt(q,newKey));
  const after=await snapshot();assert.deepEqual(after.sessions,before.sessions);
  for(let i=0;i<before.users.length;i++){
   const {totp_secret_ciphertext:a,totp_pending_ciphertext:p,...rest}=after.users[i];
   const {totp_secret_ciphertext:oldActive,totp_pending_ciphertext:oldPending,...oldRest}=before.users[i];
   assert.deepEqual(rest,oldRest);assert.notDeepEqual([a,p],[oldActive,oldPending]);
  }
  process.env.MFA_ENCRYPTION_KEY=newKey;
  assert.equal(decryptTotp(after.users[0].totp_secret_ciphertext,admin),secret);
  assert.equal(decryptTotp(after.users[1].totp_pending_ciphertext,pendingUser),pendingSecret);
  assert.equal(authenticator(decryptTotp(after.users[0].totp_secret_ciphertext,admin),'synthetic').generate({timestamp:180000}),authenticator(secret,'synthetic').generate({timestamp:180000}));
  process.env.MFA_ENCRYPTION_KEY=oldKey;assert.throws(()=>decryptTotp(after.users[0].totp_secret_ciphertext,admin),{code:'MFA_UNAVAILABLE'});
  process.env.MFA_ENCRYPTION_KEY=newKey;
  await db.query('UPDATE users SET totp_pending_ciphertext=$1 WHERE id=$2',['synthetic-corrupt-envelope',pendingUser]);
  const corrupt=await snapshot();await assert.rejects(db.transaction(q=>reencrypt(q,oldKey)),{code:'MFA_UNAVAILABLE'});assert.deepEqual(await snapshot(),corrupt);
 }finally{await db.close();}
});
