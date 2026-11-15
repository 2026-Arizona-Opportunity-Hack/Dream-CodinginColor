import { transaction, close } from '../lib/db.js';
import { migrate, seed } from '../lib/database-setup.js';

const mode = process.argv[2];
if (!['migrate', 'seed', 'check'].includes(mode)) throw new Error('Usage: node scripts/database.js <migrate|seed|check>');
try {
  if (mode === 'seed' && (process.env.ALLOW_SYNTHETIC_SEED !== 'true' || process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production')) {
    throw new Error('Seed is development-only. Set ALLOW_SYNTHETIC_SEED=true for an intended development database.');
  }
  await transaction(mode === 'check' ? (query) => query('SELECT 1 AS connected') : mode === 'seed' ? seed : migrate);
  console.log(mode === 'check' ? 'Database connection verified by SELECT 1.' : `${mode} completed atomically.`);
} catch {
  // Do not print driver errors: they may contain credentials or donor data.
  console.error(!process.env.DATABASE_URL ? 'Set DATABASE_URL in .env before running database commands.' : mode === 'seed' && process.env.ALLOW_SYNTHETIC_SEED !== 'true' ? 'Set ALLOW_SYNTHETIC_SEED=true only for an intended development database.' : 'Database command failed; inspect configuration and migration state privately.');
  process.exitCode = 1;
} finally { await close(); }
