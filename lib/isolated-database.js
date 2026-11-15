// Synthetic demo/test database. Never opens a network connection or a data directory.
export async function createIsolatedDatabase() {
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL) throw new Error('Isolated demo storage is local only.');
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite();
  let tail = Promise.resolve();
  const query = async (sql, params = []) => {
    const result = params.length || !sql.includes(';') ? await pg.query(sql,params) : (await pg.exec(sql)).at(-1);
    return { ...result, rowCount: result?.affectedRows ?? result?.rows?.length ?? 0 };
  };
  return { query, close: () => pg.close(), transaction(work) {
    const result = tail.then(async () => {
      await query('BEGIN');
      try { const value = await work(query); await query('COMMIT'); return value; }
      catch(error) { await query('ROLLBACK'); throw error; }
    });
    tail = result.catch(() => {});
    return result;
  } };
}
