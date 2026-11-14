import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Pool } from '@neondatabase/serverless';

const mode = process.argv[2];
if (!['migrate', 'seed'].includes(mode)) {
  throw new Error('Usage: node scripts/database.js <migrate|seed>');
}
const directory = new URL(`../db/${mode === 'migrate' ? 'migrations' : 'seeds'}/`, import.meta.url);
const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
if (files.length === 0) {
  console.log(`No ${mode} SQL files found in ${fileURLToPath(directory)}.`);
} else {
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL in .env before running database commands.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    // Serialize setup commands so teammates cannot apply the same migration twice.
    await client.query('SELECT pg_advisory_xact_lock(78234901)');
    if (mode === 'migrate') {
      await client.query('CREATE TABLE IF NOT EXISTS colorloop_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    }
    for (const name of files) {
      if (mode === 'migrate') {
        const applied = await client.query('SELECT name FROM colorloop_migrations WHERE name = $1', [name]);
        if (applied.rowCount) continue;
      }
      await client.query(await readFile(new URL(name, directory), 'utf8'));
      if (mode === 'migrate') {
        await client.query('INSERT INTO colorloop_migrations (name) VALUES ($1)', [name]);
      }
      console.log(`Applied ${name}`);
    }
    await client.query('COMMIT');
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}
