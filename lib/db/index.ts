/**
 * Database connection.
 *
 * SQLite for local development — no server to install, and the file lives in
 * .data/. The schema sticks to a subset that ports to PostgreSQL for
 * production; it is defined by the files in migrations/, which are the single
 * source of truth for what the database looks like.
 */

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { migrate } from "./migrate.ts";

const DB_PATH = process.env.GYGES_DB_PATH ?? join(process.cwd(), ".data", "gyges.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // Without this, a write that meets a held write-lock fails immediately with
  // SQLITE_BUSY rather than waiting. Two players moving at the same instant is
  // exactly that case.
  db.pragma("busy_timeout = 5000");

  // Bring the schema up to date. Safe on every start: migrations already
  // applied are skipped. See lib/db/migrate.ts.
  migrate(db);

  // Seed the engine's accounts. Bots are part of the application rather than
  // user data, so they are defined in lib/bots.ts and reconciled here — which
  // is what makes them survive `npm run db:reset` and appear on a fresh
  // deployment without anyone inserting rows by hand.
  //
  // Imported lazily, and after `db` is assigned, because lib/bots.ts calls
  // getDb(): a top-level import would be a cycle, and calling before the
  // assignment would recurse.
  syncBotsOnce();

  return db;
}

/**
 * Run the bot sync exactly once per process.
 *
 * getDb() is called on nearly every request; the sync is cheap but pointless to
 * repeat, and a failure here must never take the site down — a missing bot is
 * an inconvenience, an unreachable database is an outage.
 */
let botsSynced = false;
function syncBotsOnce(): void {
  if (botsSynced) return;
  botsSynced = true;
  try {
    // require rather than a static import, to break the cycle with lib/bots.ts.
    const { syncBots } = require("../bots.ts") as typeof import("../bots.ts");
    const result = syncBots();
    if (result.created.length) {
      console.log(`  seeded bots: ${result.created.join(", ")}`);
    }
    if (result.retired.length) {
      console.log(`  retired bots: ${result.retired.join(", ")}`);
    }
    for (const note of result.frozen) {
      console.warn(`  bot not synced — ${note}`);
    }
  } catch (err) {
    console.error("  bot sync failed:", err instanceof Error ? err.message : err);
  }
}

/**
 * Run a function inside a write transaction.
 *
 * Uses BEGIN IMMEDIATE rather than better-sqlite3's default BEGIN DEFERRED. A
 * deferred transaction starts read-only and upgrades when it first writes — and
 * if another connection holds the write lock at that moment, SQLite fails
 * straight away without honouring busy_timeout. Taking the write lock up front
 * means concurrent writers queue instead of erroring.
 */
export function transaction<T>(fn: () => T): T {
  return getDb().transaction(fn).immediate();
}


/** Unix seconds — the unit for game-level timestamps. */
export function now(): number {
  return Math.floor(Date.now() / 1000);
}

/** Unix milliseconds — the unit for move timestamps and think times. */
export function nowMs(): number {
  return Date.now();
}

/**
 * A short, URL-safe, time-ordered id.
 *
 * 24 hex characters: 12 of millisecond timestamp, then 12 of randomness. The
 * random half is what makes ids unguessable and collision-resistant; the
 * timestamp prefix is what makes them **sort by creation time**, which is the
 * point.
 *
 * ## Why the prefix matters
 *
 * A primary key is stored in a sorted index. Fully random ids therefore insert
 * into the *middle* of that index every time, splitting pages and rewriting
 * them — the write amplification described in migrations/0001_initial.sql. Time-ordered
 * ids always append at the end, which is the access pattern B-trees are good
 * at. This is the same idea as UUIDv7, kept in the short hex form the URLs
 * already use.
 *
 * SQLite hardly notices. Postgres, which this deploys to, does: the cost is
 * invisible at a hundred games and real at fifty thousand. Changing the id
 * format once games exist would mean rewriting every foreign key, so it is
 * worth being right about early.
 *
 * ## What it does not do
 *
 * The timestamp is not secret — anyone can read the creation time out of an
 * id. That is already public for games and accounts, so nothing leaks. It is
 * also not a substitute for created_at, which stays authoritative.
 */
export function newId(): string {
  // 48 bits of milliseconds: good until the year 10889.
  const ms = Date.now();
  const time = ms.toString(16).padStart(12, "0").slice(-12);

  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const random = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

  return time + random;
}

export function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
