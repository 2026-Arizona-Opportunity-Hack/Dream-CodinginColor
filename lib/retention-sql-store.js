import { emptyState, newId } from './retention-store.js';
import { donorToRetention, donationToRetention, iso } from './data-mapping.js';
import { PERMISSIONS } from './permissions.js';
import { ApiError } from './retention-http.js';

// Normalized SQL unit of work. Callbacks retain existing workflow contracts;
// only changed rows are persisted. A shared lock also covers imports and merges.
const definitions = [
  ['users', 'users', { id:'id', name:'name', email:'email', passwordHash:'password_hash', roleId:'role_id', active:'active', boardMember:'board_member' }],
  ['sessions', 'sessions', { id:'id', userId:'user_id', tokenHash:'token_hash', csrfToken:'csrf_token', csrfHash:'csrf_hash', expiresAt:'expires_at' }],
  ['loginAttempts', 'login_attempts', { id:'id', accountKey:'account_key', networkKey:'network_key', at:'attempted_at' }],
  ['assignments', 'board_assignments', { id:'id', donorId:'donor_id', assigneeId:'assignee_id', active:'active', assignedAt:'assigned_at', assignedBy:'assigned_by', endedAt:'ended_at' }],
  ['activities', 'activities', { id:'id', donorId:'donor_id', type:'type', content:'content', occurredAt:'occurred_at', createdBy:'created_by', createdAt:'created_at', updatedBy:'updated_by', updatedAt:'updated_at' }],
  ['activityHistory', 'activity_history', { historyId:'history_id', id:'activity_id', donorId:'donor_id', type:'type', content:'content', occurredAt:'occurred_at', createdBy:'created_by', createdAt:'created_at', updatedBy:'updated_by', updatedAt:'updated_at', replacedBy:'replaced_by', replacedAt:'replaced_at' }, 'historyId'],
  ['tasks', 'tasks', { id:'id', donorId:'donor_id', assigneeId:'assignee_id', nextAction:'next_action', description:'description', dueAt:'due_at', status:'status', createdBy:'created_by', createdAt:'created_at', updatedAt:'updated_at', completedAt:'completed_at', eventKey:'event_key' }],
  ['templates', 'message_templates', { id:'id', name:'name', channel:'channel', requiresDonation:'requires_donation', subject:'subject', body:'body' }],
  ['drafts', 'outreach_messages', { id:'id', audience:'audience', donorId:'donor_id', userId:'user_id', donationId:'donation_id', templateId:'template_id', channel:'channel', subject:'subject', body:'body', status:'status', revision:'revision', approvedRevision:'approved_revision', approvedBy:'approved_by', approvedAt:'approved_at', createdBy:'created_by', createdAt:'created_at', updatedAt:'updated_at', sentAt:'sent_at', providerId:'provider_id', outcomeUnknown:'outcome_unknown', eventKey:'event_key' }],
  ['sendHistory', 'outreach_delivery_history', { id:'id', draftId:'message_id', attemptId:'attempt_id', status:'status', revision:'revision', subject:'subject', body:'body', recipient:'recipient', approvedBy:'approved_by', actorId:'actor_id', providerId:'provider_id', code:'code', outcomeUnknown:'outcome_unknown', at:'occurred_at' }],
  ['events', 'retention_events', { id:'id', key:'event_key', type:'type', donorId:'donor_id', donationId:'donation_id', taskId:'task_id', draftId:'message_id', actorId:'actor_id', at:'occurred_at', details:'details' }],
  ['audit', 'audit_events', { id:'id', actorId:'actor_id', action:'action', entityId:'entity_id', at:'occurred_at', details:'details' }],
];
const appendOnly = new Set(['activityHistory', 'sendHistory', 'audit']);
const json = value => JSON.stringify(value);

export async function loadRetentionState(query) {
  const state = emptyState();
  for (const [key, table, mapping] of definitions) {
    const { rows } = await query(`SELECT * FROM ${table}`);
    state[key] = rows.map(row => Object.fromEntries(Object.entries(mapping).map(([prop, col]) => [prop, iso(row[col])])));
  }
  state.roles = (await query('SELECT * FROM roles ORDER BY id')).rows.map(r => ({ ...r, permissions: [] }));
  for (const row of (await query('SELECT * FROM role_permissions')).rows) {
    state.roles.find(r => r.id === row.role_id)?.permissions.push(row.permission_name);
  }
  state.donors = (await query('SELECT * FROM donors')).rows.map(donorToRetention);
  state.donations = (await query('SELECT * FROM donations')).rows.map(donationToRetention);
  for (const row of (await query('SELECT * FROM outreach_revisions ORDER BY revision')).rows) {
    const draft = state.drafts.find(d => d.id === row.message_id);
    if (draft) (draft.revisions ??= []).push({ revision: row.revision, subject: row.subject, body: row.body,
      changedBy: row.changed_by, changedAt: iso(row.changed_at) });
  }
  state.settings = { inactivityMonths: (await query('SELECT inactivity_months FROM retention_settings WHERE singleton')).rows[0]?.inactivity_months };
  return state;
}

