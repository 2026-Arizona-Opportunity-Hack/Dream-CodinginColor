import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, request, now, password } from './retention-support.js';
import { login, saveUser } from '../lib/auth.js';
import { createHandler } from '../lib/retention-api.js';

test('all required protected routes reject unauthenticated requests with a consistent envelope', async () => {
  const { store } = await fixture();
  const routes = { 'auth/logout': ['POST'], 'auth/me': ['GET'], users: ['GET', 'POST', 'PATCH'],
    roles: ['GET', 'POST', 'PATCH'], assignments: ['GET', 'POST'], activities: ['GET', 'POST', 'PATCH'],
    tasks: ['GET', 'POST', 'PATCH'], 'outreach/drafts': ['GET', 'POST', 'PATCH'],
    'outreach/approve': ['POST'], 'outreach/send': ['POST'], 'outreach/history': ['GET'],
    'retention/at-risk': ['GET', 'POST'], 'retention/settings': ['GET', 'PATCH'],
    'tasks/reminders': ['POST'], 'outreach/templates': ['GET', 'POST'] };
  for (const [route, methods] of Object.entries(routes)) {
    const module = await import(`../api/${route.includes('/') ? route : `${route}/index`}.js`);
    assert.equal(typeof module.default, 'function');
    for (const method of methods) {
      const res = await request(store, route, method);
      assert.equal(res.statusCode, 401, `${method} ${route}`);
      assert.deepEqual(res.body, { error: { code: 'UNAUTHENTICATED', message: 'Please sign in.' } });
      assert.equal(res.headers['Cache-Control'], 'no-store');
    }
  }
});

test('authenticated API journey covers relationships, retention, drafts, approval, and safe draft mode', async () => {
  const { store, session } = await fixture({ donors: [{ id: 'd', name: 'Synthetic Donor', active: true,
    email: 'donor@example.test', contactPreferences: { email: true } }], donations: [
    { id: 'g', donorId: 'd', amountCents: 10000, currency: 'USD', status: 'completed', donatedAt: '2025-01-01' },
  ] });
  const call = (route, method = 'GET', input = {}) => request(store, route, method, input, session);
  const userResponse = await call('users', 'POST', { name: 'Synthetic Board', email: 'board@example.test',
    password, roleId: 'board-member', boardMember: true });
  assert.equal(userResponse.statusCode, 201);
  const member = userResponse.body.data;
  const assignment = await call('assignments', 'POST', { donorId: 'd' });
  assert.equal(assignment.body.data.assigneeId, member.id);
  assert.equal((await call('activities', 'POST', { donorId: 'd', type: 'note', content: 'Synthetic note' })).statusCode, 201);
  const task = await call('tasks', 'POST', { donorId: 'd', nextAction: 'Call donor', dueAt: '2026-11-01', assigneeId: member.id });
  assert.equal(task.statusCode, 201);
  assert.equal((await call('tasks', 'GET', { view: 'overdue' })).body.data.length, 1);
  assert.equal((await call('tasks', 'PATCH', { id: task.body.data.id, status: 'completed' })).statusCode, 200);
  assert.equal((await call('retention/at-risk')).body.data.length, 1);
  const nudge = await call('retention/at-risk', 'POST', { donorId: 'd' });
  assert.equal(nudge.statusCode, 201);
  const draft = nudge.body.data.draft;
  const input = { id: draft.id, revision: draft.revision };
  assert.equal((await call('outreach/send', 'POST', input)).statusCode, 409);
  assert.equal((await call('outreach/approve', 'POST', input)).statusCode, 200);
  const unsent = await call('outreach/send', 'POST', input);
  assert.equal(unsent.statusCode, 503);
  assert.equal(unsent.body.error.code, 'DRAFT_MODE');
  assert.equal((await call('outreach/history')).body.data.length, 0);
  assert.equal((await call('tasks/reminders', 'POST', { kind: 'quarterly' })).body.data[0].status, 'draft');
  assert.equal((await call('retention/settings', 'PATCH', { inactivityMonths: 24 })).statusCode, 200);
  assert.equal((await call('retention/at-risk')).body.data.length, 0);
  const memberSession = await login(store, { email: member.email, password }, 'member', now);
  assert.equal((await request(store, 'outreach/approve', 'POST', input, memberSession)).statusCode, 403);
  await call('roles', 'PATCH', { id: 'board-member', name: 'Restricted board', permissions: [] });
  assert.equal((await request(store, 'tasks', 'GET', {}, memberSession)).statusCode, 403);
});

test('API validation rejects malformed and unknown input, methods, and leaks no internal errors', async () => {
  const { store, session } = await fixture();
  assert.equal((await request(store, 'users', 'POST', '{invalid', session)).statusCode, 400);
  assert.equal((await request(store, 'tasks', 'POST', { unexpected: true }, session)).statusCode, 400);
  const wrongMethod = await request(store, 'tasks', 'DELETE', {}, session);
  assert.equal(wrongMethod.statusCode, 405);
  assert.equal(wrongMethod.headers.Allow, 'GET, POST, PATCH');
  const res = { setHeader() {}, status(n) { this.statusCode = n; return this; }, json(value) { this.body = value; } };
  await createHandler('users', { store: { read() { throw new Error('private database detail'); } } })({ method: 'GET', headers: {cookie:`__Host-colorloop=${'0'.repeat(64)}`} }, res);
  assert.equal(res.statusCode, 500);
  assert.doesNotMatch(JSON.stringify(res.body), /private database/);
});
