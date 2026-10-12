#!/usr/bin/env node
// Applies supabase/migrations/*.sql in order, recording each in public.schema_migrations.
// Usage: DATABASE_URL=postgres://... node scripts/db-migrate.mjs [--local-shim auto|yes|no]
// --local-shim auto (default): applies supabase/local/*.sql first when auth.uid() does not exist
//   (i.e. plain Postgres, not a Supabase project). Never applies the shim when auth.uid() exists.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const args = process.argv.slice(2);
const shimArg = args.includes('--local-shim') ? args[args.indexOf('--local-shim') + 1] : 'auto';
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(2);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const { rows } = await client.query("select exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'auth' and p.proname = 'uid') as has_auth");
  const hasAuth = rows[0].has_auth;
  const applyShim = shimArg === 'yes' || (shimArg === 'auto' && !hasAuth);
  if (applyShim) {
    for (const f of readdirSync(join(root, 'supabase', 'local')).filter((f) => f.endsWith('.sql')).sort()) {
      process.stdout.write(`local shim ${f} ... `);
      await client.query(readFileSync(join(root, 'supabase', 'local', f), 'utf8'));
      console.log('ok');
    }
  } else if (!hasAuth) {
    console.error('auth.uid() missing and --local-shim no: migrations would fail');
    process.exit(2);
  }

  await client.query('create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const applied = new Set((await client.query('select name from public.schema_migrations')).rows.map((r) => r.name));
  const files = readdirSync(join(root, 'supabase', 'migrations')).filter((f) => f.endsWith('.sql')).sort();
  let count = 0;
  for (const f of files) {
    if (applied.has(f)) continue;
    process.stdout.write(`migrate ${f} ... `);
    await client.query('begin');
    try {
      await client.query(readFileSync(join(root, 'supabase', 'migrations', f), 'utf8'));
      await client.query('insert into public.schema_migrations (name) values ($1)', [f]);
      await client.query('commit');
      console.log('ok');
      count++;
    } catch (e) {
      await client.query('rollback');
      console.log('FAILED');
      throw e;
    }
  }
  console.log(`${count} migration(s) applied, ${files.length - count} already present`);
} finally {
  await client.end();
}
