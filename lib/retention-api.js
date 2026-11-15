import {startEnrollment,completeEnrollment,verifySecondFactor,changeSecurity,securityStatus,updateOwnProfile,updatePreferences,requestAccount,reviewAccountRequest} from './account-security.js';
import {assignmentScoped} from './donor-access.js';
import { getStore } from './retention-store.js';
import { body, fail, respond, sendError, record } from './retention-http.js';
import { requirePermission, contextKey, publicUser, sessionFrom, sameOrigin } from './permissions.js';
import { login, logout, cookie, saveUser, saveRole, retireRole,assertAdministrator } from './auth.js';
import { assignDonor,assignInTransaction,createTaskInTransaction, listAssignments, saveActivity, listActivities, saveTask, listTasks } from './assignment.js';
import { templates, saveTemplate, saveDraft, approveDraft, sendDraft, listDrafts,
  listSendHistory, generateReminders, handoffDraft,confirmManualSend } from './outreach.js';
import { atRisk, saveRetentionSettings, createReengagement } from './retention.js';
import { clientIdentity } from './client-identity.js';
import {readEmailSettings,saveEmailSettings,processEmailAutomation,sendApprovedEmail,refreshEmailStatus} from './email-automation.js';
import {sendBoardReminderTest,boardReminderTestHistory} from './board-reminder-test.js';
import {approveAndSendEmail} from './donor-email-approval.js';

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
        origin: options.origin ?? process.env.APP_ORIGIN, now: options.now ?? (() => new Date()),allowPartial:spec.partial===true };
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
          if(!spec.partial&&(!current.session.mfaVerifiedAt||!current.user.totpEnabled))fail(403,'MFA_REQUIRED','Complete two-factor authentication before accessing the workspace.');
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

function authResponse(result,res){
 if(result.token)res.setHeader('Set-Cookie',cookie(result.token));
 const {token,...safe}=result;return safe;
}

