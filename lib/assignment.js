import { audit, newId } from './retention-store.js';
import { check, fail, find, id, record, text, date } from './retention-http.js';

export function assignInTransaction(state, donorId, actorId, now, assigneeId) {
  const donor = find(state.donors, donorId, 'Donor');
  const existing = state.assignments.find(a => a.donorId === donorId && a.active);
  if (existing && (!assigneeId || existing.assigneeId === assigneeId)) return existing;
  check(donor.active === true, 'Only active donors can receive new assignments.');
  let member;
  if (assigneeId) {
    member = find(state.users, assigneeId, 'Board member');
    check(member.active && member.boardMember, 'Assignee must be an active board member.');
  } else {
    const activeDonors = new Set(state.donors.filter(d => d.active).map(d => d.id));
    const load = user => state.assignments.filter(a => a.active
      && a.assigneeId === user.id && activeDonors.has(a.donorId)).length;
    member = state.users.filter(u => u.active && u.boardMember)
      .sort((a, b) => load(a) - load(b) || a.id.localeCompare(b.id))[0];
    if (!member) fail(409, 'NO_ACTIVE_BOARD_MEMBER', 'No active board member is available.');
  }
  if (existing) Object.assign(existing, { active: false, endedAt: now.toISOString() });
  const assignment = { id: newId(), donorId, assigneeId: member.id, active: true,
    assignedAt: now.toISOString(), assignedBy: actorId ?? null };
  state.assignments.push(assignment);
  audit(state, actorId ?? null, existing ? 'assignments.reassign' : 'assignments.create', assignment.id, now);
  return assignment;
}

// Imports should call assignInTransaction in the SAME donor-upsert transaction.
export async function assignDonor(store, input, actorId, now = new Date()) {
  record(input, ['donorId', 'assigneeId']);
  const donorId = id(input.donorId, 'donorId');
  const assigneeId = input.assigneeId === undefined ? undefined : id(input.assigneeId, 'assigneeId');
  return store.transaction(state => assignInTransaction(state, donorId, actorId, now, assigneeId));
}

export function listAssignments(state, query) {
  record(query, ['donorId', 'assigneeId', 'history']);
  const donorId = query.donorId === undefined ? undefined : id(query.donorId, 'donorId');
  const assigneeId = query.assigneeId === undefined ? undefined : id(query.assigneeId, 'assigneeId');
  check(query.history === undefined || query.history === 'true', 'history must be true when supplied.');
  return state.assignments.filter(a => (query.history === 'true' || a.active)
    && (!donorId || a.donorId === donorId) && (!assigneeId || a.assigneeId === assigneeId))
    .map(a => ({ ...a, boardMember: (() => {
      const u = state.users.find(u => u.id === a.assigneeId);
      return u ? { id: u.id, name: u.name, active: u.active } : null;
    })() }));
}

const ACTIVITY_TYPES = ['call', 'meeting', 'email', 'text', 'note'];
const TASK_STATUSES = ['open', 'in_progress', 'completed', 'cancelled'];
export async function saveActivity(store, actor, input, now, update = false) {
  record(input, update ? ['id', 'type', 'content', 'occurredAt'] : ['donorId', 'type', 'content', 'occurredAt']);
  if (update && !actor.permissions.includes('activities.edit')) {
    fail(403, 'FORBIDDEN', 'Editing activities requires activities.edit.');
  }
  check(ACTIVITY_TYPES.includes(input.type), 'Unknown activity type.');
  const content = text(input.content, 'content', 4000);
  const occurredAt = input.occurredAt === undefined ? undefined : date(input.occurredAt, 'occurredAt');
  if (occurredAt) check(new Date(occurredAt) <= now, 'Activities cannot occur in the future.');
  return store.transaction(state => {
    const activity = update ? find(state.activities, id(input.id), 'Activity') : {
      id: newId(), donorId: id(input.donorId, 'donorId'), createdBy: actor.id, createdAt: now.toISOString(),
    };
    find(state.donors, activity.donorId, 'Donor');
    if (update) state.activityHistory.push({ ...activity, historyId: newId(), replacedBy: actor.id, replacedAt: now.toISOString() });
    Object.assign(activity, { type: input.type, content, occurredAt: occurredAt ?? activity.occurredAt ?? now.toISOString(),
      updatedBy: actor.id, updatedAt: now.toISOString() });
    if (!update) state.activities.push(activity);
    audit(state, actor.id, update ? 'activities.update' : 'activities.create', activity.id, now);
    return activity;
  });
}

