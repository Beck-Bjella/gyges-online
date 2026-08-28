/**
 * Apply pending migrations, and show what has run.
 *
 *   npm run db:migrate          apply anything outstanding
 *   npm run db:migrate -- --status   show state without changing anything
 */

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { register } from "node:module";

const DB_PATH =
  process.env.GYGES_DB_PATH ?? join(process.cwd(), ".data", "gyges.db");

mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const { migrate, appliedMigrations, pendingMigrations } = await import(
  "../lib/db/migrate.ts"
);

const statusOnly = process.argv.includes("--status");

console.log(`\ndatabase: ${DB_PATH}\n`);

if (statusOnly) {
  const done = appliedMigrations(db);
  const pending = pendingMigrations(db);

  console.log("applied:");
  if (done.length === 0) console.log("  (none)");
  for (const m of done) {
    console.log(`  ${m.name}  ${new Date(m.applied_at * 1000).toISOString()}`);
  }

  console.log("\npending:");
  if (pending.length === 0) console.log("  (none — up to date)");
  for (const name of pending) console.log(`  ${name}`);
  console.log();
} else {
  const result = migrate(db, true);
  if (result.applied.length === 0) {
    console.log(`up to date (${result.alreadyApplied} already applied)\n`);
  } else {
    console.log(`\napplied ${result.applied.length} migration(s)\n`);
  }
}

db.close();