const routes = {
  'email/test-reminder':{
    GET:{permission:'settings.manage',admin:true,run:({store,actor})=>boardReminderTestHistory(store,actor)},
    POST:{permission:'settings.manage',admin:true,run:({store,actor,input,time})=>sendBoardReminderTest(store,actor,input,time)},
  },
  'email/settings':{
    GET:{permission:'settings.manage',admin:true,run:({store})=>readEmailSettings(store)},
    POST:{permission:'settings.manage',admin:true,run:({store,actor,input,time})=>saveEmailSettings(store,actor,input,time)},
  },
  'email/run':{POST:{permission:'settings.manage',admin:true,run:({store,actor,input,time})=>{record(input,['confirmed']);if(input.confirmed!==true)fail(400,'CONFIRMATION_REQUIRED','Confirm processing the approved email queue.');return processEmailAutomation(store,actor.id,time);}}},
  'auth/login': { POST: { public: true, run: async ({ req, res, input, store, origin, time }) => {
    sameOrigin(req, origin);
    const result = await login(store, input, clientIdentity(req), time);
    return authResponse(result,res);
  } } },
  'auth/logout': { POST: { partial:true,run: async ({ store, req, res, time }) => {
    await logout(store, req, time);
    res.setHeader('Set-Cookie', cookie('', true));
    return { loggedOut: true };
  } } },
  'auth/me': { GET: {partial:true,run:({store,req,time,actor})=>store.read(state=>{
    const {user,session,role}=sessionFrom(state,req,time);const verified=!!session.mfaVerifiedAt&&user.totpEnabled===true;
    return {user:{...actor,roleName:role.name,preferences:user.preferences||{},permissions:verified?actor.permissions:[]},csrfToken:session.csrfToken,authentication:verified?'authenticated':user.totpEnabled?'verification_required':'enrollment_required'};
  })}},
  'auth/signup':{POST:{public:true,status:202,run:({req,input,store,origin,time})=>{sameOrigin(req,origin);return requestAccount(store,input,clientIdentity(req),time);}}},
  'auth/mfa/enroll':{POST:{partial:true,run:({req,store,input,time})=>startEnrollment(store,req,input,clientIdentity(req),time)}},
  'auth/mfa/confirm':{POST:{partial:true,run:async({req,res,store,input,time})=>authResponse(await completeEnrollment(store,req,input,clientIdentity(req),time),res)}},
  'auth/mfa/verify':{POST:{partial:true,run:async({req,res,store,input,time})=>authResponse(await verifySecondFactor(store,req,input,clientIdentity(req),time),res)}},
  'account/security':{GET:{run:({store,actor,req,time})=>store.read(s=>({...securityStatus(s.users.find(u=>u.id===actor.id)),lastVerifiedAt:sessionFrom(s,req,time).session.mfaVerifiedAt}))}},
  'account/profile':{
    GET:{run:({store,actor})=>store.read(s=>({...publicUser(s.users.find(u=>u.id===actor.id)),roleName:s.roles.find(r=>r.id===actor.roleId).name}))},
    PATCH:{run:({store,actor,input,time})=>updateOwnProfile(store,actor,input,time)},
  },
  'account/preferences':{
    GET:{run:({store,actor})=>store.read(s=>s.users.find(u=>u.id===actor.id).preferences||{startPage:'dashboard',timeZone:'America/Phoenix'})},
    PATCH:{run:({store,actor,input,time})=>updatePreferences(store,actor,input,time)},
  },
  'account/password':{POST:{run:async({req,res,store,input,time})=>authResponse(await changeSecurity(store,req,input,clientIdentity(req),time,'password'),res)}},
  'account/mfa/recovery':{POST:{run:({req,store,input,time})=>changeSecurity(store,req,input,clientIdentity(req),time,'recovery')}},
  'account/mfa/reset':{POST:{run:async({req,res,store,input,time})=>authResponse(await changeSecurity(store,req,input,clientIdentity(req),time,'disable'),res)}},
  'account/mfa/admin-reset':{POST:{permission:'users.manage',admin:true,run:({req,store,input,time})=>changeSecurity(store,req,input,clientIdentity(req),time,'reset')}},
  'account-requests':{
    GET:{permission:'users.manage',admin:true,run:({store})=>store.read(s=>s.accountRequests.filter(r=>r.status==='pending').map(({id,name,email,createdAt})=>({id,name,email,createdAt})))},
    POST:{permission:'users.manage',admin:true,run:({store,actor,input,time})=>reviewAccountRequest(store,actor,input,time)},
  },
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
    GET: { permission: 'donors.read', run: ({ store, input,actor }) => store.read(s => listAssignments(s, input,actor)) },
    POST: { permission: 'assignments.manage', status: 201,
      run: ({ store, input, actor, time }) => assignDonor(store, input, actor.id, time,actor) },
  },
  'roles/retire': {POST:{permission:'roles.manage',admin:true,run:({store,actor,input,time})=>retireRole(store,actor,input,time)}},
  'assignments/balance': {POST:{permission:'assignments.manage',admin:true,run:({store,actor,input,time})=>{
    record(input,[]);return store.transaction(state=>{
      const assigned=[];
      for(const donor of state.donors.filter(d=>d.active)){
        const current=state.assignments.find(a=>a.active&&a.donorId===donor.id);
        if(current&&state.users.some(u=>u.id===current.assigneeId&&u.active&&u.boardMember))continue;
        if(current){current.active=false;current.endedAt=time.toISOString();}
        const assignment=assignInTransaction(state,donor.id,actor.id,time);assigned.push(assignment);
        createTaskInTransaction(state,{donorId:donor.id,assigneeId:assignment.assigneeId,nextAction:'Review donor relationship and next step',dueAt:new Date(+time+7*86400000).toISOString()},actor.id,time,`onboarding:${donor.id}`);
      }return assigned;
    });
  }}},
  'assignments/members': { GET: { permission:'donors.read', run: ({store,actor}) => store.read(s => s.users
    .filter(u => u.boardMember && (u.active || actor.administrator)).map(u => actor.administrator ? publicUser(u) : {id:u.id,name:u.name,active:u.active,boardMember:u.boardMember})) } },
  activities: {
    GET: { permission: 'donors.read', run: ({ store, input,actor }) => store.read(s => listActivities(s, input,actor)) },
    POST: { permission: 'activities.write', status: 201,
      run: ({ store, input, actor, time }) => saveActivity(store, actor, input, time) },
    PATCH: { permission: 'activities.edit',
      run: ({ store, input, actor, time }) => saveActivity(store, actor, input, time, true) },
  },
  tasks: {
    GET: { permission: 'donors.read', run: ({ store, input, time,actor }) => store.read(s => listTasks(s, input, time,actor)) },
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
    GET: { permission: 'donors.read', run: ({ store, input,actor }) => store.read(s => listDrafts(s, input,actor)) },
    POST: { permission: 'outreach.write', status: 201,
      run: ({ store, actor, input, time }) => saveDraft(store, actor, input, time) },
    PATCH: { permission: 'outreach.write',
      run: ({ store, actor, input, time }) => saveDraft(store, actor, input, time, true) },
  },
  'outreach/approve': { POST: { permission: 'outreach.approve',
    run: ({ store, actor, input, time }) => approveDraft(store, actor, input, time) } },
  'outreach/send': { POST: { permission: 'outreach.send',
    run: ({ store, actor, input, time, provider,env }) => sendApprovedEmail(store, actor, input, time, {provider,env}) } },
  'outreach/approve-send':{POST:{permission:'outreach.approve',run:({store,actor,input,time,provider,env})=>approveAndSendEmail(store,actor,input,time,{provider,env})}},
  'outreach/status':{POST:{permission:'outreach.send',run:({store,actor,input,time,provider,env})=>refreshEmailStatus(store,actor,input,time,{provider,env})}},
  'outreach/handoff': { POST: { permission:'outreach.send',run:({store,actor,input,time})=>handoffDraft(store,actor,input,time) } },
  'outreach/confirm-manual': { POST: { permission:'outreach.send',run:({store,actor,input,time})=>confirmManualSend(store,actor,input,time) } },
  'outreach/history': { GET: { permission: 'donors.read',
    run: ({ store, input,actor }) => store.read(s => listSendHistory(s, input,actor)) } },
  'retention/at-risk': {
    GET: { permission: 'reports.read', run: ({ store, input, time,actor }) => {
      record(input, ['mode']);
      return store.read(s => atRisk(s, time,input.mode).filter(d=>!assignmentScoped(actor)||s.assignments.some(a=>a.active&&a.donorId===d.donorId&&a.assigneeId===actor.id)));
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