async function writeRow(query, table, mapping, row, primary = 'id', insertOnly = false) {
  const props = Object.keys(mapping), columns = Object.values(mapping);
  const values = props.map(prop => {
    if (prop === 'details') return json(row.details ?? {});
    if (table === 'outreach_messages' && prop === 'outcomeUnknown') return row[prop] ?? false;
    return row[prop] ?? null;
  });
  const updates = columns.filter(col => col !== mapping[primary]).map(col => `${col}=EXCLUDED.${col}`).join(',');
  await query(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${values.map((_,i) => `$${i+1}`).join(',')})${insertOnly ? '' : ` ON CONFLICT (${mapping[primary]}) DO UPDATE SET ${updates}`}`, values);
}

export async function persistRetentionState(query, before, next) {
  for (const permission of PERMISSIONS) await query('INSERT INTO permissions(name) VALUES ($1) ON CONFLICT DO NOTHING', [permission]);
  for (const role of next.roles) {
    const previous = before.roles.find(r => r.id === role.id);
    if (json(previous) === json(role)) continue;
    await query('INSERT INTO roles(id,name) VALUES ($1,$2) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name', [role.id,role.name]);
    await query('DELETE FROM role_permissions WHERE role_id=$1', [role.id]);
    for (const p of role.permissions) await query('INSERT INTO role_permissions VALUES ($1,$2)', [role.id,p]);
  }
  for (const [key, table, mapping, primary = 'id'] of definitions) {
    for (const row of next[key]) {
      if (key === 'loginAttempts' && !row.id) row.id = newId();
      if (key === 'events') {
        row.details = { ...(row.details ?? {}), ...Object.fromEntries(Object.entries(row).filter(([p]) => !Object.hasOwn(mapping,p))) };
      }
      const previous = before[key].find(r => r[primary] === row[primary]);
      if (json(previous) === json(row)) continue;
      await writeRow(query, table, mapping, row, primary, appendOnly.has(key));
      if (key === 'drafts') {
        for (const version of row.revisions ?? []) {
          if (previous?.revisions?.some(r => r.revision === version.revision)) continue;
          await query('INSERT INTO outreach_revisions(message_id,revision,subject,body,changed_by,changed_at) VALUES ($1,$2,$3,$4,$5,$6)',
            [row.id,version.revision,version.subject,version.body,version.changedBy,version.changedAt]);
        }
        if (row.status === 'approved' && (previous?.approvedRevision !== row.approvedRevision || previous?.status !== 'approved')) {
          await query('INSERT INTO outreach_approval_history(message_id,revision,approved_by,approved_at) VALUES ($1,$2,$3,$4)',
            [row.id,row.revision,row.approvedBy,row.approvedAt]);
        }
      }
    }
    // Expiry and explicit revocation remove credentials; domain/history rows are never pruned here.
    if (['sessions','loginAttempts'].includes(key)) {
      const retained = new Set(next[key].map(r => r[primary]));
      for (const row of before[key]) if (!retained.has(row[primary])) await query(`DELETE FROM ${table} WHERE ${mapping[primary]}=$1`, [row[primary]]);
    }
  }
  for (const assignment of next.assignments.filter(a => a.active)) {
    const previous = before.assignments.find(a => a.id === assignment.id);
    if (json(previous) !== json(assignment)) await query('UPDATE donors SET assigned_board_member_id=$2, updated_at=now() WHERE id=$1', [assignment.donorId,assignment.assigneeId]);
  }
  if (json(before.settings) !== json(next.settings)) await query('UPDATE retention_settings SET inactivity_months=$1 WHERE singleton', [next.settings.inactivityMonths]);
}

function storageError(error) {
  if (error instanceof ApiError) return error;
  if (['23505','23503','40001','40P01'].includes(error.code)) return new ApiError(409,'DATA_CONFLICT','Data changed or conflicts with an existing record. Review and retry.');
  if (['22P02','23514'].includes(error.code)) return new ApiError(400,'INVALID_INPUT','A field value or identifier is invalid.');
  return new ApiError(503,'STORAGE_UNAVAILABLE','Persistent storage is unavailable. Check database configuration and migrations.');
}
export function createSqlStore(database) {
  return {
    kind: 'sql',
    async read(select) {
      try { return await database.transaction(async query => {
        await query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        return select(await loadRetentionState(query));
      }); } catch (error) { throw storageError(error); }
    },
    async transaction(change) {
      try { return await database.transaction(async query => {
        await query('SELECT pg_advisory_xact_lock(78234902)');
        const before = await loadRetentionState(query);
        const next = structuredClone(before);
        const result = await change(next);
        await persistRetentionState(query,before,next);
        return result;
      }); } catch (error) { throw storageError(error); }
    },
  };
}
