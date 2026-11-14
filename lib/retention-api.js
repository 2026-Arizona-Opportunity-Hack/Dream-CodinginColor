import { getStore } from './retention-store.js';
import { body, fail, respond, sendError, record } from './retention-http.js';
import { requirePermission, contextKey, publicUser, sessionFrom, sameOrigin } from './permissions.js';
import { login, logout, cookie, saveUser, saveRole, assertAdministrator } from './auth.js';
import { assignDonor, listAssignments, saveActivity, listActivities, saveTask, listTasks } from './assignment.js';
import { templates, saveTemplate, saveDraft, approveDraft, sendDraft, listDrafts,
  listSendHistory, generateReminders } from './outreach.js';
import { atRisk, saveRetentionSettings, createReengagement } from './retention.js';

export function createHandler(route, options = {}) {
  return async (req, res) => {
    try {
      const methods = routes[route];
      const spec = methods?.[req.method];
      if (!spec) {
        res.setHeader('Allow', Object.keys(methods ?? {}).join(', '));
        fail(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
      }
      const context = { ...options, store: options.store ?? getStore(),
        origin: options.origin ?? process.env.APP_ORIGIN, now: options.now ?? (() => new Date()) };
      req[contextKey] = context;
      const actor = spec.public ? null : await requirePermission(req, res, spec.permission);
      if (!spec.public && !actor) return;
      if (spec.admin) assertAdministrator(actor);
      const input = ['POST', 'PATCH'].includes(req.method) ? body(req) : req.query ?? {};
      const result = await spec.run({ req, res, actor, input, ...context, time: context.now() });
      respond(res, spec.status ?? 200, { data: result });
    } catch (error) { sendError(res, error); }
  };
}

const routes = {
  'auth/login': { POST: { public: true, run: async ({ req, res, input, store, origin, time }) => {
    sameOrigin(req, origin);
    // socket address is trusted; arbitrary forwarded headers must not defeat throttling.
    const result = await login(store, input, req.socket?.remoteAddress, time);
    res.setHeader('Set-Cookie', cookie(result.token));
    return { user: result.user, csrfToken: result.csrfToken };
  } } },
  'auth/logout': { POST: { run: async ({ store, req, res, time }) => {
    await logout(store, req, time);
    res.setHeader('Set-Cookie', cookie('', true));
    return { loggedOut: true };
  } } },
  'auth/me': { GET: { run: async ({ store, req, time, actor }) => store.read(state => ({
    user: actor, csrfToken: sessionFrom(state, req, time).session.csrfToken,
  })) } },
  users: {
    GET: { permission: 'users.manage', admin: true, run: ({ store }) => store.read(s => s.users.map(publicUser)) },
    POST: { permission: 'users.manage', admin: true, status: 201,
      run: ({ store, actor, input, time }) => saveUser(store, actor, input, time) },
    PATCH: { permission: 'users.manage', admin: true,
      run: ({ store, actor, input, time }) => saveUser(store, actor, input, time, true) },
  },
  roles: {
    GET: { permission: 'roles.manage', admin: true, run: ({ store }) => store.read(s => s.roles) },
    POST: { permission: 'roles.manage', admin: true, status: 201,
      run: ({ store, actor, input, time }) => saveRole(store, actor, input, time) },
    PATCH: { permission: 'roles.manage', admin: true,
      run: ({ store, actor, input, time }) => saveRole(store, actor, input, time, true) },
  },
  assignments: {
    GET: { permission: 'donors.read', run: ({ store, input }) => store.read(s => listAssignments(s, input)) },
    POST: { permission: 'assignments.manage', status: 201,
      run: ({ store, input, actor, time }) => assignDonor(store, input, actor.id, time) },
  },
  activities: {
    GET: { permission: 'donors.read', run: ({ store, input }) => store.read(s => listActivities(s, input)) },
    POST: { permission: 'activities.write', status: 201,
      run: ({ store, input, actor, time }) => saveActivity(store, actor, input, time) },
    PATCH: { permission: 'activities.edit',
      run: ({ store, input, actor, time }) => saveActivity(store, actor, input, time, true) },
  },
  tasks: {
    GET: { permission: 'donors.read', run: ({ store, input, time }) => store.read(s => listTasks(s, input, time)) },
    POST: { permission: 'tasks.manage', status: 201,
      run: ({ store, input, actor, time }) => saveTask(store, actor, input, time) },
    PATCH: { permission: 'tasks.manage',
      run: ({ store, input, actor, time }) => saveTask(store, actor, input, time, true) },
  },
  'tasks/reminders': { POST: { permission: 'tasks.manage',
    run: ({ store, actor, input, time }) => {
      record(input, ['kind']);
      if (!actor.permissions.includes('outreach.write')) fail(403, 'FORBIDDEN', 'outreach.write is also required.');
      return generateReminders(store, actor, time, input.kind);
    } } },
  'outreach/templates': {
    GET: { permission: 'outreach.write', run: ({ store }) => store.read(templates) },
    POST: { permission: 'settings.manage', admin: true,
      run: ({ store, actor, input, time }) => saveTemplate(store, actor, input, time) },
  },
  'outreach/drafts': {
    GET: { permission: 'donors.read', run: ({ store, input }) => store.read(s => listDrafts(s, input)) },
    POST: { permission: 'outreach.write', status: 201,
      run: ({ store, actor, input, time }) => saveDraft(store, actor, input, time) },
    PATCH: { permission: 'outreach.write',
      run: ({ store, actor, input, time }) => saveDraft(store, actor, input, time, true) },
  },
  'outreach/approve': { POST: { permission: 'outreach.approve',
    run: ({ store, actor, input, time }) => approveDraft(store, actor, input, time) } },
  'outreach/send': { POST: { permission: 'outreach.send',
    run: ({ store, actor, input, time, provider }) => sendDraft(store, actor, input, time, provider) } },
  'outreach/history': { GET: { permission: 'donors.read',
    run: ({ store, input }) => store.read(s => listSendHistory(s, input)) } },
  'retention/at-risk': {
    GET: { permission: 'reports.read', run: ({ store, input, time }) => {
      record(input, []);
      return store.read(s => atRisk(s, time));
    } },
    POST: { permission: 'tasks.manage', status: 201,
      run: ({ store, actor, input, time }) => createReengagement(store, actor, input, time) },
  },
  'retention/settings': {
    GET: { permission: 'reports.read', run: ({ store }) => store.read(s => s.settings) },
    PATCH: { permission: 'settings.manage', admin: true,
      run: ({ store, actor, input, time }) => saveRetentionSettings(store, actor, input, time) },
  },
};
