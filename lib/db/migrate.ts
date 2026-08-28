/**
 * Migrations.
 *
 * Every change to the schema is a numbered file in migrations/. They run in
 * filename order, exactly once each, and each one is recorded in
 * schema_migrations so it is never applied twice.
 *
 * Why this exists: while the database is disposable, changing the schema means
 * deleting the file and starting over. Once real games are stored that is no
 * longer an option — deleting is throwing away people's games. From then on
 * the schema has to be *evolved* in place, and doing that reliably means
 * knowing exactly which changes have already been applied.
 *
 * Rules:
 *  - Never edit a migration that has been applied anywhere real. Write a new
 *    one. Editing an applied migration means two databases silently disagree.
 *  - Each migration runs in a transaction, so a failure leaves nothing
 *    half-applied.
 *  - Keep them small and forward-only.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "better-sqlite3";

const MIGRATIONS_DIR = join(process.cwd(), "migrations");

export interface MigrationResult {
  applied: string[];
  alreadyApplied: number;
}

/** Migration files, in the order they must run. */
export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/**
 * Apply any migrations this database has not seen.
 *
 * Safe to call on every start: already-applied migrations are skipped.
 */
export function migrate(db: Database, log = false): MigrationResult {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const done = new Set(
    (db.prepare("SELECT name FROM schema_migrations").all() as { name: string }[]).map(
      (r) => r.name,
    ),
  );

  const applied: string[] = [];

  for (const file of migrationFiles()) {
    if (done.has(file)) continue;

    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");

    // One transaction per migration: a failure leaves nothing half-applied.
    db.transaction(() => {
      db.exec(sql);
      db.prepare(
        "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)",
      ).run(file, Math.floor(Date.now() / 1000));
    })();

    applied.push(file);
    if (log) console.log(`  applied ${file}`);
  }

  return { applied, alreadyApplied: done.size };
}

/** Which migrations a database has already run. */
export function appliedMigrations(db: Database): { name: string; applied_at: number }[] {
  const exists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
    .get();
  if (!exists) return [];
  return db
    .prepare("SELECT name, applied_at FROM schema_migrations ORDER BY name")
    .all() as { name: string; applied_at: number }[];
}

/** Migrations on disk that this database has not applied. */
export function pendingMigrations(db: Database): string[] {
  const done = new Set(appliedMigrations(db).map((m) => m.name));
  return migrationFiles().filter((f) => !done.has(f));
}