export function createTaskInTransaction(state, input, actorId, now, eventKey) {
  const donorId = id(input.donorId, 'donorId');
  find(state.donors, donorId, 'Donor');
  if (eventKey) {
    const existing = state.tasks.find(t => t.eventKey === eventKey);
    if (existing) return existing;
  }
  const assigneeId = id(input.assigneeId, 'assigneeId');
  const assignee = find(state.users, assigneeId, 'Assignee');
  check(assignee.active, 'Assignee must be active.');
  const task = { id: newId(), donorId, nextAction: text(input.nextAction, 'nextAction', 300),
    dueAt: date(input.dueAt, 'dueAt'), assigneeId, status: 'open',
    description: input.description === undefined || input.description === '' ? '' : text(input.description, 'description', 4000),
    createdBy: actorId, createdAt: now.toISOString(), updatedAt: now.toISOString(),
    ...(eventKey ? { eventKey } : {}) };
  state.tasks.push(task);
  audit(state, actorId, 'tasks.create', task.id, now);
  return task;
}

export async function saveTask(store, actor, input, now, update = false) {
  record(input, update ? ['id', 'nextAction', 'dueAt', 'assigneeId', 'status', 'description']
    : ['donorId', 'nextAction', 'dueAt', 'assigneeId', 'description']);
  return store.transaction(state => {
    if (!update) return createTaskInTransaction(state, input, actor.id, now);
    const task = find(state.tasks, id(input.id), 'Task');
    if (input.nextAction !== undefined) task.nextAction = text(input.nextAction, 'nextAction', 300);
    if (input.dueAt !== undefined) task.dueAt = date(input.dueAt, 'dueAt');
    if (input.assigneeId !== undefined) {
      const user = find(state.users, id(input.assigneeId, 'assigneeId'), 'Assignee');
      check(user.active, 'Assignee must be active.');
      task.assigneeId = user.id;
    }
    if (input.status !== undefined) {
      check(TASK_STATUSES.includes(input.status), 'Unknown task status.');
      task.status = input.status;
      task.completedAt = input.status === 'completed' ? now.toISOString() : null;
    }
    if (input.description !== undefined) task.description = input.description === '' ? '' : text(input.description, 'description', 4000);
    task.updatedAt = now.toISOString();
    audit(state, actor.id, 'tasks.update', task.id, now);
    return task;
  });
}

export function taskView(task, now) {
  return ['open', 'in_progress'].includes(task.status)
    ? new Date(task.dueAt) < now ? 'overdue' : 'upcoming' : task.status;
}
export function listTasks(state, query, now) {
  record(query, ['donorId', 'assigneeId', 'view']);
  if (query.view !== undefined) check(['overdue', 'upcoming', 'completed', 'cancelled'].includes(query.view), 'Unknown task view.');
  if (query.donorId !== undefined) id(query.donorId, 'donorId');
  if (query.assigneeId !== undefined) id(query.assigneeId, 'assigneeId');
  return state.tasks.filter(t => (!query.donorId || t.donorId === query.donorId)
    && (!query.assigneeId || t.assigneeId === query.assigneeId) && (!query.view || taskView(t, now) === query.view))
    .map(t => ({ ...t, view: taskView(t, now) })).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

export function listActivities(state, query) {
  record(query, ['donorId', 'history']);
  if (query.donorId !== undefined) id(query.donorId, 'donorId');
  check(query.history === undefined || query.history === 'true', 'history must be true when supplied.');
  return state.activities.filter(a => !query.donorId || a.donorId === query.donorId)
    .map(a => ({ ...a, ...(query.history === 'true' ? {
      history: state.activityHistory.filter(h => h.id === a.id),
    } : {}) })).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}
