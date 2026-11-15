import test from 'node:test';
import assert from 'node:assert/strict';
import { createIsolatedDatabase } from '../lib/isolated-database.js';
import { migrate } from '../lib/database-setup.js';
import { createSqlStore } from '../lib/retention-sql-store.js';
import { bootstrapAdministrator } from '../lib/auth.js';
import { previewImport, confirmImport } from '../lib/import-data.js';
import { listDonors } from '../lib/donor-data.js';
import { calculateRetention, parseFilters } from '../lib/reporting.js';
import { createApiClient } from '../public/js/api.js';

const header = 'Name,Email,Amount,Date,Transaction ID,Currency,Status';
const rows = [
  'Synthetic One,one@example.test,10.10,2026-01-01,TEST-001,USD,completed',
  'Synthetic Two,two@example.test,20.20,2026-01-02,TEST-002,USD,completed',
  'Synthetic Three,three@example.test,30.30,2026-01-03,TEST-003,USD,completed',
];
const csv = [header, ...rows].join('\n');
const upload = (content = csv) => ({
  filename: 'synthetic.csv', source: 'synthetic-demo', content_base64: Buffer.from(content).toString('base64'),
});

test('TEST-001 through TEST-003 remain unique across import retries and reuploads', async (t) => {
  // PGlite has no network connection or persistent directory; never use the default DB adapter.
  const db = await createIsolatedDatabase();
  try {
    await db.transaction(migrate);
    const actor = await bootstrapAdministrator(createSqlStore(db), {
      name: 'Synthetic importer', email: 'importer@example.test', password: 'synthetic importer password',
    });
    const preview = (content) => db.transaction(q => previewImport(q, upload(content), actor));
    const confirm = (batch, decisions) => db.transaction(q => confirmImport(q, { batch_id: batch.batch_id, decisions }, actor));
    const snapshot = async () => ({
      gifts: (await db.query('SELECT id, donor_id, amount, external_transaction_id FROM donations ORDER BY external_transaction_id NULLS LAST')).rows,
      totals: (await db.query('SELECT count(*)::int AS count, sum(amount)::text AS amount FROM donations')).rows[0],
      donors: await listDonors(db.query, {}),
      report: calculateRetention((await db.query('SELECT donor_id, donated_at::text, amount_cents::text, program, board_member_id FROM reporting_gifts ORDER BY donated_at, donor_id')).rows,
        parseFilters({ from: '2026-01-01', to: '2026-12-31' })),
    });
    let original, baseline;

    await t.test('first confirmation imports three gifts; stale and repeated batches reuse the original IDs', async () => {
      const first = await preview(), stale = await preview();
      original = await confirm(first);
      assert.deepEqual(original.rows.map(r => r.result), ['imported', 'imported', 'imported']);
      baseline = await snapshot();
      assert.deepEqual(baseline.totals, { count: 3, amount: '60.60' });
      assert.equal(baseline.donors.length, 3);
      assert.deepEqual(baseline.donors.map(d => d.verified_usd_total).sort(), ['10.10', '20.20', '30.30']);
      assert.equal(baseline.report.giftCount, 3);
      assert.equal(baseline.report.giftTotal, 60.60);
      assert.deepEqual(await confirm(first), original);
      const repeated = await confirm(stale);
      assert.deepEqual(repeated.rows, original.rows.map(r => ({ ...r, result: 'duplicate' })));
      assert.deepEqual(await snapshot(), baseline);
    });

    await t.test('existing_transaction with a false heuristic flag still deduplicates all three gifts', async () => {
      const again = await preview();
      assert.deepEqual(again.counts, { total: 3, valid: 3, invalid: 0 });
      for (const row of again.rows) {
        assert.equal(row.matching.reason, 'existing_transaction');
        assert.equal(row.possible_duplicate_gift, false);
      }
      // Even an explicit heuristic override cannot bypass stable transaction IDs.
      const decisions = Object.fromEntries(again.rows.map(r => [r.row_number, { allow_possible_duplicate: true }]));
      const repeated = await confirm(again, decisions);
      assert.deepEqual(repeated.rows, original.rows.map(r => ({ ...r, result: 'duplicate' })));
      assert.deepEqual(await confirm(again), repeated);
      assert.deepEqual(await snapshot(), baseline);
    });

    await t.test('conflicting gift data rolls back earlier new rows; decisions cannot force a distinct donor', async () => {
      const conflict = await preview([header,
        'Synthetic Four,four@example.test,40.40,2026-01-04,TEST-004,USD,completed',
        rows[0].replace('10.10', '99.99'),
      ].join('\n'));
      assert.equal(conflict.counts.invalid, 0);
      await assert.rejects(confirm(conflict, { 3: { allow_possible_duplicate: true } }), { code: 'TRANSACTION_CONFLICT' });
      assert.deepEqual(await snapshot(), baseline);
      assert.equal((await db.query('SELECT status FROM import_batches WHERE id=$1', [conflict.batch_id])).rows[0].status, 'preview');
      assert.deepEqual((await db.query('SELECT result FROM import_rows WHERE import_batch_id=$1 ORDER BY row_number', [conflict.batch_id])).rows.map(r => r.result), ['pending', 'pending']);

      const again = await preview();
      await assert.rejects(confirm(again, { 2: { donor_id: 'new', allow_possible_duplicate: true } }), { code: 'TRANSACTION_CONFLICT' });
      assert.deepEqual(await snapshot(), baseline);
    });

    await t.test('transaction IDs cannot silently link a different donor identity', async () => {
      const conflict = await preview([header, rows[0].replace('Synthetic One,one@example.test', 'Different Person,different@example.test')].join('\n'));
      assert.equal(conflict.counts.invalid, 1);
      await assert.rejects(confirm(conflict), { code: 'INVALID_ROWS' });
      assert.deepEqual(await snapshot(), baseline);
    });

    await t.test('missing transaction IDs retain the separate mandatory amount/date review', async () => {
      const missingId = await preview([header, rows[0].replace('TEST-001', '')].join('\n'));
      assert.equal(missingId.rows[0].possible_duplicate_gift, true);
      await assert.rejects(confirm(missingId), { code: 'REVIEW_REQUIRED' });
      assert.deepEqual(await snapshot(), baseline);
    });
  } finally { await db.close(); }
});

