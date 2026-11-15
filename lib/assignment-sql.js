import { newId } from './retention-store.js';
import {ensure} from './data-validation.js';
import {ROTATION_ACTION,rotationCursor,leastLoadedAfter} from './assignment-rotation.js';

// Caller owns the transaction. Every relationship writer uses the same lock.
export async function assignNewDonor(query, donorId, actorId = null) {
  await query('SELECT pg_advisory_xact_lock(78234902)');
  const donor = (await query('SELECT assigned_board_member_id,archived_at FROM donors WHERE id=$1 FOR UPDATE', [donorId])).rows[0];
  if (!donor || donor.archived_at || donor.assigned_board_member_id) return donor?.assigned_board_member_id ?? null;
  const members=(await query(`SELECT u.id,(SELECT count(*)::int FROM donors d WHERE d.assigned_board_member_id=u.id AND d.archived_at IS NULL) AS load
    FROM users u JOIN roles r ON r.id=u.role_id WHERE u.active AND u.board_member AND r.active`)).rows;
  const cursor=rotationCursor((await query("SELECT entity_id,details,action FROM audit_events WHERE action=$1 ORDER BY (details->>'sequence')::bigint DESC LIMIT 1",[ROTATION_ACTION])).rows);
  const member=leastLoadedAfter(members,u=>u.load,cursor.lastId);
  if (!member) return null; // Remains visibly unassigned until a member is available.
  await query('INSERT INTO board_assignments(id,donor_id,assignee_id,active,assigned_at,assigned_by) VALUES ($1,$2,$3,true,now(),$4)', [newId(),donorId,member.id,actorId]);
  await query('UPDATE donors SET assigned_board_member_id=$2,updated_at=now() WHERE id=$1', [donorId,member.id]);
  await query('INSERT INTO audit_events(id,actor_id,action,entity_id,occurred_at,details) VALUES ($1,$2,$3,$4,now(),$5)',[newId(),actorId,ROTATION_ACTION,member.id,JSON.stringify({sequence:cursor.sequence,donor_id:donorId})]);
  await query("INSERT INTO audit_events(id,actor_id,action,entity_id,occurred_at,details) VALUES ($1,$2,'assignments.create',$3,now(),'{}')", [newId(),actorId,donorId]);
  if(actorId)await query("INSERT INTO tasks(id,donor_id,assignee_id,next_action,due_at,status,created_by,created_at,updated_at,event_key) VALUES ($1,$2,$3,'Review donor relationship and next step',now()+interval '7 days','open',$4,now(),now(),$5) ON CONFLICT(event_key) DO NOTHING",[newId(),donorId,member.id,actorId,`onboarding:${donorId}`]);
  return member.id;
}

export async function assignReviewedOwner(query, donorId, assigneeId, actorId) {
  await query('SELECT pg_advisory_xact_lock(78234902)');
  const member=(await query('SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=$1 AND u.active AND u.board_member AND r.active',[assigneeId])).rows[0];
  ensure(member,'Choose a genuine active board member.','INVALID_ASSIGNEE',409);
  const donor=(await query('SELECT assigned_board_member_id FROM donors WHERE id=$1 FOR UPDATE',[donorId])).rows[0];
  if(donor.assigned_board_member_id===assigneeId)return;
  await query('UPDATE board_assignments SET active=false,ended_at=now() WHERE donor_id=$1 AND active',[donorId]);
  await query('INSERT INTO board_assignments(id,donor_id,assignee_id,active,assigned_at,assigned_by) VALUES ($1,$2,$3,true,now(),$4)',[newId(),donorId,assigneeId,actorId]);
  await query('UPDATE donors SET assigned_board_member_id=$2,updated_at=now() WHERE id=$1',[donorId,assigneeId]);
  await query("UPDATE tasks SET assignee_id=$2,updated_at=now() WHERE event_key=$1 AND status='open'", [`onboarding:${donorId}`,assigneeId]);
  await query("INSERT INTO audit_events(id,actor_id,action,entity_id,occurred_at,details) VALUES ($1,$2,'assignments.review',$3,now(),$4)",[newId(),actorId,donorId,JSON.stringify({previous:donor.assigned_board_member_id,assigneeId})]);
}
