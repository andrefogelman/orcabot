/**
 * migrate.ts — Run all SQL migrations against Supabase Postgres.
 *
 * Usage: bun run migrate   (or: npx tsx src/migrate.ts)
 *
 * Reads .sql files from supabase/migrations/ in alphabetical order
 * and executes them via the Supabase Management API (supabase-js rpc).
 * All migrations use IF NOT EXISTS / DO $$ guards so they're idempotent.
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { readEnvFile } from './env.js';

const env = readEnvFile(['SUPABASE_URL', 'SUPABASE_SERVICE_KEY']);

const supabaseUrl = env.SUPABASE_URL;
const supabaseServiceKey = env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error(
    'ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env'
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations');

async function runMigrations(): Promise<void> {
  if (!fs.existsSync(migrationsDir)) {
    console.error(`ERROR: migrations directory not found: ${migrationsDir}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('No migration files found.');
    return;
  }

  console.log(`Found ${files.length} migration file(s):\n`);

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf-8').trim();

    if (!sql) {
      console.log(`  SKIP  ${file} (empty)`);
      continue;
    }

    console.log(`  RUN   ${file} ...`);

    const { error } = await supabase.rpc('exec_sql', { query: sql });

    if (error) {
      // Fallback: try executing via the postgres REST endpoint directly
      // The exec_sql rpc may not exist, so we use the raw SQL endpoint
      const res = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ query: sql }),
      });

      if (!res.ok) {
        // Last resort: use the pg endpoint via supabase management API
        // For now, log the error and suggest manual execution
        console.error(`  FAIL  ${file}`);
        console.error(`        ${error.message}`);
        console.error(
          '\n  NOTE: If exec_sql RPC does not exist, create it first:'
        );
        console.error(
          '        CREATE OR REPLACE FUNCTION exec_sql(query text)'
        );
        console.error('        RETURNS void LANGUAGE plpgsql SECURITY DEFINER');
        console.error("        AS $$ BEGIN EXECUTE query; END; $$;");
        console.error(
          '\n  Or run migrations manually via Supabase SQL Editor.'
        );
        process.exit(1);
      }
    }

    console.log(`  OK    ${file}`);
  }

  console.log('\nAll migrations completed successfully.');
}

runMigrations().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
