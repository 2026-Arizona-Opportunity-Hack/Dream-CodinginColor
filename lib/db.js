import 'dotenv/config';
import { Pool, neonConfig } from '@neondatabase/serverless';
import {judgeDeploymentConfig,guardJudgeDatabase} from './judge-deployment.js';

export function createDatabase(pool) {
  return {
    query: (sql, params = []) => pool.query(sql, params),
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await work((sql, params = []) => client.query(sql, params));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* Preserve original failure. */ }
        throw error;
      } finally { client.release(); }
    },
    close: () => pool.end(),
  };
}
let database;
function getDatabase() {
  if (!database) {
    const judge=judgeDeploymentConfig();
    const connection=judge?.databaseUrl||process.env.DATABASE_URL;
    if (!connection) throw new Error('Set DATABASE_URL in .env to a Neon PostgreSQL connection string.');
    const url = new URL(connection);
    if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') throw new Error('DATABASE_URL must use PostgreSQL.');
    if (url.searchParams.get('sslmode') === 'disable') throw new Error('Neon connections require TLS.');
    url.searchParams.set('sslmode', 'verify-full');
    // Node 22+ has a built-in WebSocket; the transport also uses WSS by default.
    neonConfig.webSocketConstructor = globalThis.WebSocket;
    neonConfig.useSecureWebSocket = true;
    database = createDatabase(new Pool({ connectionString: url.href, max: 3, connectionTimeoutMillis: 10000 }));
    if(judge)database=guardJudgeDatabase(database,judge);
  }
  return database;
}
export const query = (sql, params) => getDatabase().query(sql, params);
export const transaction = (work) => getDatabase().transaction(work);
export const close = () => database?.close();
// Compatibility for the reporting layer; values remain positional parameters.
export async function sql(strings, ...values) {
  const statement = strings.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, '');
  return (await query(statement, values)).rows;
}
