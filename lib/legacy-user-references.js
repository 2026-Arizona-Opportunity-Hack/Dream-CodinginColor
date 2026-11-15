import {allowlist,ensure,uuid} from './data-validation.js';
import {newId} from './retention-store.js';

export async function unresolvedLegacyReferences(query) {
 const result={};
 for(const [name,table,current,legacy] of [
  ['boardAssignments','donors','assigned_board_member_id','legacy_assigned_board_member_id'],
  ['imports','import_batches','importing_user_id','legacy_importing_user_id'],
  ['merges','donor_merge_history','authorized_actor_id','legacy_authorized_actor_id'],
 ])result[name]=(await query(`SELECT count(*)::int AS count FROM ${table} r WHERE ${current} IS NULL AND ${legacy} IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM legacy_user_identity_resolutions v WHERE v.legacy_user_id=r.${legacy})`)).rows[0].count;
 return result;
}
// Operator-owned explicit mappings only; caller must use one transaction.
export async function resolveLegacyReferences(query,mappings,actorId) {
 ensure(Array.isArray(mappings)&&mappings.length>0&&mappings.length<=1000,'Provide 1–1000 reviewed identity mappings.');
 actorId=uuid(actorId);
 await query('SELECT pg_advisory_xact_lock(78234902)');
 const actor=(await query("SELECT id FROM users WHERE id=$1 AND active AND role_id='administrator'",[actorId])).rows[0];
 ensure(actor,'An active administrator must authorize reconciliation.','FORBIDDEN',403);
 const seen=new Set(),results=[];
 for(const entry of mappings){
  allowlist(entry,['legacyUserId','userId','identityVerified']);
  ensure(entry.identityVerified===true,'Each historical identity requires explicit operator verification.');
  const legacyId=uuid(entry.legacyUserId),userId=uuid(entry.userId);
  ensure(!seen.has(legacyId),'Duplicate historical identity mapping.');seen.add(legacyId);
  const user=(await query('SELECT id,board_member FROM users WHERE id=$1',[userId])).rows[0];
  ensure(user,'Mapped user does not exist.','NOT_FOUND',404);
  const prior=(await query('SELECT user_id FROM legacy_user_identity_resolutions WHERE legacy_user_id=$1',[legacyId])).rows[0];
  ensure(!prior||prior.user_id===userId,'A legacy identity is already linked to a different user.','IDENTITY_CONFLICT',409);
  const present=(await query(`SELECT 1 FROM donors WHERE legacy_assigned_board_member_id=$1
    UNION ALL SELECT 1 FROM import_batches WHERE legacy_importing_user_id=$1
    UNION ALL SELECT 1 FROM donor_merge_history WHERE legacy_authorized_actor_id=$1 LIMIT 1`,[legacyId])).rows.length;
  ensure(present,'Historical reference not found.','NOT_FOUND',404);
  if(!prior)await query('INSERT INTO legacy_user_identity_resolutions(legacy_user_id,user_id,verified_by) VALUES ($1,$2,$3)',[legacyId,userId,actorId]);
  const donors=(await query('SELECT id FROM donors WHERE assigned_board_member_id IS NULL AND legacy_assigned_board_member_id=$1 AND archived_at IS NULL FOR UPDATE',[legacyId])).rows;
  ensure(!donors.length||user.board_member,'Historical donor ownership must map to a board member.');
  for(const donor of donors){
   await query('INSERT INTO board_assignments(id,donor_id,assignee_id,active,assigned_at,assigned_by) VALUES ($1,$2,$3,true,now(),$4)',[newId(),donor.id,userId,actorId]);
   await query('UPDATE donors SET assigned_board_member_id=$2,updated_at=now() WHERE id=$1',[donor.id,userId]);
  }
  const imports=await query('UPDATE import_batches SET importing_user_id=$2 WHERE importing_user_id IS NULL AND legacy_importing_user_id=$1 RETURNING id',[legacyId,userId]);
  const merges=await query('UPDATE donor_merge_history SET authorized_actor_id=$2 WHERE authorized_actor_id IS NULL AND legacy_authorized_actor_id=$1 RETURNING id',[legacyId,userId]);
  const counts={boardAssignments:donors.length,imports:imports.rows.length,merges:merges.rows.length};
  await query("INSERT INTO audit_events(id,actor_id,action,entity_id,occurred_at,details) VALUES ($1,$2,'legacy.identity.resolve',$3,now(),$4)",
   [newId(),actorId,legacyId,JSON.stringify({legacyUserId:legacyId,userId,identityVerified:true,counts,assignmentDateMeaning:'date of reviewed reconciliation; historical start date unknown'})]);
  results.push(counts);
 }
 return results;
}
