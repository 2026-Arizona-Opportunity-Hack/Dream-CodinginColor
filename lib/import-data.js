import { parseImport } from './import-parser.js';
import { matchDonor } from './matching.js';
import { addDonation, createDonor, getDonor, insert } from './donor-data.js';
import { allowlist, customData, ensure, uuid } from './data-validation.js';
import { assignReviewedOwner } from './assignment-sql.js';
import { prepareDonationThanks } from './communication-sql.js';

async function prepare(query, data, source) {
  const fields=(await query('SELECT * FROM custom_fields')).rows;
  for(const [key,value] of Object.entries(data.donor.custom_data)) {
    const type=fields.find(f=>f.key===key)?.field_type;
    if(typeof value==='string'&&type==='number'&&value.trim()!==''&&Number.isFinite(Number(value)))data.donor.custom_data[key]=Number(value);
    if(typeof value==='string'&&type==='boolean'&&['true','false'].includes(value.toLowerCase()))data.donor.custom_data[key]=value.toLowerCase()==='true';
  }
  await customData(query, data.donor.custom_data);
  if (data.campaign && data.donation && !data.donation.campaign_id) {
    const campaigns = (await query('SELECT id FROM campaigns WHERE lower(name) = lower($1) AND archived_at IS NULL LIMIT 2', [data.campaign])).rows;
    ensure(campaigns.length === 1, 'Campaign must match one active campaign; create it separately before importing.');
    data.donation.campaign_id = campaigns[0].id;
  }
  if (data.donation?.campaign_id) ensure((await query('SELECT id FROM campaigns WHERE id = $1 AND archived_at IS NULL', [data.donation.campaign_id])).rows.length, 'Campaign is missing or archived.');
  const matching = await matchDonor(query, data.donor, source, data.source_donor_id);
  if (data.donation?.external_transaction_id) {
    const gift = (await query('SELECT donor_id FROM donations WHERE source = $1 AND external_transaction_id = $2', [source, data.donation.external_transaction_id])).rows[0];
    if (gift) {
      // A transaction ID identifies a gift, not permission to silently combine identities.
      const donor = await getDonor(query, gift.donor_id);
      const identities = [donor, ...(await query(`SELECT original.* FROM donor_aliases a JOIN donors original ON original.id = a.alias_donor_id
        WHERE a.canonical_donor_id = $1`, [gift.donor_id])).rows];
      ensure((matching.reason === 'source_identifier' && matching.match === gift.donor_id) || identities.some((identity) => identity.display_name.toLowerCase() === data.donor.display_name.toLowerCase() && identity.donor_type === data.donor.donor_type && (!data.donor.normalized_email || identity.normalized_email === data.donor.normalized_email)), 'Source transaction belongs to a different donor identity.', 'TRANSACTION_CONFLICT', 409);
      matching.match = gift.donor_id;
      matching.reason = 'existing_transaction';
      matching.candidates = [...new Set([...matching.candidates, gift.donor_id])];
    }
  }
  return matching;
}
async function possibleGift(query, donorId, donation) {
  if (!donorId || !donation || donation.external_transaction_id) return false;
  return (await query('SELECT id FROM donations WHERE donor_id = $1 AND amount = $2 AND donation_date = $3 LIMIT 1', [donorId, donation.amount, donation.donation_date])).rows.length > 0;
}
export async function previewImport(query, input, actor) {
  const parsed = await parseImport(input);
  const preview = [];
  for (const row of parsed.rows) {
    if (row.data) {
      try {
        row.matching = await prepare(query, row.data, parsed.source);
        row.board_candidates=row.data.board_contact?(await query('SELECT id,name,email FROM users WHERE active AND board_member AND (lower(name)=lower($1) OR email=lower($1))',[row.data.board_contact])).rows:[];
        row.possible_duplicate_gift = await possibleGift(query, row.matching.match, row.data.donation);
        // Board contact is retained for Teammate 2; no browser-supplied user ID is assigned.
        row.warnings = row.data.board_contact ? ['Board contact retained for review; automatic assignment uses active board workloads.'] : [];
        if (row.data.donation && (!row.data.donation.currency || !row.data.donation.status)) {
          row.warnings.push('Review missing currency/payment status before confirming. Unknown gifts remain excluded from verified reports and thank-you preparation.');
        }
      } catch (error) {
        row.errors = [error.code === 'TRANSACTION_CONFLICT' ? 'Transaction identifier conflicts with an existing donor.' : 'Row does not match current field or campaign definitions.'];
      }
    }
    preview.push(row);
  }
  const invalid = preview.filter((row) => row.errors.length).length;
  const batch = await insert(query, 'import_batches', {
    filename: parsed.filename, source: parsed.source, file_hash: parsed.file_hash,
    importing_user_id: uuid(actor.id), validation_counts: { total: preview.length, valid: preview.length - invalid, invalid },
  });
  for (const row of preview) await insert(query, 'import_rows', {
    import_batch_id: batch.id, row_number: row.row_number, normalized_data: row.data,
    result: row.errors.length ? 'invalid' : 'pending', error_details: row.errors,
  });
  return { batch_id: batch.id, expires_at: batch.expires_at, counts: batch.validation_counts, headers: parsed.headers, mapping: parsed.mapping, rows: preview };
}
export async function confirmImport(query, input, actor) {
  allowlist(input, ['batch_id', 'decisions']);
  const batchId = uuid(input.batch_id);
  const decisions = input.decisions ?? {};
  ensure(decisions && typeof decisions === 'object' && !Array.isArray(decisions) && Object.keys(decisions).length <= 1000, 'Invalid row decisions.');
  // Import and merge operations use one shared transaction lock for consistency.
  await query('SELECT pg_advisory_xact_lock(78234902)');
  const batch = (await query('SELECT * FROM import_batches WHERE id = $1 FOR UPDATE', [batchId])).rows[0];
  ensure(batch && batch.importing_user_id === actor.id, 'Import not found.', 'NOT_FOUND', 404);
  if (batch.status === 'confirmed') return batchSummary(query, batchId);
  ensure(batch.status === 'preview' && new Date(batch.expires_at) > new Date(), 'Import preview expired. Upload again.', 'PREVIEW_EXPIRED', 409);
  const { rows } = await query('SELECT * FROM import_rows WHERE import_batch_id = $1 ORDER BY row_number', [batchId]);
  ensure(rows.length && rows.every((row) => row.result === 'pending'), 'Fix invalid rows and upload a new preview.', 'INVALID_ROWS', 409);
  ensure(Object.keys(decisions).every((key) => rows.some((row) => String(row.row_number) === key)), 'Unknown decision row.');
  const added=[];
  for (const row of rows) {
    const data = row.normalized_data;
    const decision = decisions[row.row_number] ?? {};
    allowlist(decision, ['donor_id', 'allow_possible_duplicate', 'assignee_id', 'use_balanced_assignment', 'review_unknown_payment']);
    for(const key of ['use_balanced_assignment','review_unknown_payment'])if(key in decision)ensure(typeof decision[key]==='boolean','Invalid review decision.');
    if(data.donation&&(!data.donation.currency||!data.donation.status))ensure(data.payment_reviewed||decision.review_unknown_payment===true,'Review missing currency and payment status, or explicitly retain them as unknown.','PAYMENT_REVIEW_REQUIRED',409);
    if ('allow_possible_duplicate' in decision) ensure(typeof decision.allow_possible_duplicate === 'boolean', 'Invalid duplicate review decision.');
    const matching = await prepare(query, data, batch.source);
    let donorId = matching.match;
    if (decision.donor_id) {
      if (decision.donor_id === 'new') donorId = null;
      else { donorId = uuid(decision.donor_id); ensure(matching.candidates.includes(donorId), 'Selected donor must be a proposed candidate.'); }
    } else ensure(matching.match || matching.candidates.length === 0, 'Select an existing donor or explicitly choose new for uncertain matches.', 'REVIEW_REQUIRED', 409);
    if (!donorId) donorId = (await createDonor(query, data.donor, actor.id)).id;
    if(data.board_contact){
      ensure(decision.assignee_id||decision.use_balanced_assignment===true,'Review imported board contact and ownership before confirming.','OWNERSHIP_REVIEW_REQUIRED',409);
      if(decision.assignee_id){
        const target=uuid(decision.assignee_id);
        ensure((await query('SELECT id FROM users WHERE id=$1 AND active AND board_member AND (lower(name)=lower($2) OR email=lower($2))',[target,data.board_contact])).rows.length,'Imported contact must match the selected active board account.','OWNERSHIP_CONFLICT',409);
        await assignReviewedOwner(query,donorId,target,actor.id);
      }
    }else ensure(!decision.assignee_id,'A board-contact mapping is required for imported ownership.');
    ensure(!(await possibleGift(query, donorId, data.donation)) || decision.allow_possible_duplicate === true, 'A gift with this amount and date exists. Review before confirming another gift.', 'REVIEW_REQUIRED', 409);
    if (data.source_donor_id) {
      const existing = (await query('SELECT canonical_donor_id FROM donor_aliases WHERE source = $1 AND source_identifier = $2', [batch.source, data.source_donor_id])).rows[0];
      ensure(!existing || existing.canonical_donor_id === donorId, 'Source donor identifier conflicts with the chosen donor.', 'SOURCE_CONFLICT', 409);
      if (!existing) await insert(query, 'donor_aliases', { canonical_donor_id: donorId, original_name: data.donor.display_name, source: batch.source, source_identifier: data.source_donor_id });
    }
    const gift = data.donation ? await addDonation(query, { ...data.donation, donor_id: donorId }, batch.id) : null;
    if(gift&&!gift.duplicate)added.push(gift.donation.id);
    await query('UPDATE import_rows SET result = $1, donor_id = $2, donation_id = $3, processed_at = now() WHERE id = $4', [gift?.duplicate ? 'duplicate' : 'imported', donorId, gift?.donation.id ?? null, row.id]);
  }
  await prepareDonationThanks(query,added,actor.id);
  await query("UPDATE import_batches SET status = 'confirmed', confirmed_at = now() WHERE id = $1", [batchId]);
  return batchSummary(query, batchId);
}
async function batchSummary(query, id) {
  return { batch_id: id, rows: (await query('SELECT row_number, result, donor_id, donation_id FROM import_rows WHERE import_batch_id = $1 ORDER BY row_number', [id])).rows };
}
