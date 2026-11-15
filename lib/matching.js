import { allowlist, ensure, uuid, page, text } from './data-validation.js';
import { getDonor, insert } from './donor-data.js';
import { newId } from './retention-store.js';

const identity = (value) => value?.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
export async function matchDonor(query, donor, source, sourceId) {
  if (sourceId) {
    const { rows } = await query(`SELECT d.* FROM donor_aliases a JOIN donors d ON d.id = a.canonical_donor_id
      WHERE a.source = $1 AND a.source_identifier = $2 AND d.archived_at IS NULL`, [source, sourceId]);
    if (rows.length) return { match: rows[0].id, candidates: rows.map((row) => row.id), reason: 'source_identifier' };
  }
  const { rows } = await query(`SELECT DISTINCT d.* FROM donors d LEFT JOIN donor_aliases a ON a.canonical_donor_id = d.id
    WHERE d.archived_at IS NULL AND (($1::text IS NOT NULL AND d.normalized_email = $1) OR lower(d.display_name) = lower($2) OR lower(a.original_name) = lower($2))
    ORDER BY d.id LIMIT 101`, [donor.normalized_email, donor.display_name]);
  ensure(rows.length <= 100, 'Too many possible donor matches. Narrow this record before importing.', 'REVIEW_REQUIRED', 409);
  const sameEmail = rows.filter((row) => donor.normalized_email && row.normalized_email === donor.normalized_email);
  const exact = sameEmail.length === 1 && sameEmail[0].donor_type === donor.donor_type && identity(sameEmail[0].display_name) === identity(donor.display_name);
  return { match: exact ? sameEmail[0].id : null, candidates: rows.map((row) => row.id), reason: exact ? 'email_and_identity' : rows.length ? 'review' : 'new' };
}
export async function mergeCandidates(query, params = {}) {
  allowlist(params,['q','limit','offset']);const [limit, offset] = page(params),search=text(params.q,100)||'';
  return (await query(`SELECT a.id AS donor_id, a.display_name,a.normalized_email,a.company, b.id AS candidate_id, b.display_name AS candidate_name,b.normalized_email AS candidate_email,b.company AS candidate_company, CASE WHEN a.normalized_email IS NOT NULL AND a.normalized_email=b.normalized_email THEN 'shared_email_review_required' WHEN lower(a.display_name)=lower(b.display_name) THEN 'name_only_not_identity_proof' ELSE 'shared_phone_review_required' END AS reason
    FROM donors a JOIN donors b ON a.id < b.id AND a.archived_at IS NULL AND b.archived_at IS NULL
    AND ((a.normalized_email IS NOT NULL AND a.normalized_email = b.normalized_email) OR lower(a.display_name) = lower(b.display_name) OR (length(regexp_replace(coalesce(a.phone,''),'[^0-9]','','g'))>=7 AND regexp_replace(a.phone,'[^0-9]','','g')=regexp_replace(b.phone,'[^0-9]','','g')))
    AND ($3='' OR strpos(lower(a.display_name),lower($3))>0 OR strpos(lower(b.display_name),lower($3))>0 OR strpos(coalesce(a.normalized_email,''),lower($3))>0 OR strpos(coalesce(b.normalized_email,''),lower($3))>0)
    ORDER BY a.id, b.id LIMIT $1 OFFSET $2`, [limit, offset,search])).rows;
}
export function mergedEventKey(key,canonical,merged){
 if(!key)return key;const parts=key.split(':');
 if(parts[0]==='lapse'&&parts[1]===merged)parts[1]=canonical;
 if(['cycle-lapse','donor-quarterly'].includes(parts[0])&&parts[2]===merged)parts[2]=canonical;
 return parts.join(':');
}
export async function eventPlan(query,canonical,merged){
 const plan=[];
 for(const table of ['tasks','outreach_messages','retention_events']){
  const rows=(await query(`SELECT id,event_key FROM ${table} WHERE donor_id=ANY($1::uuid[]) AND event_key IS NOT NULL ORDER BY id`,[[canonical,merged]])).rows;
  const keys=rows.map(r=>mergedEventKey(r.event_key,canonical,merged));
  ensure(new Set(keys).size===keys.length,'Overlapping scheduled work must be reviewed before merging.','MERGE_EVENT_CONFLICT',409);
  if(keys.length){const owners=(await query(`SELECT id FROM ${table} WHERE event_key=ANY($1::text[]) AND NOT(id=ANY($2::uuid[]))`,[keys,rows.map(r=>r.id)])).rows;ensure(!owners.length,'A scheduled-work key conflicts with another record.','MERGE_EVENT_CONFLICT',409);}
  for(const row of rows)if(mergedEventKey(row.event_key,canonical,merged)!==row.event_key)plan.push({table,id:row.id,key:mergedEventKey(row.event_key,canonical,merged)});
 }
 return plan;
}
// Internal transaction primitive. HTTP callers must use confirmMerge in merge-review.js.
export async function mergeDonors(query, input, actor) {
  allowlist(input, ['canonical_donor_id', 'merged_donor_id', 'reason']);
  const canonical = uuid(input.canonical_donor_id), merged = uuid(input.merged_donor_id);
  ensure(canonical !== merged, 'Choose two different donors.');
  ensure(typeof input.reason === 'string' && input.reason.trim().length >= 3 && input.reason.length <= 500, 'Provide a merge reason.');
  await query('SELECT pg_advisory_xact_lock(78234902)');
  // Stable ordering also avoids deadlocks with other record operations.
  for (const id of [canonical, merged].sort()) await getDonor(query, id, true);
  const main = await getDonor(query, canonical), old = await getDonor(query, merged);
  ensure(!main.archived_at && !old.archived_at, 'Both donors must be active.', 'MERGE_CONFLICT', 409);
  const events=await eventPlan(query,canonical,merged);
  ensure(!(await query("SELECT id FROM outreach_messages WHERE donor_id=ANY($1::uuid[]) AND (status IN ('sending','queued') OR outcome_unknown) LIMIT 1",[[canonical,merged]])).rows.length,'Resolve in-flight or unknown outreach delivery before merging.','MERGE_OUTREACH_IN_FLIGHT',409);
  const sourceMessages=(await query('SELECT * FROM outreach_messages WHERE donor_id=$1 ORDER BY id',[merged])).rows;
  const ambiguous=(await query(`SELECT a.id FROM donations a JOIN donations b ON a.donor_id=$1 AND b.donor_id=$2 AND a.external_transaction_id IS NULL AND b.external_transaction_id IS NULL AND a.amount=b.amount AND a.donation_date=b.donation_date AND a.currency IS NOT DISTINCT FROM b.currency LIMIT 1`,[canonical,merged])).rows;
  ensure(!ambiguous.length,'Matching unreferenced gifts need evidence review before these donors can merge.','MERGE_AMBIGUOUS_GIFTS',409);
  // History keeps the original identity; live work follows the canonical donor.
  const oldAssignment = (await query('SELECT a.*,u.active AND u.board_member AS eligible FROM board_assignments a JOIN users u ON u.id=a.assignee_id WHERE a.donor_id=$1 AND a.active', [merged])).rows[0];
  await query('UPDATE board_assignments SET active=false,ended_at=now() WHERE donor_id=$1 AND active', [merged]);
  if (!main.assigned_board_member_id && oldAssignment?.eligible) {
    await query('INSERT INTO board_assignments(id,donor_id,assignee_id,active,assigned_at,assigned_by) VALUES ($1,$2,$3,true,now(),$4)', [newId(),canonical,oldAssignment.assignee_id,actor.id]);
    await query('UPDATE donors SET assigned_board_member_id=$2 WHERE id=$1', [canonical,oldAssignment.assignee_id]);
  }
  for (const table of ['activities','tasks','outreach_messages']) await query(`UPDATE ${table} SET donor_id=$1 WHERE donor_id=$2`, [canonical,merged]);
  for(const message of sourceMessages.filter(m=>!['draft','sent','delivered','bounced','suppressed'].includes(m.status))){
    const revision=message.revision+1;
    await query("UPDATE outreach_messages SET status='draft',revision=$2,approved_revision=NULL,approved_by=NULL,approved_at=NULL,handed_off_at=NULL,handed_off_by=NULL,updated_at=now() WHERE id=$1",[message.id,revision]);
    await insert(query,'outreach_revisions',{message_id:message.id,revision,subject:message.subject,body:message.body,changed_by:actor.id,changed_at:new Date().toISOString()});
  }
  for(const item of events)await query(`UPDATE ${item.table} SET event_key=$2 WHERE id=$1`,[item.id,item.key]);
  await query('UPDATE retention_events SET donor_id=$1 WHERE donor_id=$2',[canonical,merged]);
  await query('UPDATE import_rows SET donor_id=$1 WHERE donor_id=$2',[canonical,merged]);
  await query(`UPDATE donors SET opted_out=$2,email_consent=$3,sms_consent=$4,updated_at=now() WHERE id=$1`,
    [canonical,main.opted_out || old.opted_out, main.email_consent && old.email_consent, main.sms_consent && old.sms_consent]);
  const moved = await query('UPDATE donations SET donor_id = $1 WHERE donor_id = $2 RETURNING id', [canonical, merged]);
  const originalOutcomes = (await query('SELECT * FROM verified_funder_outcomes WHERE donor_id=$1 FOR UPDATE', [merged])).rows;
  await query('UPDATE verified_funder_outcomes SET donor_id=$1 WHERE donor_id=$2', [canonical,merged]);
  await query('UPDATE donor_aliases SET canonical_donor_id = $1 WHERE canonical_donor_id = $2', [canonical, merged]);
  await insert(query, 'donor_aliases', { canonical_donor_id: canonical, alias_donor_id: merged, original_name: old.display_name });
  await query('UPDATE donors SET archived_at = now(), assigned_board_member_id=NULL, updated_at = now() WHERE id = $1', [merged]);
  const history = await insert(query, 'donor_merge_history', {
    canonical_donor_id: canonical, merged_donor_id: merged, authorized_actor_id: uuid(actor.id),
    audit_details: { reason: input.reason.trim(), donation_ids: moved.rows.map((row) => row.id), original_donor: old,
      original_verified_outcomes: originalOutcomes, original_outreach: sourceMessages },
  });
  // Original donor remains intact for audit; canonical contact/custom values are not overwritten.
  return { canonical_donor_id: canonical, merged_donor_id: merged, donations_moved: moved.rows.length,
    outcomes_moved: originalOutcomes.length, drafts_requiring_review: sourceMessages.filter(m=>!['draft','sent','delivered','bounced','suppressed'].includes(m.status)).length, history_id: history.id };
}
