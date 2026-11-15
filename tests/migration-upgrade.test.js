import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {createIsolatedDatabase} from '../lib/isolated-database.js';
import {migrate} from '../lib/database-setup.js';
import {createSqlStore} from '../lib/retention-sql-store.js';
import {bootstrapAdministrator,saveUser,hashPassword} from '../lib/auth.js';
import {resolveLegacyReferences,unresolvedLegacyReferences} from '../lib/legacy-user-references.js';
import {now,password} from './retention-support.js';

async function applyOriginals(db,names){
 await db.transaction(async q=>{
  await q('CREATE TABLE colorloop_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now(),checksum text)');
  for(const name of names){const source=await readFile(new URL(`../db/migrations/${name}`,import.meta.url),'utf8');await q(source);await q('INSERT INTO colorloop_migrations(name,checksum) VALUES ($1,$2)',[name,createHash('sha256').update(source).digest('hex')]);}
 });
}
test('populated 001 upgrade preserves unknown historical references without inventing accounts, and reconciles only reviewed identities',async()=>{
 const db=await createIsolatedDatabase();
 try{
  await applyOriginals(db,['001_donor_core.sql']);
  const legacy=randomUUID();
  const main=(await db.query("INSERT INTO donors(donor_type,display_name,assigned_board_member_id) VALUES ('person','Synthetic active legacy',$1) RETURNING id",[legacy])).rows[0].id;
  const old=(await db.query("INSERT INTO donors(donor_type,display_name,archived_at) VALUES ('person','Synthetic archived legacy',now()) RETURNING id")).rows[0].id;
  const batch=(await db.query("INSERT INTO import_batches(filename,file_hash,source,importing_user_id) VALUES ('synthetic.csv','synthetic','synthetic',$1) RETURNING id",[legacy])).rows[0].id;
  const merge=(await db.query("INSERT INTO donor_merge_history(canonical_donor_id,merged_donor_id,authorized_actor_id,audit_details) VALUES ($1,$2,$3,$4) RETURNING id",[main,old,legacy,JSON.stringify({synthetic:true,original_actor:legacy})])).rows[0].id;
  await db.transaction(migrate);await db.transaction(migrate);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM users')).rows[0].n,0);
  assert.deepEqual(await db.transaction(unresolvedLegacyReferences),{boardAssignments:1,imports:1,merges:1});
  const donor=(await db.query('SELECT * FROM donors WHERE id=$1',[main])).rows[0];
  assert.equal(donor.assigned_board_member_id,null);assert.equal(donor.legacy_assigned_board_member_id,legacy);
  const importRow=(await db.query('SELECT * FROM import_batches WHERE id=$1',[batch])).rows[0];
  assert.equal(importRow.importing_user_id,null);assert.equal(importRow.legacy_importing_user_id,legacy);
  assert.deepEqual((await db.query('SELECT audit_details FROM donor_merge_history WHERE id=$1',[merge])).rows[0].audit_details,{synthetic:true,original_actor:legacy});
  await assert.rejects(db.transaction(q=>q("INSERT INTO import_batches(filename,file_hash,source,importing_user_id) VALUES ('invalid.csv','test','test',NULL)")),e=>e.code==='23514');
  const store=createSqlStore(db),admin={...await bootstrapAdministrator(store,{name:'Synthetic verified operator',email:'upgrade@example.test',password},now),administrator:true};
  const member=await saveUser(store,admin,{name:'Synthetic verified historical user',email:'history@example.test',password,roleId:'board-member',boardMember:true},now);
  await assert.rejects(db.transaction(q=>resolveLegacyReferences(q,[{legacyUserId:legacy,userId:member.id}],admin.id)),/verification/);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM legacy_user_identity_resolutions')).rows[0].n,0);
  await db.transaction(q=>resolveLegacyReferences(q,[{legacyUserId:legacy,userId:member.id,identityVerified:true}],admin.id));
  assert.deepEqual(await db.transaction(unresolvedLegacyReferences),{boardAssignments:0,imports:0,merges:0});
  assert.equal((await db.query('SELECT importing_user_id FROM import_batches WHERE id=$1',[batch])).rows[0].importing_user_id,member.id);
  assert.equal((await db.query('SELECT legacy_authorized_actor_id FROM donor_merge_history WHERE id=$1',[merge])).rows[0].legacy_authorized_actor_id,legacy);
  const again=await db.transaction(q=>resolveLegacyReferences(q,[{legacyUserId:legacy,userId:member.id,identityVerified:true}],admin.id));
  assert.equal(again[0].boardAssignments,0);
  await assert.rejects(db.transaction(q=>resolveLegacyReferences(q,[{legacyUserId:legacy,userId:admin.id,identityVerified:true}],admin.id)),e=>e.code==='IDENTITY_CONFLICT');
 }finally{await db.close();}
});
test('adding the compatibility migration to an already-integrated database leaves valid user references and existing checksums intact',async()=>{
 const db=await createIsolatedDatabase();
 try{
  await applyOriginals(db,['001_donor_core.sql','002_relationship_security.sql','003_reporting_views.sql']);
  const admin={id:randomUUID()};
  await db.query("INSERT INTO roles(id,name) VALUES ('administrator','Administrator')");
  await db.query("INSERT INTO users(id,name,email,password_hash,role_id) VALUES ($1,'Synthetic existing operator','existing@example.test',$2,'administrator')",[admin.id,await hashPassword(password)]);
  const batch=(await db.query("INSERT INTO import_batches(filename,file_hash,source,importing_user_id) VALUES ('synthetic.csv','test','test',$1) RETURNING id",[admin.id])).rows[0].id;
  const checksums=(await db.query('SELECT name,checksum FROM colorloop_migrations ORDER BY name')).rows;
  await db.transaction(migrate);
  assert.equal((await db.query('SELECT importing_user_id FROM import_batches WHERE id=$1',[batch])).rows[0].importing_user_id,admin.id);
  for(const entry of checksums)assert.equal((await db.query('SELECT checksum FROM colorloop_migrations WHERE name=$1',[entry.name])).rows[0].checksum,entry.checksum);
  assert.deepEqual(await db.transaction(unresolvedLegacyReferences),{boardAssignments:0,imports:0,merges:0});
 }finally{await db.close();}
});

