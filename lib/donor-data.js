import { donorInput, donationInput, ensure, page, text, uuid } from './data-validation.js';

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
export async function listDonors(query, params) {
  const [limit, offset] = page(params);
  const search = text(params.q, 100) ?? '';
  return (await query(`SELECT id, donor_type, display_name, company, archived_at FROM donors
    WHERE ($1 = '' OR strpos(lower(display_name), lower($1)) > 0 OR strpos(lower(coalesce(company,'')), lower($1)) > 0)
    AND archived_at IS NULL ORDER BY created_at DESC, id LIMIT $2 OFFSET $3`, [search, limit, offset])).rows;
}
export const createDonor = async (query, input) => insert(query, 'donors', await donorInput(query, input));
export async function editDonor(query, id, input) {
  const previous = await getDonor(query, id, true);
  const alias = (await query('SELECT id FROM donor_aliases WHERE alias_donor_id = $1', [id])).rows[0];
  ensure(!alias, 'Edit the canonical donor after a merge.', 'MERGED_DONOR', 409);
  return update(query, 'donors', id, await donorInput(query, input, previous));
}
export async function donorDonations(query, id, params) {
  await getDonor(query, id);
  const [limit, offset] = page(params);
  return (await query('SELECT * FROM donations WHERE donor_id = $1 ORDER BY donation_date DESC, id LIMIT $2 OFFSET $3', [id, limit, offset])).rows;
}
export async function addDonation(query, input, batchId = null) {
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
  ensure(existing && existing.donor_id === data.donor_id && existing.amount === data.amount && (existing.donation_date instanceof Date ? existing.donation_date.toISOString().slice(0, 10) : String(existing.donation_date).slice(0, 10)) === data.donation_date && existing.campaign_id === data.campaign_id && existing.program === data.program, 'Transaction identifier already belongs to different gift data.', 'TRANSACTION_CONFLICT', 409);
  return { donation: existing, duplicate: true };
}
