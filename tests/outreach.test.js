import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../lib/retention-store.js';
import { approveDraft, sendDraft, saveDraft, saveTemplate, generateReminders } from '../lib/outreach.js';
import { now } from './retention-support.js';

const actor = { id: 'operator' };
function fixture() {
  return createMemoryStore({ donors: [{ id: 'donor', name: 'Synthetic Donor', active: true,
    email: 'donor@example.test', phone: '+16025550123', contactPreferences: { email: true, sms: true } }],
  donations: [{ id: 'gift', donorId: 'donor', status: 'completed', amountCents: 12345, currency: 'USD', donatedAt: '2025-08-01' }],
  users: [{ id: 'member', name: 'Synthetic Member', active: true, boardMember: true, email: 'member@example.test' }],
  assignments: [{ id: 'assignment', donorId: 'donor', assigneeId: 'member', active: true }],
  tasks: [{ id: 'task', donorId: 'donor', assigneeId: 'member', nextAction: 'Call donor', status: 'open', dueAt: '2026-11-01T00:00:00.000Z' }],
  });
}
const create = store => saveDraft(store, actor, { donorId: 'donor', templateId: 'thank-you-email' }, now);
test('unapproved drafts cannot send; editing clears approval; stale revisions are rejected', async () => {
  const store = fixture();
  const draft = await create(store);
  assert.match(draft.body, /USD 123.45 on 2025-08-01/);
  await assert.rejects(sendDraft(store, actor, { id: draft.id, revision: 1 }, now), /approved/);
  await approveDraft(store, actor, { id: draft.id, revision: 1 }, now);
  const edited = await saveDraft(store, actor, { id: draft.id, revision: 1, body: 'Reviewed synthetic message' }, now, true);
  assert.equal(edited.status, 'draft');
  assert.equal(edited.approvedBy, null);
  assert.equal(edited.revisions[0].body, draft.body);
  await assert.rejects(approveDraft(store, actor, { id: draft.id, revision: 1 }, now), /changed/);
  await assert.rejects(sendDraft(store, actor, { id: draft.id, revision: 2 }, now), /approved/);
});
test('provider failures never mark sent, sanitize errors, and lock uncertain deliveries', async () => {
  const store = fixture();
  const draft = await create(store);
  const input = { id: draft.id, revision: 1 };
  await approveDraft(store, actor, input, now);
  await assert.rejects(sendDraft(store, actor, input, now), e => e.code === 'DRAFT_MODE');
  assert.equal((await store.read(s => s.drafts[0])).status, 'approved');
  await assert.rejects(sendDraft(store, actor, input, now, {
    sendEmail: async () => { throw new Error('private provider detail'); },
  }), e => e.code === 'DELIVERY_FAILED');
  const failed = await store.read(s => s.drafts[0]);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.sentAt, undefined);
  assert.equal(failed.outcomeUnknown, true);
  assert.doesNotMatch(JSON.stringify(await store.read(s => s.sendHistory)), /private provider detail/);
  await assert.rejects(saveDraft(store, actor, { ...input, body: 'Retry' }, now, true), /cannot be edited/);
});
test('consent is enforced at approval and checked again before delivery', async () => {
  const store = fixture();
  const draft = await create(store);
  const input = { id: draft.id, revision: 1 };
  await store.transaction(s => { s.donors[0].optedOut = true; });
  await assert.rejects(approveDraft(store, actor, input, now), e => e.code === 'CONTACT_NOT_ALLOWED');
  await store.transaction(s => { s.donors[0].optedOut = false; });
  await approveDraft(store, actor, input, now);
  await store.transaction(s => { s.donors[0].contactPreferences.email = false; });
  let called = false;
  await assert.rejects(sendDraft(store, actor, input, now, { sendEmail: async () => { called = true; } }),
    e => e.code === 'CONTACT_NOT_ALLOWED');
  assert.equal(called, false);
});
test('parallel sends deliver once and preserve the approved message in history', async () => {
  const store = fixture();
  const draft = await create(store);
  const input = { id: draft.id, revision: 1 };
  await approveDraft(store, actor, input, now);
  let calls = 0;
  const provider = { sendEmail: async payload => {
    calls++;
    assert.equal(payload.idempotencyKey, `${draft.id}:1`);
    return { status: 'sent', id: 'synthetic-receipt' };
  } };
  const results = await Promise.allSettled(Array.from({ length: 4 }, () => sendDraft(store, actor, input, now, provider)));
  assert.ok(results.some(r => r.status === 'fulfilled'));
  assert.equal(calls, 1);
  assert.equal((await sendDraft(store, actor, input, now, provider)).status, 'sent');
  assert.equal(calls, 1);
  const history = await store.read(s => s.sendHistory);
  assert.deepEqual(history.map(h => h.status), ['sending', 'sent']);
  assert.equal(history[0].body, draft.body);
});
test('quarterly and overdue reminders are idempotent and remain drafts', async () => {
  const store = fixture();
  const results = await Promise.all(Array.from({ length: 6 }, () => generateReminders(store, actor, now, 'quarterly')));
  assert.ok(results.every(r => r[0].id === results[0][0].id));
  assert.equal(results[0][0].audience, 'board');
  assert.match(results[0][0].body, /Synthetic Donor/);
  await generateReminders(store, actor, now, 'overdue');
  await generateReminders(store, actor, now, 'overdue');
  assert.equal((await store.read(s => s.drafts)).length, 2);
  assert.ok((await store.read(s => s.drafts)).every(d => d.status === 'draft'));
  await generateReminders(store, actor, new Date('2027-01-01T00:00:00Z'), 'quarterly');
  assert.equal((await store.read(s => s.drafts)).length, 3);
});
test('template variables only use verified donor and donation fields', async () => {
  const store = fixture();
  await assert.rejects(saveTemplate(store, actor, { id: 'bad', name: 'Bad', channel: 'email', requiresDonation: false,
    subject: 'Hello', body: '{{studentOutcomes}}' }, now), /Unknown template variable/);
  await saveTemplate(store, actor, { id: 'custom', name: 'Custom', channel: 'email', requiresDonation: true,
    subject: 'Hello {{donorName}}', body: 'Thank you for {{lastDonationAmount}}.' }, now);
  const draft = await saveDraft(store, actor, { donorId: 'donor', templateId: 'custom', donationId: 'gift' }, now);
  assert.equal(draft.body, 'Thank you for USD 123.45.');
  await store.transaction(s => { s.donations[0].status = 'refunded'; });
  await assert.rejects(create(store), e => e.code === 'NO_VERIFIED_DONATION');
});
