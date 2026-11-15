import {assertDonorAccess,assertDraftAccess,canAccessDonor,assignmentScoped} from './donor-access.js';
import { audit, newId } from './retention-store.js';
import { check, fail, find, id, record, text } from './retention-http.js';
import { taskView,createTaskInTransaction } from './assignment.js';

export const DEFAULT_TEMPLATES = Object.freeze([
  { id: 'thank-you-email', name: 'Thank-you email', channel: 'email', requiresDonation: true,
    subject: 'Thank you for supporting Coding in Color',
    body: 'Hello {{donorName}}, thank you for your contribution of {{lastDonationAmount}} on {{lastDonationDate}} to Coding in Color.' },
  { id: 'thank-you-sms', name: 'Thank-you text', channel: 'sms', requiresDonation: true, subject: '',
    body: 'Hello {{donorName}}, thank you for your {{lastDonationAmount}} contribution to Coding in Color on {{lastDonationDate}}.' },
  { id: 'quarterly-update', name: 'Quarterly donor update', channel: 'email', requiresDonation: false,
    subject: 'An update from Coding in Color',
    body: 'Hello {{donorName}}, thank you for being part of the Coding in Color community. We would welcome a conversation about our current work.' },
  { id: 'follow-up', name: 'Follow-up', channel: 'email', requiresDonation: false,
    subject: 'Following up from Coding in Color', body: 'Hello {{donorName}}, we would like to follow up and hear how you would like to stay connected with Coding in Color.' },
  { id: 'reconnection', name: 'Reconnection', channel: 'email', requiresDonation: true,
    subject: 'Reconnect with Coding in Color',
    body: 'Hello {{donorName}}, thank you for your contribution on {{lastDonationDate}}. We would love to reconnect and learn how you would like to stay involved with Coding in Color.' },
]);
const VARIABLES = ['donorName', 'lastDonationAmount', 'lastDonationDate'];
function validDonationDate(value, now) {
  if (typeof value !== 'string'
      || !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z)?$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(+parsed) && parsed <= now && parsed.toISOString().slice(0, 10) === value.slice(0, 10);
}
export function validDonations(state, donorId, now) {
  return state.donations.filter(d => d.donorId === donorId && d.status === 'completed'
    && Number.isSafeInteger(d.amountCents) && d.amountCents > 0
    && typeof d.currency === 'string' && /^[A-Z]{3}$/.test(d.currency)
    && validDonationDate(d.donatedAt, now))
    .sort((a, b) => new Date(b.donatedAt) - new Date(a.donatedAt) || a.id.localeCompare(b.id));
}
export function templates(state) {
  return [...DEFAULT_TEMPLATES.filter(t => !state.templates.some(s => s.id === t.id)), ...state.templates];
}
function templateText(value, name, max) {
  const result = text(value, name, max);
  const stripped = result.replace(/{{\s*([a-zA-Z]+)\s*}}/g, (_, key) => {
    check(VARIABLES.includes(key), `Unknown template variable: ${key}.`);
    return '';
  });
  check(!stripped.includes('{{') && !stripped.includes('}}'), 'Invalid template placeholder.');
  return result;
}
export async function saveTemplate(store, actor, input, now) {
  record(input, ['id', 'name', 'channel', 'requiresDonation', 'subject', 'body']);
  const template = { id: input.id === undefined ? newId() : id(input.id), name: text(input.name, 'name', 100),
    channel: input.channel, requiresDonation: input.requiresDonation,
    subject: input.channel === 'sms' ? '' : templateText(input.subject, 'subject', 200),
    body: templateText(input.body, 'body', 8000) };
  check(['email', 'sms'].includes(template.channel), 'channel must be email or sms.');
  check(typeof template.requiresDonation === 'boolean', 'requiresDonation must be boolean.');
  check(!/[\r\n]/.test(template.subject), 'Subject cannot contain newlines.');
  return store.transaction(state => {
    state.templates = state.templates.filter(t => t.id !== template.id);
    state.templates.push(template);
    audit(state, actor.id, 'outreach.template.update', template.id, now);
    return template;
  });
}

