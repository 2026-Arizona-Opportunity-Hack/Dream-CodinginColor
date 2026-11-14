import { randomUUID } from 'node:crypto';

// Mock contract only: Teammate 1 will supply a durable transaction adapter.
export function emptyState() {
  return {
    users: [], roles: [], sessions: [], loginAttempts: [], audit: [],
    donors: [], donations: [], assignments: [], activities: [], activityHistory: [],
    tasks: [], drafts: [], sendHistory: [], templates: [], events: [],
    settings: { inactivityMonths: 12 },
  };
}

export function createMemoryStore(seed = {}) {
  let state = structuredClone({ ...emptyState(), ...seed });
  let tail = Promise.resolve();
  return {
    kind: 'memory',
    async read(select) {
      await tail;
      return select(structuredClone(state));
    },
    async transaction(change) {
      const result = tail.then(async () => {
        const next = structuredClone(state);
        const value = await change(next);
        state = next;
        return structuredClone(value);
      });
      tail = result.then(() => {}, () => {});
      return result;
    },
  };
}

let mockStore;
export function getStore() {
  if (process.env.COLORLOOP_STORE !== 'mock' || process.env.NODE_ENV === 'production'
      || process.env.VERCEL) {
    throw Object.assign(new Error('Durable retention storage is not configured.'), {
      status: 503, code: 'STORAGE_UNAVAILABLE',
    });
  }
  return mockStore ??= createMemoryStore();
}

export const newId = () => randomUUID();
export function audit(state, actorId, action, entityId, now, details) {
  state.audit.push({ id: newId(), actorId, action, entityId, at: now.toISOString(),
    ...(details ? { details } : {}) });
}
