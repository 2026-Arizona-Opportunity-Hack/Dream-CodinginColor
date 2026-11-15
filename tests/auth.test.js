import {signIn} from './auth-support.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, request, now, password } from './retention-support.js';
import { saveUser, saveRole, login, verifyPassword } from '../lib/auth.js';
import { createMemoryStore, getStore } from '../lib/retention-store.js';

test('authentication, permissions, CSRF, account changes, and session lifecycle', async () => {
  const { store, admin, session } = await fixture();
  assert.equal((await request(store, 'users')).statusCode, 401);
  const loggedIn = await request(store, 'auth/login', 'POST', { email: admin.email, password });
  assert.equal(loggedIn.statusCode, 200);
  assert.match(loggedIn.headers['Set-Cookie'], /HttpOnly; Secure; SameSite=Strict/);
  assert.equal(loggedIn.body.data.token, undefined);
  const me = await request(store, 'auth/me', 'GET', {}, session);
  assert.equal(me.body.data.user.passwordHash, undefined);
  assert.equal(me.body.data.csrfToken, session.csrfToken);
  const member = await saveUser(store, admin, { name: 'Synthetic Member', email: 'member@example.test',
    password, roleId: 'board-member', boardMember: true }, now);
  const memberSession = await signIn(store, { email: member.email, password }, 'member', now);
  assert.equal((await request(store, 'users', 'GET', {}, memberSession)).statusCode, 403);
  assert.equal((await request(store, 'users', 'PATCH', { id: member.id, roleId: 'administrator' }, memberSession)).statusCode, 403);
  assert.equal((await request(store, 'users', 'PATCH', { id: admin.id, active: false }, session)).statusCode, 403);
  assert.equal((await request(store, 'roles', 'PATCH', { id: admin.roleId, name: 'Admin', permissions: [] }, session)).statusCode, 403);
  assert.equal((await request(store, 'auth/logout', 'POST', {}, session,
    { headers: { 'x-csrf-token': 'invalid' } })).statusCode, 403);
  assert.equal((await request(store, 'auth/login', 'POST', { email: admin.email, password }, undefined,
    { headers: { origin: 'https://evil.example' } })).statusCode, 403);
  await saveRole(store, admin, { id: 'board-member', name: 'Board member', permissions: [] }, now, true);
  const hash = await store.read(s => s.users.find(u => u.id === member.id).passwordHash);
  assert.notEqual(hash, password);
  assert.equal(await verifyPassword('wrong', hash), false);
  await saveUser(store, admin, { id: member.id, active: false }, now, true);
  assert.equal((await request(store, 'auth/me', 'GET', {}, memberSession)).statusCode, 401);
  assert.equal((await request(store, 'auth/logout', 'POST', {}, session)).statusCode, 200);
  assert.equal((await request(store, 'auth/me', 'GET', {}, session)).statusCode, 401);
  assert.ok((await store.read(s => s.audit)).some(a => a.action === 'roles.update'));
});

test('sessions expire and login throttling cannot be bypassed with parallel requests', async () => {
  const { store, session } = await fixture();
  const expired = await request(store, 'auth/me', 'GET', {}, session,
    { options: { now: () => new Date(+now + 9 * 3600000) } });
  assert.equal(expired.statusCode, 401);
  // Existing attempts exercise the limit without running dozens of expensive password hashes.
  await store.transaction(s => { s.loginAttempts = Array.from({ length: 25 }, () => ({
    networkKey: 'ignored', accountKey: 'ignored', at: now.toISOString(),
  })); });
  const results = await Promise.all(Array.from({ length: 7 }, () =>
    request(store, 'auth/login', 'POST', { email: 'missing@example.test', password: 'wrong' })));
  assert.equal(results.filter(r => r.statusCode === 429).length, 2);
  assert.equal(results.filter(r => r.statusCode === 401).length, 5);
});

test('mock transactions roll back and storage is disabled by default', async () => {
  const store = createMemoryStore();
  await assert.rejects(store.transaction(s => { s.users.push({ id: 'bad' }); throw new Error('abort'); }));
  assert.deepEqual(await store.read(s => s.users), []);
  const previous = { COLORLOOP_STORE: process.env.COLORLOOP_STORE,
    NODE_ENV: process.env.NODE_ENV, VERCEL: process.env.VERCEL, DATABASE_URL:process.env.DATABASE_URL };
  delete process.env.COLORLOOP_STORE;
  delete process.env.DATABASE_URL;
  try {
    assert.throws(() => getStore(), /not configured/);
    process.env.COLORLOOP_STORE = 'mock';
    process.env.NODE_ENV = 'production';
    assert.throws(() => getStore(), /not configured/);
    process.env.NODE_ENV = 'test';
    process.env.VERCEL = '1';
    assert.throws(() => getStore(), /not configured/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