export function previewDraft(state, donorId, templateId, now, donationId) {
  const donor = find(state.donors, donorId, 'Donor');
  const template = find(templates(state), templateId, 'Template');
  const donations = validDonations(state, donorId, now);
  const donation = donationId ? find(donations, donationId, 'Verified donation') : donations[0];
  if (template.requiresDonation && !donation) fail(409, 'NO_VERIFIED_DONATION', 'This template requires a verified completed donation.');
  const variables = { donorName: text(donor.name, 'donor name', 300),
    lastDonationDate: donation ? new Date(donation.donatedAt).toISOString().slice(0, 10) : null,
    lastDonationAmount: donation ? `${donation.currency} ${Math.trunc(donation.amountCents / 100)}.${String(donation.amountCents % 100).padStart(2, '0')}` : null };
  const render = value => value.replace(/{{\s*([a-zA-Z]+)\s*}}/g, (_, key) => {
    check(VARIABLES.includes(key) && variables[key] !== null, `Verified data is required for ${key}.`);
    return variables[key];
  });
  const subject = render(template.subject);
  const body = render(template.body);
  check(!/[\r\n]/.test(subject) && subject.length <= 200, 'Rendered subject is invalid or too long.');
  check(body.length <= 8000, 'Rendered body is too long.');
  return { donorId, channel: template.channel, templateId, subject, body, donationId: donation?.id ?? null };
}

export function createDraftInTransaction(state, proposal, actorId, now, eventKey) {
  if (eventKey) {
    const existing = state.drafts.find(d => d.eventKey === eventKey);
    if (existing) return existing;
  }
  const draft = { ...proposal, id: newId(), audience: proposal.audience ?? 'donor',
    status: 'draft', revision: 1, approvedRevision: null, approvedBy: null,
    createdBy: actorId, createdAt: now.toISOString(), updatedAt: now.toISOString(),
    ...(eventKey ? { eventKey } : {}) };
  state.drafts.push(draft);
  audit(state, actorId, 'outreach.draft.create', draft.id, now);
  return draft;
}
export async function saveDraft(store, actor, input, now, update = false) {
  record(input, update ? ['id', 'revision', 'subject', 'body'] : ['donorId', 'templateId', 'donationId']);
  return store.transaction(state => {
    if (!update) {assertDonorAccess(state,actor,input.donorId);return createDraftInTransaction(state, previewDraft(state, id(input.donorId, 'donorId'),
      id(input.templateId, 'templateId'), now, input.donationId === undefined ? undefined : id(input.donationId, 'donationId')), actor.id, now);}
    const draft = find(state.drafts, id(input.id), 'Draft');assertDraftAccess(state,actor,draft);
    checkRevision(draft, input.revision);
    if (['handed_off','sending', 'sent'].includes(draft.status) || draft.outcomeUnknown) fail(409, 'DRAFT_LOCKED', 'This draft cannot be edited.');
    check(input.body !== undefined || input.subject !== undefined, 'Supply subject or body.');
    const before = { subject: draft.subject, body: draft.body, revision: draft.revision };
    if (input.body !== undefined) draft.body = text(input.body, 'body', 8000);
    if (input.subject !== undefined) {
      draft.subject = draft.channel === 'sms' && input.subject === '' ? '' : text(input.subject, 'subject', 200);
      check(!/[\r\n]/.test(draft.subject), 'Subject cannot contain newlines.');
    }
    draft.revisions = [...(draft.revisions ?? []), { ...before, changedBy: actor.id, changedAt: now.toISOString() }];
    Object.assign(draft, { revision: draft.revision + 1, status: 'draft', approvedRevision: null,
      approvedBy: null, approvedAt: null, updatedAt: now.toISOString() });
    audit(state, actor.id, 'outreach.draft.update', draft.id, now);
    return draft;
  });
}
function checkRevision(draft, revision) {
  check(Number.isSafeInteger(revision) && revision > 0, 'A positive revision is required.');
  if (draft.revision !== revision) fail(409, 'REVISION_CONFLICT', 'The draft has changed. Reload and review it.');
}
function recipient(state, draft) {
  if (draft.audience === 'board') {
    const member = find(state.users, draft.userId, 'Board member');
    if (!member.active || !member.boardMember) fail(409, 'RECIPIENT_INACTIVE', 'Board member is inactive.');
    check(typeof member.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(member.email), 'A valid board-member email is required.');
    return member.email;
  }
  const donor = find(state.donors, draft.donorId, 'Donor');
  if (!donor.active || donor.optedOut === true || donor.contactPreferences?.[draft.channel] !== true) {
    fail(409, 'CONTACT_NOT_ALLOWED', 'The donor has not opted in to this contact channel or is inactive.');
  }
  const target = draft.channel === 'email' ? donor.email : donor.phone;
  check(typeof target === 'string' && (draft.channel === 'email'
    ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target) : /^\+[1-9]\d{7,14}$/.test(target)), 'A valid contact address is required.');
  return target;
}
export async function approveDraft(store, actor, input, now) {
  record(input, ['id', 'revision']);
  return store.transaction(state => {
    const draft = find(state.drafts, id(input.id), 'Draft');assertDraftAccess(state,actor,draft);
    checkRevision(draft, input.revision);
    if (draft.status !== 'draft') fail(409, 'INVALID_DRAFT_STATE', 'Only a draft can be approved.');
    recipient(state, draft);
    Object.assign(draft, { status: 'approved', approvedBy: actor.id, approvedRevision: draft.revision,
      approvedAt: now.toISOString(), updatedAt: now.toISOString() });
    audit(state, actor.id, 'outreach.approve', draft.id, now);
    return draft;
  });
}

