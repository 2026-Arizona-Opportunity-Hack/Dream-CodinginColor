import { allowlist, ensure, uuid, page } from './data-validation.js';
import { getDonor, insert } from './donor-data.js';

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
  const [limit, offset] = page(params);
  return (await query(`SELECT a.id AS donor_id, a.display_name, b.id AS candidate_id, b.display_name AS candidate_name
    FROM donors a JOIN donors b ON a.id < b.id AND a.archived_at IS NULL AND b.archived_at IS NULL
    AND ((a.normalized_email IS NOT NULL AND a.normalized_email = b.normalized_email) OR lower(a.display_name) = lower(b.display_name))
    ORDER BY a.id, b.id LIMIT $1 OFFSET $2`, [limit, offset])).rows;
}
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
  const moved = await query('UPDATE donations SET donor_id = $1 WHERE donor_id = $2 RETURNING id', [canonical, merged]);
  await query('UPDATE donor_aliases SET canonical_donor_id = $1 WHERE canonical_donor_id = $2', [canonical, merged]);
  await insert(query, 'donor_aliases', { canonical_donor_id: canonical, alias_donor_id: merged, original_name: old.display_name });
  await query('UPDATE donors SET archived_at = now(), updated_at = now() WHERE id = $1', [merged]);
  const history = await insert(query, 'donor_merge_history', {
    canonical_donor_id: canonical, merged_donor_id: merged, authorized_actor_id: uuid(actor.id),
    audit_details: { reason: input.reason.trim(), donation_ids: moved.rows.map((row) => row.id), original_donor: old },
  });
  // Original donor remains intact for audit; canonical contact/custom values are not overwritten.
  return { canonical_donor_id: canonical, merged_donor_id: merged, donations_moved: moved.rows.length, history_id: history.id };
}
