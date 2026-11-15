import test from 'node:test';
import assert from 'node:assert/strict';
import { query, close } from '../lib/db.js';

test('live Neon read-only connectivity (explicit opt-in)', { skip: process.env.RUN_NEON_TESTS !== 'true' || !process.env.DATABASE_URL }, async () => {
  try {
    const result = await query('SELECT 1::int AS connected');
    assert.equal(result.rows[0].connected, 1);
  } catch { assert.fail('Neon connection failed; check DATABASE_URL and network access privately.'); }
  finally { await close(); }
});