export async function sendDraft(store, actor, input, now, provider) {
  record(input, ['id', 'revision']);
  const draftId = id(input.id);
  const claim = await store.transaction(state => {
    const draft = find(state.drafts, draftId, 'Draft');assertDraftAccess(state,actor,draft);
    checkRevision(draft, input.revision);
    if (draft.status === 'sent') return { alreadySent: true, draft };
    if (draft.status !== 'approved' || draft.approvedRevision !== draft.revision || !draft.approvedBy) {
      fail(409, 'APPROVAL_REQUIRED', 'The current draft must be approved before sending.');
    }
    const to = recipient(state, draft); // Recheck consent immediately before claiming a send.
    const deliver = draft.channel === 'email' ? provider?.sendEmail : provider?.sendSms;
    if (typeof deliver !== 'function') fail(503, 'DRAFT_MODE', 'No delivery provider is configured; this message remains unsent.');
    draft.status = 'sending';
    draft.updatedAt = now.toISOString();
    const attemptId = newId();
    state.sendHistory.push({ id: newId(), draftId, attemptId, status: 'sending',
      revision: draft.revision, subject: draft.subject, body: draft.body, recipient: to,
      approvedBy: draft.approvedBy, actorId: actor.id, at: now.toISOString() });
    return { draft, to, attemptId };
  });
  if (claim.alreadySent) return claim.draft;
  let receipt;
  try {
    const deliver = claim.draft.channel === 'email' ? provider.sendEmail : provider.sendSms;
    receipt = await deliver.call(provider, { to: claim.to, subject: claim.draft.subject,
      text: claim.draft.body, idempotencyKey: `${draftId}:${claim.draft.revision}` });
    if (receipt?.status !== 'sent' || typeof receipt.id !== 'string' || !receipt.id) throw new Error('Unconfirmed provider response');
  } catch (error) {
    // Do not store raw provider errors: they can contain credentials and donor addresses.
    await store.transaction(state => {
      const draft = find(state.drafts, draftId);
      Object.assign(draft, { status: 'failed', outcomeUnknown: error?.definitelyNotSent !== true });
      state.sendHistory.push({ id: newId(), draftId, attemptId: claim.attemptId,
        status: 'failed', code: 'DELIVERY_FAILED', outcomeUnknown: draft.outcomeUnknown, at: now.toISOString() });
      audit(state, actor.id, 'outreach.failed', draftId, now);
    });
    fail(502, 'DELIVERY_FAILED', 'Delivery was not confirmed. Review send history before retrying.');
  }
  return store.transaction(state => {
    const draft = find(state.drafts, draftId);
    Object.assign(draft, { status: 'sent', sentAt: now.toISOString(), providerId: receipt.id });
    state.sendHistory.push({ id: newId(), draftId, attemptId: claim.attemptId,
      status: 'sent', providerId: receipt.id, at: now.toISOString() });
    audit(state, actor.id, 'outreach.sent', draftId, now);
    return draft;
  });
}

