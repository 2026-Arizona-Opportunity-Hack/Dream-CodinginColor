import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { audit, newId } from './retention-store.js';
import { check, fail, record, text, boolean, find, id } from './retention-http.js';
import { digest, publicUser, PERMISSIONS, sessionFrom } from './permissions.js';

const scrypt = promisify(scryptCallback);
const options = { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 };
const SESSION_MS = 8 * 60 * 60 * 1000;
const DUMMY_HASH = `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`;
const secret = () => randomBytes(32).toString('hex');

function password(value) {
  check(typeof value === 'string' && value.length >= 15 && value.length <= 128,
    'Passwords must contain 15 to 128 characters.');
  return value;
}
export async function hashPassword(value) {
  password(value);
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(value, salt, 64, options);
  return `scrypt$${salt}$${derived.toString('hex')}`;
}
export async function verifyPassword(value, encoded) {
  if (typeof value !== 'string' || value.length > 128) return false;
  const [scheme, salt, hash] = String(encoded).split('$');
  if (scheme !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt)
      || !/^[a-f0-9]{128}$/.test(hash)) return false;
  const derived = await scrypt(value, salt, 64, options);
  return timingSafeEqual(derived, Buffer.from(hash, 'hex'));
}
export function email(value) {
  const result = text(value, 'email', 254).toLowerCase();
  check(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result), 'A valid email is required.');
  return result;
}
export function cookie(token, expires = false) {
  return `__Host-colorloop=${expires ? '' : token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${expires ? 0 : SESSION_MS / 1000}`;
}