test('account-security upgrade preserves populated users and gifts while gating legacy sessions',async()=>{
 const db=await createIsolatedDatabase();
 try{
  await applyOriginals(db,['001_donor_core.sql','001a_preserve_legacy_user_references.sql','002_relationship_security.sql','003_reporting_views.sql','004_legacy_identity_resolution.sql','005_cic_requirements.sql']);
  const userId=randomUUID(),sessionId=randomUUID();
  const {digest,sessionFrom,requirePermission,contextKey}=await import('../lib/permissions.js');
  const token='b'.repeat(64),hash=await hashPassword(password);
  await db.query("INSERT INTO roles(id,name) VALUES ('administrator','Administrator')");
  await db.query("INSERT INTO users(id,name,email,password_hash,role_id) VALUES ($1,'Synthetic pre-MFA operator','before-mfa@example.test',$2,'administrator')",[userId,hash]);
  await db.query('INSERT INTO sessions(id,user_id,token_hash,csrf_token,csrf_hash,expires_at) VALUES ($1,$2,$3,$4,$5,$6)',[sessionId,userId,digest(token),'synthetic-csrf',digest('synthetic-csrf'),new Date(+now+3600000)]);
  const donor=(await db.query("INSERT INTO donors(donor_type,display_name) VALUES ('person','Synthetic retained donor') RETURNING id")).rows[0].id;
  await db.transaction(migrate);await db.transaction(migrate);
  const stored=(await db.query('SELECT * FROM users WHERE id=$1',[userId])).rows[0];
  assert.equal(stored.password_hash,hash);assert.equal(stored.totp_enabled,false);assert.deepEqual(stored.recovery_hashes,[]);assert.deepEqual(stored.preferences,{});
  assert.equal((await db.query('SELECT id FROM donors WHERE id=$1',[donor])).rows[0].id,donor);
  const store=createSqlStore(db),req={method:'GET',headers:{cookie:`__Host-colorloop=${token}`},[contextKey]:{store,now:()=>now}};
  assert.equal((await store.read(s=>sessionFrom(s,req,now))).session.mfaVerifiedAt,null);
  const res={setHeader(){},status(code){this.statusCode=code;return this;},json(value){this.body=value;}};
  assert.equal(await requirePermission(req,res),null);assert.equal(res.statusCode,403);assert.equal(res.body.error.code,'MFA_REQUIRED');
 }finally{await db.close();}
});