export function listDrafts(state, query,actor) {
  record(query, ['donorId', 'status', 'audience']);
  if (query.donorId !== undefined) id(query.donorId, 'donorId');
  if (query.status !== undefined) check(['draft', 'approved', 'handed_off', 'sending', 'failed', 'sent'].includes(query.status), 'Unknown draft status.');
  if (query.audience !== undefined) check(['donor', 'board'].includes(query.audience), 'Unknown audience.');
  return state.drafts.filter(d => (!assignmentScoped(actor)||(d.audience==='board'?d.userId===actor.id:canAccessDonor(state,actor,d.donorId))) && (!query.donorId || d.donorId === query.donorId)
    && (!query.status || d.status === query.status) && (!query.audience || d.audience === query.audience)).map(d=>{
      const donor=canAccessDonor(state,actor,d.donorId)?state.donors.find(x=>x.id===d.donorId):null,member=d.audience==='board'?state.users.find(x=>x.id===d.userId):null;
      const gift=donor&&d.donationId?state.donations.find(g=>g.id===d.donationId&&g.donorId===d.donorId):null;
      return {...d,donorName:donor?.name||null,recipientName:member?.name||null,recipientEmail:d.channel==='email'?(member?.email||donor?.email||null):null,
        gift:gift?{amountCents:gift.amountCents,currency:gift.currency,status:gift.status,donatedAt:gift.donatedAt}:null};
    });
}
export function listSendHistory(state, query,actor) {
  record(query, ['draftId', 'donorId']);
  if (query.draftId !== undefined) id(query.draftId, 'draftId');
  if (query.donorId !== undefined) id(query.donorId, 'donorId');
  const drafts = new Set(listDrafts(state,{},actor).filter(d => !query.donorId || d.donorId === query.donorId).map(d => d.id));
  return state.sendHistory.filter(h => drafts.has(h.draftId) && (!query.draftId || h.draftId === query.draftId));
}

// Internal reminders use the same human approval workflow and never send automatically.
export async function generateReminders(store, actor, now, kind) {
  check(['quarterly', 'donor-quarterly', 'overdue'].includes(kind), 'Unknown reminder kind.');
  return store.transaction(state => {
    const period = `${now.getUTCFullYear()}-Q${Math.floor(now.getUTCMonth() / 3) + 1}`;
    const generated = [];
    if(kind==='donor-quarterly'){
      const start=`${now.getUTCFullYear()}-${String(Math.floor(now.getUTCMonth()/3)*3+1).padStart(2,'0')}-01`;
      for(const donor of state.donors.filter(d=>d.active)){
        const key=`donor-quarterly:${period}:${donor.id}`;
        const proposal=previewDraft(state,donor.id,'quarterly-update',now);
        const gifts=validDonations(state,donor.id,now).filter(g=>g.donatedAt.slice(0,10)>=start);
        const totals=new Map();for(const gift of gifts)totals.set(gift.currency,(totals.get(gift.currency)||0)+gift.amountCents);
        const report=[...totals].map(([currency,cents])=>`${currency} ${(cents/100).toFixed(2)}`).join('; ')||'No verified completed gifts recorded for this period.';
        proposal.body+=`\n\nGiving report: ${start} through ${now.toISOString().slice(0,10)}. ${report}\nThank you for helping Coding in Color develop Arizona’s future digital workforce.`;
        generated.push(createDraftInTransaction(state,proposal,actor.id,now,key));
        const assignment=state.assignments.find(a=>a.active&&a.donorId===donor.id&&state.users.some(u=>u.id===a.assigneeId&&u.active&&u.boardMember));
        if(assignment)createTaskInTransaction(state,{donorId:donor.id,assigneeId:assignment.assigneeId,nextAction:'Review and send the quarterly donor update',dueAt:new Date(+now+7*86400000).toISOString()},actor.id,now,key);
      }
      return generated;
    }
    for (const member of state.users.filter(u => u.active && u.boardMember && (!assignmentScoped(actor)||u.id===actor.id))) {
      const assigned = state.assignments.filter(a => a.active && a.assigneeId === member.id
        && state.donors.some(d => d.id === a.donorId && d.active));
      const overdue = state.tasks.filter(t => t.assigneeId === member.id && taskView(t, now) === 'overdue');
      if (kind === 'quarterly') {
        const eventKey = `quarterly:${period}:${member.id}`;
        const donorNames = assigned.map(a => find(state.donors, a.donorId).name).join(', ') || 'None';
        generated.push(createDraftInTransaction(state, { audience: 'board', userId: member.id, channel: 'email',
          subject: `Coding in Color assignment summary: ${period}`,
          body: `Your active donor assignments (${assigned.length}): ${donorNames}. Overdue follow-up tasks: ${overdue.length}.` }, actor.id, now, eventKey));
      } else {
        for (const task of overdue) {
          generated.push(createDraftInTransaction(state, { audience: 'board', userId: member.id, channel: 'email',
            subject: 'Coding in Color: follow-up task is overdue',
            body: `Next action: ${task.nextAction}. Due: ${task.dueAt}. Review this task in ColorLoop.` },
          actor.id, now, `task-reminder:${task.id}:${task.dueAt}`));
        }
      }
    }
    return generated;
  });
}