export async function login(store, input, ip, now) {
  record(input, ['email', 'password']);
  const address = email(input.email);
  check(typeof input.password === 'string' && input.password.length <= 128, 'A valid password is required.');
  const accountKey = digest(address);
  if (!ip) fail(503,'CLIENT_IDENTITY_UNAVAILABLE','A trusted client address is required.');
  const networkKey = digest(ip);
  // Count attempts before hashing; serialize reservations so parallel logins cannot bypass the limit.
  await store.transaction(state => {
    state.loginAttempts = state.loginAttempts.filter(a => now - new Date(a.at) < 15 * 60 * 1000);
    if (state.loginAttempts.filter(a => a.accountKey === accountKey).length >= 5
        || state.loginAttempts.filter(a => a.networkKey === networkKey).length >= 25) {
      fail(429, 'RATE_LIMITED', 'Too many sign-in attempts. Try again in 15 minutes.');
    }
    state.loginAttempts.push({ accountKey, networkKey, at: now.toISOString() });
  });
  const user = await store.read(state => state.users.find(u => u.email === address));
  const valid = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!valid || !user?.active) fail(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  const token = secret();
  const csrfToken = secret();
  await store.transaction(state => {
    const current = find(state.users, user.id, 'User');
    if (!current.active || current.passwordHash !== user.passwordHash) {
      fail(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
    }
    state.sessions = state.sessions.filter(s => new Date(s.expiresAt) > now);
    state.sessions.push({ id: newId(), userId: user.id, tokenHash: digest(token),
      csrfToken, csrfHash: digest(csrfToken), expiresAt: new Date(+now + SESSION_MS).toISOString() });
    audit(state, user.id, 'auth.login', user.id, now);
  });
  return { token, csrfToken, user: publicUser(user) };
}

export async function logout(store, req, now) {
  await store.transaction(state => {
    const auth = sessionFrom(state, req, now);
    if (auth) {
      state.sessions = state.sessions.filter(s => s.id !== auth.session.id);
      audit(state, auth.user.id, 'auth.logout', auth.user.id, now);
    }
  });
}

export function assertAdministrator(actor) {
  if (!actor.administrator) fail(403, 'ADMINISTRATOR_REQUIRED', 'An administrator is required.');
}
function preserveAdministrator(state) {
  check(state.users.some(u => u.active && u.roleId === 'administrator'),
    'At least one active administrator must remain.');
}
export async function saveUser(store, actor, input, now, update = false) {
  assertAdministrator(actor);
  record(input, ['id', 'name', 'email', 'password', 'roleId', 'active', 'boardMember', 'confirmAdministrator']);
  if (input.confirmAdministrator !== undefined) boolean(input.confirmAdministrator,'confirmAdministrator');
  const patch = {};
  if (!update || input.name !== undefined) patch.name = text(input.name, 'name', 120);
  if (!update || input.email !== undefined) patch.email = email(input.email);
  if (!update || input.roleId !== undefined) patch.roleId = id(input.roleId, 'roleId');
  if (!update || input.active !== undefined) patch.active = input.active === undefined ? true : boolean(input.active, 'active');
  if (!update || input.boardMember !== undefined) patch.boardMember = input.boardMember === undefined ? false : boolean(input.boardMember, 'boardMember');
  if (!update || input.password !== undefined) patch.passwordHash = await hashPassword(input.password);
  return store.transaction(state => {
    const user = update ? find(state.users, id(input.id), 'User') : { id: newId() };
    const previous = { roleId: user.roleId ?? null, active: user.active ?? null, boardMember: user.boardMember ?? null };
    if (update && user.id === actor.id && ['roleId', 'active', 'boardMember'].some(k => k in patch && patch[k] !== user[k])) {
      fail(403, 'SELF_PRIVILEGE_CHANGE', 'You cannot change your own role, board status, or activation.');
    }
    find(state.roles, patch.roleId ?? user.roleId, 'Role');
    if (patch.roleId === 'administrator' && user.roleId !== 'administrator' && input.confirmAdministrator !== true) {
      fail(400,'ADMINISTRATOR_CONFIRMATION_REQUIRED','Explicitly confirm granting administrator privileges.');
    }
    check(!state.users.some(u => u.id !== user.id && u.email === (patch.email ?? user.email)), 'Email is already registered.');
    Object.assign(user, patch);
    if (!update) state.users.push(user);
    preserveAdministrator(state);
    if (update) state.sessions = state.sessions.filter(s => s.userId !== user.id);
    audit(state, actor.id, update ? 'users.update' : 'users.create', user.id, now, {
      previous, current: { roleId: user.roleId, active: user.active, boardMember: user.boardMember },
      passwordChanged: 'passwordHash' in patch, emailChanged: 'email' in patch,
    });
    return publicUser(user);
  });
}

export async function saveRole(store, actor, input, now, update = false) {
  assertAdministrator(actor);
  record(input, ['id', 'name', 'permissions']);
  const name = text(input.name, 'name', 80);
  check(Array.isArray(input.permissions) && input.permissions.every(p => PERMISSIONS.includes(p)), 'Unknown permissions.');
  return store.transaction(state => {
    const role = update ? find(state.roles, id(input.id), 'Role') : { id: newId() };
    if (role.id === actor.roleId) fail(403, 'SELF_PRIVILEGE_CHANGE', 'You cannot modify your own role permissions.');
    const previousPermissions = [...(role.permissions ?? [])];
    Object.assign(role, { name, permissions: [...new Set(input.permissions)] });
    if (!update) state.roles.push(role);
    audit(state, actor.id, update ? 'roles.update' : 'roles.create', role.id, now,
      { previousPermissions, permissions: [...role.permissions] });
    return role;
  });
}

// Local/operator bootstrap only. There is deliberately no public registration endpoint.
export async function bootstrapAdministrator(store, input, now = new Date()) {
  const passwordHash = await hashPassword(input.password);
  const address = email(input.email);
  const name = text(input.name, 'name', 120);
  return store.transaction(state => {
    check(state.users.length === 0 && state.roles.length === 0, 'Bootstrap requires an empty account store.');
    state.roles.push({ id: 'administrator', name: 'Administrator', permissions: [...PERMISSIONS] },
      { id: 'board-member', name: 'Board member', permissions: ['donors.read', 'activities.write', 'tasks.manage', 'outreach.write'] });
    const user = { id: newId(), name, email: address, passwordHash,
      roleId: 'administrator', active: true, boardMember: false };
    state.users.push(user);
    audit(state, user.id, 'users.bootstrap', user.id, now);
    return publicUser(user);
  });
}
