import { newId } from './retention-store.js';

// Caller owns the transaction. Every relationship writer uses the same lock.
export async function assignNewDonor(query, donorId, actorId = null) {
  await query('SELECT pg_advisory_xact_lock(78234902)');
  const donor = (await query('SELECT assigned_board_member_id,archived_at FROM donors WHERE id=$1 FOR UPDATE', [donorId])).rows[0];
  if (!donor || donor.archived_at || donor.assigned_board_member_id) return donor?.assigned_board_member_id ?? null;
  const member = (await query(`SELECT u.id FROM users u WHERE u.active AND u.board_member
    ORDER BY (SELECT count(*) FROM donors d WHERE d.assigned_board_member_id=u.id AND d.archived_at IS NULL), u.id LIMIT 1`)).rows[0];
  if (!member) return null; // Remains visibly unassigned until a member is available.
  await query('INSERT INTO board_assignments(id,donor_id,assignee_id,active,assigned_at,assigned_by) VALUES ($1,$2,$3,true,now(),$4)', [newId(),donorId,member.id,actorId]);
  await query('UPDATE donors SET assigned_board_member_id=$2,updated_at=now() WHERE id=$1', [donorId,member.id]);
  await query("INSERT INTO audit_events(id,actor_id,action,entity_id,occurred_at,details) VALUES ($1,$2,'assignments.create',$3,now(),'{}')", [newId(),actorId,donorId]);
  return member.id;
}
