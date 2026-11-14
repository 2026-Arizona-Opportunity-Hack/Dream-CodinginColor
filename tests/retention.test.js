import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../lib/retention-store.js';
import { atRisk, addMonths, createReengagement, saveRetentionSettings } from '../lib/retention.js';
import { now } from './retention-support.js';

const actor = { id: 'operator', administrator: true, permissions: ['tasks.manage', 'outreach.write'] };
function fixture() {
  const donors = ['old', 'recent', 'never', 'refund'].map(id => ({ id, name: `Synthetic ${id}`,
    active: true, email: `${id}@example.test`, contactPreferences: { email: true } }));
  return createMemoryStore({ donors, users: [{ id: 'member', active: true, boardMember: true }],
    assignments: [{ id: 'assignment', donorId: 'old', assigneeId: 'member', active: true }],
    donations: [
      { id: 'old-gift', donorId: 'old', donatedAt: '2025-09-01', amountCents: 1000, currency: 'USD', status: 'completed' },
      { id: 'older-gift', donorId: 'old', donatedAt: '2024-09-01', amountCents: 1000, currency: 'USD', status: 'completed' },
      { id: 'new-gift', donorId: 'recent', donatedAt: '2026-08-01', amountCents: 2000, currency: 'USD', status: 'completed' },
      { id: 'refunded', donorId: 'refund', donatedAt: '2025-01-01', amountCents: 3000, currency: 'USD', status: 'refunded' },
    ], tasks: [{ id: 'overdue', donorId: 'recent', assigneeId: 'member', status: 'open', dueAt: '2026-11-01T00:00:00Z' }],
  });
}
test('radar explains actual donation inactivity without conflating overdue tasks or inventing scores', async () => {
  const store = fixture();
  const rows = await store.read(s => atRisk(s, now));
  assert.deepEqual(rows.map(d => d.donorId), ['old']);
  assert.match(rows[0].reason, /2025-09-01/);
  assert.match(rows[0].reason, /12-month/);
  assert.match(rows[0].reason, /2026-09-01/);
  assert.equal(rows[0].givingHistory.completedDonationCount, 2);
  assert.deepEqual(rows[0].givingHistory.intervalsDays, [365]);
  assert.deepEqual(rows[0].overdueFollowUpTaskIds, []);
  assert.equal(rows[0].score, undefined);
  assert.match(rows[0].proposedDraft.body, /Synthetic old/);
  assert.equal((await store.read(s => s.drafts)).length, 0);
  await saveRetentionSettings(store, actor, { inactivityMonths: 3 }, now);
  assert.deepEqual((await store.read(s => atRisk(s, now))).map(d => d.donorId), ['old', 'recent']);
  await saveRetentionSettings(store, actor, { inactivityMonths: 24 }, now);
  assert.equal((await store.read(s => atRisk(s, now))).length, 0);
  await assert.rejects(saveRetentionSettings(store, actor, { inactivityMonths: 0 }, now), /1 through 120/);
});
test('calendar-month threshold handles month ends and includes the exact threshold instant', () => {
  assert.equal(addMonths('2024-01-31T12:00:00Z', 1).toISOString(), '2024-02-29T12:00:00.000Z');
  const state = { donors: [{ id: 'd', active: true, name: 'Synthetic' }],
    donations: [{ id: 'g', donorId: 'd', status: 'completed', currency: 'USD', amountCents: 1, donatedAt: '2024-01-31T12:00:00Z' }],
    settings: { inactivityMonths: 1 }, assignments: [], users: [], tasks: [], drafts: [], templates: [] };
  assert.equal(atRisk(state, new Date('2024-02-29T11:59:59Z')).length, 0);
  assert.equal(atRisk(state, new Date('2024-02-29T12:00:00Z')).length, 1);
});
test('radar ignores missing, normalized-invalid, future, and zero-value donation records', async () => {
  const store = fixture();
  await store.transaction(state => {
    for (const [i, donatedAt] of [null, '', '2025-02-30', '2027-01-01'].entries()) {
      state.donations.push({ id: `invalid${i}`, donorId: 'never', donatedAt,
        amountCents: 1000, currency: 'USD', status: 'completed' });
    }
    state.donations.push({ id: 'zero', donorId: 'never', donatedAt: '2025-01-01', amountCents: 0, currency: 'USD', status: 'completed' });
  });
  assert.deepEqual((await store.read(s => atRisk(s, now))).map(d => d.donorId), ['old']);
});
test('reengagement creates one task and draft per donation event, even under concurrency', async () => {
  const store = fixture();
  const results = await Promise.all(Array.from({ length: 8 }, () => createReengagement(store, actor, { donorId: 'old' }, now)));
  assert.ok(results.every(r => r.task.id === results[0].task.id && r.draft.id === results[0].draft.id));
  await saveRetentionSettings(store, actor, { inactivityMonths: 10 }, now);
  assert.equal((await createReengagement(store, actor, { donorId: 'old' }, now)).task.id, results[0].task.id);
  await store.transaction(s => { s.tasks.find(t => t.id === results[0].task.id).status = 'completed'; });
  await createReengagement(store, actor, { donorId: 'old' }, now);
  assert.equal((await store.read(s => s.drafts)).length, 1);
  assert.equal((await store.read(s => s.tasks)).length, 2); // One pre-existing, one lapse task.
  await assert.rejects(createReengagement(store, actor, { donorId: 'recent' }, now), /threshold/);
  await assert.rejects(createReengagement(store, { ...actor, permissions: [] }, { donorId: 'old' }, now), /requires/);
});
