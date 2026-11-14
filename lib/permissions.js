import { createHash, timingSafeEqual } from 'node:crypto';
import { getStore } from './retention-store.js';
import { fail, header, sendError } from './retention-http.js';

export const contextKey = Symbol('colorloopContext');
export const PERMISSIONS = Object.freeze([
  'donors.read', 'donors.write', 'donations.write', 'imports.manage',
  'assignments.manage', 'activities.write', 'activities.edit', 'tasks.manage',
  'outreach.write', 'outreach.approve', 'outreach.send', 'reports.read',
  'settings.manage', 'users.manage', 'roles.manage',
]);
export const digest = value => createHash('sha256').update(value).digest('hex');
export const publicUser = ({ id, name, email, roleId, active, boardMember }) =>
  ({ id, name, email, roleId, active, boardMember });

export function sameOrigin(req, origin) {
  if (!origin) fail(503, 'ORIGIN_UNCONFIGURED', 'APP_ORIGIN must be configured.');
  if (header(req, 'origin') !== origin) fail(403, 'INVALID_ORIGIN', 'A same-origin request is required.');
}

export function sessionFrom(state, req, now) {
  const token = header(req, 'cookie').split(';').map(v => v.trim())
    .find(v => v.startsWith('__Host-colorloop='))?.slice('__Host-colorloop='.length);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const session = state.sessions.find(s => s.tokenHash === digest(token)
    && new Date(s.expiresAt) > now);
  const user = session && state.users.find(u => u.id === session.userId && u.active);
  const role = user && state.roles.find(r => r.id === user.roleId);
  return role ? { user, role, session } : null;
}

export async function requirePermission(req, res, permission) {
  try {
    const context = req[contextKey] ?? {};
    const store = context.store ?? getStore();
    const now = context.now?.() ?? new Date();
    const auth = await store.read(state => sessionFrom(state, req, now));
    if (!auth) fail(401, 'UNAUTHENTICATED', 'Please sign in.');
    if (permission && !auth.role.permissions.includes(permission)) {
      fail(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      sameOrigin(req, context.origin ?? process.env.APP_ORIGIN);
      const provided = Buffer.from(digest(header(req, 'x-csrf-token')));
      const expected = Buffer.from(auth.session.csrfHash);
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
        fail(403, 'CSRF_INVALID', 'A valid session CSRF token is required.');
      }
    }
    return { ...publicUser(auth.user), permissions: [...auth.role.permissions],
      administrator: auth.role.id === 'administrator' };
  } catch (error) {
    sendError(res, error);
    return null;
  }
}