test('import preview describes valid rows without promising they are new transactions', async () => {
  const serverPreview = {
    batch_id: 'synthetic-batch', headers: ['Name'], counts: { total: 3, valid: 3, invalid: 0 },
    rows: [1, 2, 3].map(n => ({ row_number: n + 1, errors: [], possible_duplicate_gift: false,
      matching: { reason: 'existing_transaction', match: `synthetic-${n}`, candidates: [`synthetic-${n}`] } })),
  };
  const requests = [];
  const client = createApiClient(async (path, options) => {
    requests.push({ path, options });
    return { ok: true, json: async () => ({ data: path === '/api/auth/me' ? { csrfToken: 'synthetic-csrf' } : serverPreview }) };
  });
  const form = new FormData();
  form.set('source', 'synthetic-demo');
  form.set('file', new File(['Name\nSynthetic'], 'synthetic.csv'));
  const uploaded = await client('/imports/preview', { method: 'POST', body: form });
  const mapped = await client('/imports/preview', { method: 'POST', body: { importId: uploaded.importId, mapping: { name: 'Name' } } });
  assert.equal(mapped.validRows, 3);
  assert.equal(mapped.existingTransactions, 3);
  assert.equal(mapped.newTransactions, undefined);
  assert.deepEqual(mapped.rows, serverPreview.rows);
  assert.equal(requests.at(-1).options.headers['X-CSRF-Token'], 'synthetic-csrf');
});
