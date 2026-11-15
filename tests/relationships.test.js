import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../lib/retention-store.js';
import { assignDonor, saveActivity, saveTask, listTasks } from '../lib/assignment.js';
import { now } from './retention-support.js';

const actor = { id: 'operator', permissions: ['activities.edit'] };
function fixture() {
  return createMemoryStore({ users: [
    { id: 'a', active: true, boardMember: true }, { id: 'b', active: true, boardMember: true },
    { id: 'inactive', active: false, boardMember: true }, { id: 'staff', active: true, boardMember: false },
  ], donors: Array.from({ length: 11 }, (_, i) => ({ id: `d${i}`, active: true })) });
}
test('parallel assignments balance active board members and preserve imported ownership', async () => {
  const store = fixture();
  await Promise.all(Array.from({ length: 10 }, (_, i) => assignDonor(store, { donorId: `d${i}` }, actor.id, now)));
  const assignments = await store.read(s => s.assignments);
  assert.equal(assignments.filter(a => a.assigneeId === 'a').length, 5);
  assert.equal(assignments.filter(a => a.assigneeId === 'b').length, 5);
  assert.equal(assignments.filter(a => a.assigneeId === 'inactive').length, 0);
  const again = await assignDonor(store, { donorId: 'd0' }, actor.id, now);
  assert.deepEqual(again, assignments[0]);
  await store.transaction(s => { s.users.find(u => u.id === again.assigneeId).active = false; });
  assert.deepEqual(await assignDonor(store, { donorId: 'd0' }, actor.id, now), again);
  await store.transaction(s => { s.donors[0].active = false; });
  assert.deepEqual(await assignDonor(store, { donorId: 'd0' }, actor.id, now), again);
  await store.transaction(s => { s.donors[0].active = true; });
  await assert.rejects(assignDonor(store, { donorId: 'd10', assigneeId: 'inactive' }, actor.id, now), /active board/);
  const reassigned = await assignDonor(store, { donorId: 'd0', assigneeId: 'b' }, actor.id, now);
  assert.equal(reassigned.assigneeId, 'b');
  assert.equal((await store.read(s => s.assignments.filter(a => a.donorId === 'd0' && a.active))).length, 1);
});
test('activities preserve edits; tasks distinguish overdue, upcoming, and completed', async () => {
  const store = fixture();
  const activity = await saveActivity(store, actor, { donorId: 'd0', type: 'call', content: 'Synthetic call', occurredAt: '2026-11-01' }, now);
  await assert.rejects(saveActivity(store, { ...actor, permissions: [] }, { id: activity.id, type: 'note', content: 'edit' }, now, true), /requires/);
  const edited = await saveActivity(store, actor, { id: activity.id, type: 'note', content: 'Corrected synthetic note' }, now, true);
  assert.equal(edited.occurredAt, activity.occurredAt);
  assert.equal((await store.read(s => s.activityHistory))[0].content, 'Synthetic call');
  const task = await saveTask(store, actor, { donorId: 'd0', assigneeId: 'a', nextAction: 'Call donor', dueAt: '2026-11-13' }, now);
  await saveTask(store, actor, { donorId: 'd1', assigneeId: 'b', nextAction: 'Send update', dueAt: '2026-11-15' }, now);
  assert.equal((await store.read(s => listTasks(s, { view: 'overdue' }, now))).length, 1);
  assert.equal((await store.read(s => listTasks(s, { view: 'upcoming' }, now))).length, 1);
  await saveTask(store, actor, { id: task.id, status: 'completed' }, now, true);
  assert.equal((await store.read(s => listTasks(s, { view: 'overdue' }, now))).length, 0);
  assert.equal((await store.read(s => listTasks(s, { view: 'completed' }, now))).length, 1);
  await assert.rejects(saveTask(store, actor, { donorId: 'd0', assigneeId: 'a', nextAction: 'Call', dueAt: '2026-02-30' }, now), /invalid/);
});
