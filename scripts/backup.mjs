/**
 * Back up the local database to a timestamped file.
 *
 * SQLite has an online backup API, which better-sqlite3 exposes — this is safe
 * to run while the server is using the database, unlike copying the file by
 * hand (which can catch it mid-write).
 *
 * In production this is not the mechanism. Neon keeps continuous point-in-time
 * backups of its own, and a portable copy comes from `pg_dump`. This script is
 * for local development, and for the habit.
 */

import Database from "better-sqlite3";
import { mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";

const DB_PATH =
  process.env.GYGES_DB_PATH ?? join(process.cwd(), ".data", "gyges.db");
const BACKUP_DIR = join(process.cwd(), ".data", "backups");

if (!existsSync(DB_PATH)) {
  console.error(`No database at ${DB_PATH}. Nothing to back up.`);
  process.exit(1);
}

mkdirSync(BACKUP_DIR, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const target = join(BACKUP_DIR, `gyges-${stamp}.db`);

const db = new Database(DB_PATH, { readonly: true });
await db.backup(target);

const counts = ["users", "games", "moves"].map((t) => {
  const n = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
  return `${n} ${t}`;
});
db.close();

const size = (statSync(target).size / 1024).toFixed(0);
console.log(`\nbacked up to ${target}`);
console.log(`  ${size} KB · ${counts.join(", ")}`);

const kept = readdirSync(BACKUP_DIR).filter((f) => f.endsWith(".db"));
console.log(`  ${kept.length} backup(s) on disk\n`);
