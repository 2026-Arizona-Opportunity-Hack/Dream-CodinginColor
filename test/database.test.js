import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createDatabase } from '../lib/db.js';
import { migrate, seed } from '../lib/database-setup.js';
import { createDonor, editDonor, listDonors, addDonation, donorDonations } from '../lib/donor-data.js';
import { previewImport, confirmImport } from '../lib/import-data.js';
import { matchDonor, mergeDonors } from '../lib/matching.js';
import { saveField, saveCampaign } from '../lib/custom-field-data.js';
import { createSqlStore } from '../lib/retention-sql-store.js';
import { bootstrapAdministrator } from '../lib/auth.js';

const actor = { id: '40000000-0000-4000-8000-000000000001' };
const person = (name = 'Example Donor', email = 'example@example.invalid') => ({ donor_type: 'person', display_name: name, normalized_email: email });
const upload = (csv) => ({ filename: 'donors.csv', source: 'synthetic-test', payment_review:{keep_unknown:true}, content_base64: Buffer.from(csv).toString('base64') });
const gift = (id, transaction = 'gift-1') => ({ donor_id: id, amount: '12.50', donation_date: '2026-01-15', source: 'synthetic-test', external_transaction_id: transaction });

test('database services against isolated PostgreSQL engine', async (t) => {
  const pg = new PGlite();
  const query = async (sql, params = []) => {
    // The production driver supports migration files containing multiple statements.
    const result = params.length || !sql.includes(';') ? await pg.query(sql, params) : (await pg.exec(sql)).at(-1);
    return { ...result, rowCount: result.affectedRows ?? result.rows?.length ?? 0 };
  };
  const db = createDatabase({ query, connect: async () => ({ query, release() {} }), end: () => pg.close() });
  const tx = (work) => db.transaction(work);
  try {
    await t.test('migrations apply once and synthetic seeds are repeatable', async () => {
      await tx(migrate); await tx(migrate); await tx(seed); await tx(seed);
      assert.equal((await query('SELECT count(*)::int AS n FROM donors')).rows[0].n, 2);
      assert.equal((await query('SELECT count(*)::int AS n FROM donations')).rows[0].n, 1);
      actor.id = (await bootstrapAdministrator(createSqlStore(db), { name:'Synthetic SQL operator', email:'operator@example.test', password:'SyntheticOperator123!' })).id;
    });
    let donor;
    await t.test('create/edit/archive donor and preserve donation history', async () => {
      donor = await tx((q) => createDonor(q, person()));
      const first = await tx((q) => addDonation(q, gift(donor.id)));
      assert.equal(first.duplicate, false);
      assert.equal((await tx((q) => addDonation(q, gift(donor.id)))).duplicate, true);
      await assert.rejects(tx((q) => addDonation(q, { ...gift(donor.id), amount: '30.00' })), { code: 'TRANSACTION_CONFLICT' });
      await tx((q) => editDonor(q, donor.id, { phone: '555-0100', archived: true }));
      assert.equal((await donorDonations(query, donor.id, {})).length, 1);
      await assert.rejects(tx((q) => addDonation(q, gift(donor.id, 'gift-2'))), { code: 'ARCHIVED_DONOR' });
      await tx((q) => editDonor(q, donor.id, { archived: false }));
    });
    await t.test('custom definitions validate and values persist', async () => {
      const field = await tx((q) => saveField(q, { key: 'interests', label: 'Interests', field_type: 'select', validation_rules: { options: ['STEM', 'Art'] } }));
      const updated = await tx((q) => editDonor(q, donor.id, { custom_data: { interests: 'STEM' } }));
      assert.equal(updated.custom_data.interests, 'STEM');
      await assert.rejects(tx((q) => editDonor(q, donor.id, { custom_data: { interests: 'invalid' } })), /Invalid custom/);
      await tx((q) => saveField(q, { active: false }, field.id));
      const unchanged = await tx((q) => editDonor(q, donor.id, { phone: '555-0101' }));
      assert.equal(unchanged.custom_data.interests, 'STEM');
    });
    await t.test('same names and shared emails never imply identity alone', async () => {
      const one = await tx((q) => createDonor(q, person('Same Name', 'one@example.invalid')));
      const two = await tx((q) => createDonor(q, person('Same Name', 'two@example.invalid')));
      const result = await matchDonor(query, person('Same Name', null), 'generic');
      assert.equal(result.match, null); assert.equal(result.candidates.length, 2);
      await tx((q) => createDonor(q, person('Other Person', 'one@example.invalid')));
      assert.equal((await matchDonor(query, person('Same Name', 'one@example.invalid'), 'generic')).match, null);
      assert.notEqual(one.id, two.id);
    });
    await t.test('import confirmation retries and repeated transactions do not duplicate gifts', async () => {
      const csv = 'Name,Email,Amount,Date,Transaction ID\nImport Example,import@example.invalid,20.00,2026-02-15,import-1';
      const preview = await tx((q) => previewImport(q, upload(csv), actor));
      const first = await tx((q) => confirmImport(q, { batch_id: preview.batch_id }, actor));
      assert.deepEqual(await tx((q) => confirmImport(q, { batch_id: preview.batch_id }, actor)), first);
      const again = await tx((q) => previewImport(q, upload(csv), actor));
      assert.equal((await tx((q) => confirmImport(q, { batch_id: again.batch_id }, actor))).rows[0].result, 'duplicate');
      const returning = await tx((q) => previewImport(q, upload(csv.replace('import-1', 'import-2')), actor));
      const second = await tx((q) => confirmImport(q, { batch_id: returning.batch_id }, actor));
      assert.equal(second.rows[0].donor_id, first.rows[0].donor_id);
      assert.equal((await donorDonations(query, first.rows[0].donor_id, {})).length, 2);
    });
    await t.test('missing transaction IDs require explicit review without discarding distinct gifts', async () => {
      const csv = 'Name,Email,Amount,Date\nReview Example,review@example.invalid,5.00,2026-03-01';
      const preview = await tx((q) => previewImport(q, upload(csv), actor));
      await tx((q) => confirmImport(q, { batch_id: preview.batch_id }, actor));
      const again = await tx((q) => previewImport(q, upload(csv), actor));
      assert.equal(again.rows[0].possible_duplicate_gift, true);
      await assert.rejects(tx((q) => confirmImport(q, { batch_id: again.batch_id }, actor)), { code: 'REVIEW_REQUIRED' });
      const result = await tx((q) => confirmImport(q, { batch_id: again.batch_id, decisions: { 2: { allow_possible_duplicate: true } } }, actor));
      assert.equal(result.rows[0].result, 'imported');
    });
    await t.test('interrupted import rolls back all donors, gifts, and row state; retry succeeds', async () => {
      const csv = 'Name,Email,Amount,Date,Transaction ID\nRollback Example,rollback@example.invalid,5.00,2026-04-01,rollback-1\nRollback Example,rollback@example.invalid,7.00,2026-04-02,rollback-2';
      const preview = await tx((q) => previewImport(q, upload(csv), actor));
      let calls = 0;
      await assert.rejects(tx((q) => confirmImport(async (sql, params) => {
        if (sql.startsWith('INSERT INTO donations') && ++calls === 2) throw new Error('Synthetic interruption');
        return q(sql, params);
      }, { batch_id: preview.batch_id }, actor)), /Synthetic interruption/);
      assert.equal((await query("SELECT count(*)::int AS n FROM donors WHERE normalized_email = 'rollback@example.invalid'")).rows[0].n, 0);
      assert.equal((await query('SELECT status FROM import_batches WHERE id = $1', [preview.batch_id])).rows[0].status, 'preview');
      assert.equal((await tx((q) => confirmImport(q, { batch_id: preview.batch_id }, actor))).rows.length, 2);
    });
    await t.test('manual organization merge preserves every gift and aliases', async () => {
      const main = await tx((q) => createDonor(q, { donor_type: 'organization', display_name: 'Opportunity Hack' }));
      const alias = await tx((q) => createDonor(q, { donor_type: 'organization', display_name: 'OHacks' }));
      await tx((q) => addDonation(q, gift(main.id, 'main-gift')));
      await tx((q) => addDonation(q, gift(alias.id, 'alias-gift')));
      const result = await tx((q) => mergeDonors(q, { canonical_donor_id: main.id, merged_donor_id: alias.id, reason: 'Confirmed organization alias' }, actor));
      assert.equal(result.donations_moved, 1);
      assert.equal((await donorDonations(query, main.id, {})).length, 2);
      assert.equal((await matchDonor(query, { donor_type: 'organization', display_name: 'OHacks' }, 'generic')).candidates[0], main.id);
      await assert.rejects(tx((q) => editDonor(q, alias.id, { archived: false })), { code: 'MERGED_DONOR' });
      assert.equal((await query('SELECT authorized_actor_id FROM donor_merge_history WHERE id = $1', [result.history_id])).rows[0].authorized_actor_id, actor.id);
    });
    await t.test('SQL injection is data; protected fields cannot be assigned', async () => {
      const hostile = "Example'); DROP TABLE donors; --";
      const created = await tx((q) => createDonor(q, person(hostile, null)));
      assert.equal(created.display_name, hostile);
      assert.equal((await listDonors(query, { q: hostile })).length, 1);
      await assert.rejects(tx((q) => editDonor(q, created.id, { assigned_board_member_id: actor.id })), /Unknown or protected/);
      assert.ok((await query('SELECT count(*)::int AS n FROM donors')).rows[0].n > 0);
    });
    await t.test('source IDs are scoped and database constraints reject duplicate transactions', async () => {
      const original = await tx((q) => addDonation(q, gift(donor.id, 'scoped-id')));
      const other = await tx((q) => addDonation(q, { ...gift(donor.id, 'scoped-id'), source: 'other-synthetic-provider' }));
      assert.notEqual(original.donation.id, other.donation.id);
      await assert.rejects(tx((q) => q('INSERT INTO donations (donor_id, amount, donation_date, source, external_transaction_id) VALUES ($1, 12.50, $2, $3, $4)', [donor.id, '2026-01-15', 'synthetic-test', 'scoped-id'])), { code: '23505' });
    });
    await t.test('same names require explicit import decisions and another actor cannot confirm', async () => {
      const preview = await tx((q) => previewImport(q, upload('Name\nSame Name'), actor));
      await assert.rejects(tx((q) => confirmImport(q, { batch_id: preview.batch_id }, actor)), { code: 'REVIEW_REQUIRED' });
      await assert.rejects(tx((q) => confirmImport(q, { batch_id: preview.batch_id }, { id: '40000000-0000-4000-8000-000000000002' })), { code: 'NOT_FOUND' });
      const result = await tx((q) => confirmImport(q, { batch_id: preview.batch_id, decisions: { 2: { donor_id: 'new' } } }, actor));
      assert.equal(result.rows[0].result, 'imported');
    });
    await t.test('expired preview is rejected and preview payload cannot be replaced on confirmation', async () => {
      const preview = await tx((q) => previewImport(q, upload('Name\nExpired Example'), actor));
      await query("UPDATE import_batches SET expires_at = now() - interval '1 minute' WHERE id = $1", [preview.batch_id]);
      await assert.rejects(tx((q) => confirmImport(q, { batch_id: preview.batch_id }, actor)), { code: 'PREVIEW_EXPIRED' });
      await assert.rejects(tx((q) => confirmImport(q, { batch_id: preview.batch_id, rows: [] }, actor)), /Unknown or protected/);
    });
    await t.test('reimport after an organization alias merge retains transaction identity', async () => {
      const main = await tx((q) => createDonor(q, { donor_type: 'organization', display_name: 'Canonical Example' }));
      const csv = 'Name,Email,Amount,Date,Transaction ID\nAlias Example,alias@example.invalid,9.00,2026-04-10,alias-import';
      const preview = await tx((q) => previewImport(q, upload(csv), actor));
      const result = await tx((q) => confirmImport(q, { batch_id: preview.batch_id }, actor));
      await tx((q) => mergeDonors(q, { canonical_donor_id: main.id, merged_donor_id: result.rows[0].donor_id, reason: 'Synthetic confirmed alias' }, actor));
      const again = await tx((q) => previewImport(q, upload(csv), actor));
      assert.equal(again.rows[0].errors.length, 0);
      const confirmed = await tx((q) => confirmImport(q, { batch_id: again.batch_id }, actor));
      assert.equal(confirmed.rows[0].donor_id, main.id);
      assert.equal(confirmed.rows[0].result, 'duplicate');
    });
    await t.test('campaigns can be edited and archived without losing gifts', async () => {
      const campaign = await tx((q) => saveCampaign(q, { name: 'Synthetic Campaign' }));
      await tx((q) => addDonation(q, { ...gift(donor.id, 'campaign-gift'), campaign_id: campaign.id }));
      await tx((q) => saveCampaign(q, { name: 'Updated Campaign', archived: true }, campaign.id));
      assert.equal((await query('SELECT count(*)::int AS n FROM donations WHERE campaign_id = $1', [campaign.id])).rows[0].n, 1);
    });
  } finally { await db.close(); }
});
