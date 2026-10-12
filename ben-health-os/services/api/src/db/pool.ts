import pg from 'pg';

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

export function createPool(connectionString: string): pg.Pool {
  const pool = new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
  pool.on('error', (err) => {
    // Pool-level errors are logged without payload details; health data never reaches logs.
    console.error('pg pool error', err.message);
  });
  return pool;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `fn` in a transaction executed AS the authenticated user: the connection switches to the
 * `authenticated` role and sets request.jwt.claims so every Row Level Security policy applies,
 * exactly like PostgREST/Supabase do. Nothing in `fn` can read or write another user's rows.
 */
export async function withUser<T>(pool: pg.Pool, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID_RE.test(userId)) throw new Error('withUser: userId must be a uuid');
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role authenticated');
    // The claims JSON is built server-side from the verified token; never from request input.
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated' })]);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (e) {
    try {
      await client.query('rollback');
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
}

/** Runs `fn` with the service connection (bypasses RLS). Only for trusted server-side jobs. */
export async function withService<T>(pool: pg.Pool, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (e) {
    try {
      await client.query('rollback');
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
}
