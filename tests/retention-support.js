import { createMemoryStore } from '../lib/retention-store.js';
import { bootstrapAdministrator } from '../lib/auth.js';
import {signIn} from './auth-support.js';
import { createHandler } from '../lib/retention-api.js';

export const now = new Date('2026-11-14T18:00:00.000Z');
export const origin = 'https://colorloop.example';
export const password = 'SyntheticTests123!';
export async function fixture(seed = {}) {
  const store = createMemoryStore(seed);
  const admin = await bootstrapAdministrator(store, { name: 'Synthetic Admin',
    email: 'admin@example.test', password }, now);
  const session = await signIn(store, { email: admin.email, password }, 'test', now);
  return { store, admin: { ...admin, administrator: true }, session };
}
export async function request(store, route, method = 'GET', input = {}, session, extra = {}) {
  const req = { method, body: input, query: input, socket: { remoteAddress: '192.0.2.1' },
    headers: { origin, ...(session ? { cookie: `__Host-colorloop=${session.token}`,
      'x-csrf-token': session.csrfToken } : {}), ...extra.headers } };
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; },
    status(n) { this.statusCode = n; return this; }, json(value) { this.body = value; return this; } };
  await createHandler(route, { store, origin, now: () => now, ...extra.options })(req, res);
  return res;
}
