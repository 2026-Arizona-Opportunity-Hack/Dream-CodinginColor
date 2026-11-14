import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export async function migrate(query) {
  const directory = new URL('../db/migrations/', import.meta.url);
  await query('SELECT pg_advisory_xact_lock(78234901)');
  await query('CREATE TABLE IF NOT EXISTS colorloop_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  await query('ALTER TABLE colorloop_migrations ADD COLUMN IF NOT EXISTS checksum text');
  const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  for (const name of files) {
    const sql = await readFile(new URL(name, directory), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const { rows } = await query('SELECT checksum FROM colorloop_migrations WHERE name = $1', [name]);
    if (rows.length) {
      if (rows[0].checksum && rows[0].checksum !== checksum) throw new Error(`Applied migration changed: ${name}`);
      continue;
    }
    await query(sql);
    await query('INSERT INTO colorloop_migrations (name, checksum) VALUES ($1, $2)', [name, checksum]);
  }
}
export async function seed(query) {
  await query('SELECT pg_advisory_xact_lock(78234901)');
  await query(await readFile(new URL('../db/seed.sql', import.meta.url), 'utf8'));
}
