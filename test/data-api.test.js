import test from 'node:test';
import assert from 'node:assert/strict';
import { handlerFor, routes } from '../lib/donor-routes.js';

const actor = { id: '40000000-0000-4000-8000-000000000001', roles: ['synthetic-test'] };
function response() {
  return { headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; this.headersSent = true; } };
}
const request = (method = 'GET', body = {}) => ({ method, body, headers: { origin: 'https://colorloop.example.invalid', 'content-type': 'application/json' }, query: {} });

test('every protected method fails closed without authentication before accessing the database', async () => {
  for (const [name, methods] of Object.entries(routes)) for (const method of Object.keys(methods)) {
    const res = response();
    await handlerFor(name, { db: { transaction() { throw new Error('Database must not be accessed'); } } })(request(method), res);
    assert.equal(res.statusCode, 401, `${name} ${method}`);
    assert.equal(res.headers['Cache-Control'], 'no-store');
  }
});

test('insufficient permissions return 403 and prevent mutations', async () => {
  let requested;
  const res = response();
  await handlerFor('donors', { authorize: async (_req, reply, permission) => { requested = permission; reply.status(403).json({ error: { code: 'FORBIDDEN', message: 'Forbidden.' } }); return null; }, db: { transaction() { assert.fail('Mutation must not run'); } } })(request('POST'), res);
  assert.equal(requested, 'donors.write');
  assert.equal(res.statusCode, 403);
});

test('authenticated mutations require exact configured Origin and JSON content type', async () => {
  process.env.APP_ORIGIN = 'https://colorloop.example.invalid';
  const options = { authorize: async () => actor, db: { transaction() { assert.fail('Rejected requests must not access the database'); } } };
  for (const origin of [undefined, 'https://evil.example.invalid', 'null']) {
    const req = request('POST'); req.headers.origin = origin;
    const res = response(); await handlerFor('donors', options)(req, res);
    assert.equal(res.statusCode, 403);
  }
  const req = request('POST'); req.headers['content-type'] = 'text/plain';
  const res = response(); await handlerFor('donors', options)(req, res);
  assert.equal(res.statusCode, 415);
});

test('valid read emits the shared JSON envelope and uses server-authenticated identity', async () => {
  const res = response();
  await handlerFor('donors', { authorize: async () => actor, db: { transaction: async (work) => work(async () => ({ rows: [{ id: actor.id, display_name: 'Synthetic Example' }] })) } })(request(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data[0].display_name, 'Synthetic Example');
});

test('internal errors never expose SQL, secrets or donor values', async () => {
  const res = response();
  await handlerFor('donors', { authorize: async () => actor, db: { transaction() { throw new Error('SELECT sensitive_record FROM private_data; example@example.invalid'); } } })(request(), res);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed.' } });
});

test('invalid pagination, UUID and mass assignment are rejected', async () => {
  const options = { authorize: async () => actor, db: { transaction: async (work) => work(async () => ({ rows: [] })) } };
  for (const req of [{ ...request(), query: { limit: '-1' } }, { ...request(), query: { limit: '1000' } }]) {
    const res = response(); await handlerFor('donors', options)(req, res); assert.equal(res.statusCode, 400);
  }
  const res = response(); await handlerFor('donor', options)({ ...request(), query: { id: "' OR 1=1 --" } }, res);
  assert.equal(res.statusCode, 400);
});

test('oversized and malformed JSON are rejected without database access', async () => {
  process.env.APP_ORIGIN = 'https://colorloop.example.invalid';
  const options = { authorize: async () => actor, db: { transaction() { assert.fail(); } } };
  for (const [body, status] of [['{bad', 400], [JSON.stringify({ data: 'x'.repeat(1500001) }), 413]]) {
    const res = response(); await handlerFor('donors', options)(request('POST', body), res);
    assert.equal(res.statusCode, status);
  }
});

test('unsupported methods return 405 without invoking authentication', async () => {
  for (const method of ['DELETE', 'constructor']) {
    const res = response();
    await handlerFor('donors', { authorize() { assert.fail('Unsupported methods do not invoke auth'); } })(request(method), res);
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.Allow, 'GET, POST');
  }
});
