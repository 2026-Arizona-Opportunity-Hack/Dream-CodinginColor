import { getStore } from './retention-store.js';
import { body, fail, respond, sendError, record } from './retention-http.js';
import { requirePermission, contextKey, publicUser, sessionFrom, sameOrigin } from './permissions.js';
import { login, logout, cookie, saveUser, saveRole, assertAdministrator } from './auth.js';
import { assignDonor, listAssignments, saveActivity, listActivities, saveTask, listTasks } from './assignment.js';
import { templates, saveTemplate, saveDraft, approveDraft, sendDraft, listDrafts,
  listSendHistory, generateReminders } from './outreach.js';
import { atRisk, saveRetentionSettings, createReengagement } from './retention.js';
import { clientIdentity } from './client-identity.js';

export function createHandler(route, options = {}) {
  return async (req, res) => {
    try {
      const methods = routes[route];
      const spec = methods && Object.hasOwn(methods,req.method) ? methods[req.method] : null;
      if (!spec) {
        res.setHeader('Allow', Object.keys(methods ?? {}).join(', '));
        fail(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
      }
      const context = { ...options, store: options.store,
        origin: options.origin ?? process.env.APP_ORIGIN, now: options.now ?? (() => new Date()) };
      req[contextKey] = context;
      const actor = spec.public ? null : await requirePermission(req, res, spec.permission);
      if (!spec.public && !actor) return;
      context.store ??= getStore();
      if (spec.admin) assertAdministrator(actor);
      if (!spec.public) {
        const source = context.store;
        const validate = state => {
          const current = sessionFrom(state,req,context.now());
          if (!current) fail(401,'UNAUTHENTICATED','Please sign in.');
          Object.assign(actor,publicUser(current.user),{permissions:[...current.role.permissions],administrator:current.role.id==='administrator'});
          if (spec.permission && !actor.permissions.includes(spec.permission)) fail(403,'FORBIDDEN','Your permission changed. Reload and try again.');
          if (spec.admin) assertAdministrator(actor);
        };
        context.store = {kind:source.kind, read: select => source.read(state => {validate(state);return select(state);}),
          transaction: work => source.transaction(state => {validate(state);return work(state);})};
      }
      const input = ['POST', 'PATCH'].includes(req.method) ? body(req) : req.query ?? {};
      const result = await spec.run({ req, res, actor, input, ...context, time: context.now() });
      respond(res, spec.status ?? 200, { data: result });
    } catch (error) { sendError(res, error); }
  };
}

const routes = {
  'auth/login': { POST: { public: true, run: async ({ req, res, input, store, origin, time }) => {
    sameOrigin(req, origin);
    const result = await login(store, input, clientIdentity(req), time);
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
  'assignments/members': { GET: { permission:'donors.read', run: ({store,actor}) => store.read(s => s.users
    .filter(u => u.boardMember && (u.active || actor.administrator)).map(u => actor.administrator ? publicUser(u) : {id:u.id,name:u.name,active:u.active,boardMember:u.boardMember})) } },
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
