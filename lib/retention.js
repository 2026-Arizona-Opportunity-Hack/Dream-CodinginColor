import { audit, newId } from './retention-store.js';
import { check, fail, id, record } from './retention-http.js';
import { assertAdministrator } from './auth.js';
import { createTaskInTransaction, taskView } from './assignment.js';
import { validDonations, previewDraft, createDraftInTransaction } from './outreach.js';

// Calendar months, clamped to the last day (Jan 31 + 1 month = Feb 28/29).
export function addMonths(value, months) {
  const date = new Date(value);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date;
}

export function atRisk(state, now) {
  const threshold = state.settings.inactivityMonths;
  check(Number.isInteger(threshold) && threshold >= 1 && threshold <= 120, 'Invalid inactivity setting.');
  const results = [];
  for (const donor of state.donors.filter(d => d.active)) {
    const donations = validDonations(state, donor.id, now);
    const last = donations[0];
    if (!last) continue; // No giving history is not evidence of a lapse.
    const thresholdAt = addMonths(last.donatedAt, threshold);
    if (thresholdAt > now) continue;
    const eventKey = `lapse:${donor.id}:${last.id}`;
    const assignment = state.assignments.find(a => a.active && a.donorId === donor.id);
    const assignee = assignment && state.users.find(u => u.id === assignment.assigneeId && u.active && u.boardMember);
    const overdueTasks = state.tasks.filter(t => t.donorId === donor.id && taskView(t, now) === 'overdue');
    const intervals = donations.slice(0, -1).map((d, i) =>
      Math.round((new Date(d.donatedAt) - new Date(donations[i + 1].donatedAt)) / 86400000));
    const reason = `Last completed contribution was on ${new Date(last.donatedAt).toISOString().slice(0, 10)}. `
      + `The configured ${threshold}-month inactivity threshold was reached on ${thresholdAt.toISOString().slice(0, 10)}.`;
    const nextAction = 'Review donor relationship and reconnection draft';
    const proposal = { donorId: donor.id, nextAction, assigneeId: assignee?.id ?? null,
      dueAt: new Date(+now + 7 * 86400000).toISOString(), description: reason };
    results.push({ donorId: donor.id, donorName: donor.name, eventKey, lastDonationId: last.id,
      lastDonationAt: last.donatedAt, inactivityDays: Math.floor((now - new Date(last.donatedAt)) / 86400000),
      inactivityMonths: threshold, thresholdAt: thresholdAt.toISOString(), reason,
      givingHistory: { completedDonationCount: donations.length, intervalsDays: intervals },
      overdueFollowUpTaskIds: overdueTasks.map(t => t.id),
      outreachAllowed: donor.optedOut !== true && donor.contactPreferences?.email === true,
      proposedTask: proposal, proposedDraft: previewDraft(state, donor.id, 'reconnection', now, last.id),
      existingTaskId: state.tasks.find(t => t.eventKey === eventKey)?.id ?? null,
      existingDraftId: state.drafts.find(d => d.eventKey === eventKey)?.id ?? null,
    });
  }
  return results.sort((a, b) => b.inactivityDays - a.inactivityDays || a.donorId.localeCompare(b.donorId));
}

export async function saveRetentionSettings(store, actor, input, now) {
  assertAdministrator(actor);
  record(input, ['inactivityMonths']);
  check(Number.isInteger(input.inactivityMonths) && input.inactivityMonths >= 1 && input.inactivityMonths <= 120,
    'inactivityMonths must be an integer from 1 through 120.');
  return store.transaction(state => {
    const previous = state.settings.inactivityMonths;
    state.settings.inactivityMonths = input.inactivityMonths;
    audit(state, actor.id, 'retention.settings.update', 'inactivityMonths', now);
    state.events.push({ id: newId(), type: 'retention.settings', previous,
      value: input.inactivityMonths, actorId: actor.id, at: now.toISOString() });
    return state.settings;
  });
}

// Explicit POST action: GET radar previews never create tasks or drafts.
export async function createReengagement(store, actor, input, now) {
  record(input, ['donorId']);
  if (!['tasks.manage', 'outreach.write'].every(p => actor.permissions.includes(p))) {
    fail(403, 'FORBIDDEN', 'Creating a nudge requires tasks.manage and outreach.write.');
  }
  return store.transaction(state => {
    const flagged = atRisk(state, now).find(d => d.donorId === id(input.donorId, 'donorId'));
    if (!flagged) fail(409, 'DONOR_NOT_LAPSED', 'This donor does not currently meet the inactivity threshold.');
    if (!flagged.proposedTask.assigneeId) fail(409, 'ASSIGNMENT_REQUIRED', 'Assign an active board member before creating a nudge.');
    const task = createTaskInTransaction(state, flagged.proposedTask, actor.id, now, flagged.eventKey);
    const draft = createDraftInTransaction(state, flagged.proposedDraft, actor.id, now, flagged.eventKey);
    if (!state.events.some(e => e.key === flagged.eventKey)) {
      state.events.push({ id: newId(), key: flagged.eventKey, type: 'retention.nudge', donorId: flagged.donorId,
        donationId: flagged.lastDonationId, taskId: task.id, draftId: draft.id, actorId: actor.id, at: now.toISOString() });
    }
    return { task, draft, reason: flagged.reason };
  });
}
