import { donorInput, donationInput, ensure, page, text, uuid } from './data-validation.js';
import { assignNewDonor } from './assignment-sql.js';
import { newId } from './retention-store.js';
import {assignmentScoped} from './donor-access.js';

const jsonColumns = new Set(['custom_data', 'validation_counts', 'normalized_data', 'error_details', 'audit_details', 'validation_rules']);
const valuesFor = (data) => Object.entries(data).map(([key, value]) => jsonColumns.has(key) && value !== null ? JSON.stringify(value) : value);

// SQL identifiers here are exclusively hardcoded allowlisted service keys.
export async function insert(query, table, data) {
  const keys = Object.keys(data);
  return (await query(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, valuesFor(data))).rows[0];
}
export async function update(query, table, id, data) {
  const keys = Object.keys(data);
  return (await query(`UPDATE ${table} SET ${keys.map((key, i) => `${key} = $${i + 2}`).join(',')}, updated_at = now() WHERE id = $1 RETURNING *`, [id, ...valuesFor(data)])).rows[0];
}
export async function getDonor(query, id, lock = false) {
  const donor = (await query(`SELECT * FROM donors WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [uuid(id)])).rows[0];
  ensure(donor, 'Donor not found.', 'NOT_FOUND', 404);
  return donor;
}
export async function listDonors(query, params,actor) {
  const [limit, offset] = page(params);
  const search = text(params.q, 100) ?? '';
  return (await query(`SELECT id, donor_type, display_name, company, archived_at, normalized_email,
    (SELECT name FROM users WHERE users.id=donors.assigned_board_member_id) AS board_member_name,
    (SELECT coalesce(sum(amount),0) FROM donations WHERE donor_id=donors.id AND currency='USD' AND status='completed') AS verified_usd_total FROM donors
    WHERE ($1 = '' OR strpos(lower(display_name), lower($1)) > 0 OR strpos(lower(coalesce(company,'')), lower($1)) > 0 OR strpos(coalesce(normalized_email,''),lower($1))>0)
    AND archived_at IS NULL AND ($4::uuid IS NULL OR assigned_board_member_id=$4) ORDER BY created_at DESC, id LIMIT $2 OFFSET $3`, [search, limit, offset,assignmentScoped(actor)?actor.id:null])).rows;
}
export const createDonor = async (query, input, actorId = null) => {
  await query('SELECT pg_advisory_xact_lock(78234902)');
  const donor = await insert(query, 'donors', await donorInput(query, input));
  donor.assigned_board_member_id = await assignNewDonor(query, donor.id, actorId);
  return donor;
};
export async function editDonor(query, id, input, actorId = null) {
  await query('SELECT pg_advisory_xact_lock(78234902)');
  const previous = await getDonor(query, id, true);
  const alias = (await query('SELECT id FROM donor_aliases WHERE alias_donor_id = $1', [id])).rows[0];
  ensure(!alias, 'Edit the canonical donor after a merge.', 'MERGED_DONOR', 409);
  const result = await update(query, 'donors', id, await donorInput(query, input, previous));
  await query("INSERT INTO audit_events(id,actor_id,action,entity_id,occurred_at,details) VALUES ($1,$2,'donors.update',$3,now(),$4)",
    [newId(),actorId,id,JSON.stringify({fields:Object.keys(input),preferences:{emailConsent:result.email_consent,smsConsent:result.sms_consent,optedOut:result.opted_out},archived:!!result.archived_at})]);
  return result;
}
export async function donorDonations(query, id, params) {
  await getDonor(query, id);
  const [limit, offset] = page(params);
  return (await query('SELECT * FROM donations WHERE donor_id = $1 ORDER BY donation_date DESC, id LIMIT $2 OFFSET $3', [id, limit, offset])).rows;
}
export async function addDonation(query, input, batchId = null) {
  await query('SELECT pg_advisory_xact_lock(78234902)');
  const data = donationInput(input);
  const donor = await getDonor(query, data.donor_id, true);
  ensure(!donor.archived_at, 'Cannot add a gift to an archived donor.', 'ARCHIVED_DONOR', 409);
  if (data.campaign_id) ensure((await query('SELECT id FROM campaigns WHERE id = $1 AND archived_at IS NULL', [data.campaign_id])).rows.length, 'Campaign is missing or archived.');
  const keys = Object.keys(data);
  const values = [...Object.values(data), batchId];
  const result = await query(`INSERT INTO donations (${keys.join(',')}, import_batch_id)
    VALUES (${values.map((_, i) => `$${i + 1}`).join(',')}) ON CONFLICT (source, external_transaction_id) DO NOTHING RETURNING *`, values);
  if (result.rows[0]) return { donation: result.rows[0], duplicate: false };
  const existing = (await query('SELECT * FROM donations WHERE source = $1 AND external_transaction_id = $2', [data.source, data.external_transaction_id])).rows[0];
  ensure(existing && existing.donor_id === data.donor_id && existing.amount === data.amount && (existing.donation_date instanceof Date ? existing.donation_date.toISOString().slice(0, 10) : String(existing.donation_date).slice(0, 10)) === data.donation_date && existing.campaign_id === data.campaign_id && existing.program === data.program && existing.currency === data.currency && existing.status === data.status, 'Transaction identifier already belongs to different gift data.', 'TRANSACTION_CONFLICT', 409);
  return { donation: existing, duplicate: true };
}

export async function reviewDonation(query,id,input,actor){
  const {donationInput:validate}=await import('./data-validation.js');
  const {prepareDonationThanks}=await import('./communication-sql.js');
  const {allowlist}=await import('./data-validation.js');
  allowlist(input,['currency','status','reason']);
  await query('SELECT pg_advisory_xact_lock(78234902)');
  const old=(await query('SELECT * FROM donations WHERE id=$1 FOR UPDATE',[uuid(id)])).rows[0];ensure(old,'Gift not found.','NOT_FOUND',404);
  const reason=text(input.reason,1000,true);
  const data=validate({...Object.fromEntries(['donor_id','amount','source','external_transaction_id','campaign_id','program','currency','status'].map(k=>[k,old[k]])),donation_date:old.donation_date instanceof Date?old.donation_date.toISOString().slice(0,10):String(old.donation_date).slice(0,10),currency:input.currency,status:input.status});
  ensure(data.currency&&data.status,'Explicitly verify currency and payment status.');
  ensure((!old.currency||old.currency===data.currency)&&(!old.status||old.status===data.status||old.status==='pending'),'Existing verified gift metadata cannot be overwritten through verification.','VERIFICATION_CONFLICT',409);
  await query('UPDATE donations SET currency=$2,status=$3 WHERE id=$1',[id,data.currency,data.status]);
  await query("INSERT INTO audit_events(id,actor_id,action,entity_id,occurred_at,details) VALUES ($1,$2,'donations.review',$3,now(),$4)",[newId(),actor.id,id,JSON.stringify({reason,previous:{currency:old.currency,status:old.status},current:{currency:data.currency,status:data.status}})]);
  await prepareDonationThanks(query,[id],actor.id);
  return (await query('SELECT * FROM donations WHERE id=$1',[id])).rows[0];
}
