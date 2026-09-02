/**
 * Back up the local database to a timestamped file.
 *
 * SQLite has an online backup API, which better-sqlite3 exposes — this is safe
 * to run while the server is using the database, unlike copying the file by
 * hand (which can catch it mid-write).
 *
 * This IS the production mechanism, not just a local habit: the site runs on
 * one machine with the database on its disk, so a backup is a consistent copy
 * of that file. deploy/backup.sh runs this from cron and sends the result to
 * S3 — a copy on the same disk is not a backup.
 *
 * GYGES_DB_PATH chooses the database, GYGES_BACKUP_DIR where copies land.
 */

import Database from "better-sqlite3";
import { mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";

const DB_PATH =
  process.env.GYGES_DB_PATH ?? join(process.cwd(), ".data", "gyges.db");
const BACKUP_DIR =
  process.env.GYGES_BACKUP_DIR ?? join(process.cwd(), ".data", "backups");

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