export function prepareThankYou(state,donationId,actorId,now){
  const gift=state.donations.find(g=>g.id===donationId);
  if(!gift||!validDonations(state,gift.donorId,now).some(g=>g.id===gift.id))return null;
  const donor=state.donors.find(d=>d.id===gift.donorId&&d.active);if(!donor)return null;
  const template=donor.contactPreferences?.email!==true&&donor.contactPreferences?.sms===true?'thank-you-sms':'thank-you-email';
  return createDraftInTransaction(state,previewDraft(state,donor.id,template,now,gift.id),actorId,now,`thank-you:${gift.id}`);
}

// A handoff records preparation, not delivery. External sending remains a human action.
export async function handoffDraft(store,actor,input,now){
  record(input,['id','revision']);
  return store.transaction(state=>{
    const draft=find(state.drafts,id(input.id),'Draft');assertDraftAccess(state,actor,draft);checkRevision(draft,input.revision);
    if(draft.status==='handed_off'){
      const to=recipient(state,draft),original=state.sendHistory.find(h=>h.draftId===draft.id&&h.status==='handed_off'&&h.revision===draft.revision);
      if(!original||original.recipient!==to)fail(409,'RECIPIENT_CHANGED','The recipient changed after handoff. Prepare and review a new message.');
      return {draft,to,subject:draft.subject,text:draft.body};
    }
    if(draft.status!=='approved'||draft.approvedRevision!==draft.revision||!draft.approvedBy)fail(409,'APPROVAL_REQUIRED','Approve the current saved revision before handing it off.');
    const to=recipient(state,draft);
    Object.assign(draft,{status:'handed_off',handedOffAt:now.toISOString(),handedOffBy:actor.id,updatedAt:now.toISOString()});
    state.sendHistory.push({id:newId(),draftId:draft.id,attemptId:newId(),status:'handed_off',revision:draft.revision,subject:draft.subject,body:draft.body,recipient:to,approvedBy:draft.approvedBy,actorId:actor.id,at:now.toISOString()});
    audit(state,actor.id,'outreach.handoff',draft.id,now);
    return {draft,to,subject:draft.subject,text:draft.body};
  });
}

export async function confirmManualSend(store,actor,input,now){
  record(input,['id','revision','reference']);const reference=text(input.reference,'Human send evidence/reference',1000);
  return store.transaction(state=>{
    const draft=find(state.drafts,id(input.id),'Draft');assertDraftAccess(state,actor,draft);checkRevision(draft,input.revision);
    if(draft.status==='sent')return draft;
    if(draft.status!=='handed_off'||draft.approvedRevision!==draft.revision)fail(409,'HANDOFF_REQUIRED','Hand off the approved message before recording a human send.');
    const to=recipient(state,draft);
    const original=state.sendHistory.find(h=>h.draftId===draft.id&&h.status==='handed_off'&&h.revision===draft.revision);
    if(!original||original.recipient!==to)fail(409,'RECIPIENT_CHANGED','The recipient changed after handoff. Review the original message before recording delivery.');
    Object.assign(draft,{status:'sent',sentAt:now.toISOString(),manualSendReference:reference,updatedAt:now.toISOString()});
    state.sendHistory.push({id:newId(),draftId:draft.id,attemptId:newId(),status:'sent',revision:draft.revision,subject:draft.subject,body:draft.body,recipient:to,approvedBy:draft.approvedBy,actorId:actor.id,at:now.toISOString(),providerId:'human-attested'});
    audit(state,actor.id,'outreach.manual-send',draft.id,now,{reference});
    return draft;
  });
}
