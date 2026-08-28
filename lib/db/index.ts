/**
 * Database connection.
 *
 * SQLite for local development — no server to install, and the file lives in
 * .data/. The schema sticks to a subset that ports to PostgreSQL for
 * production; see lib/db/schema.sql.
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

  return db;
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

/** Run a function inside a read-only transaction. */
export function readTransaction<T>(fn: () => T): T {
  return getDb().transaction(fn).deferred();
}

/** Unix seconds — the unit for game-level timestamps. */
export function now(): number {
  return Math.floor(Date.now() / 1000);
}

/** Unix milliseconds — the unit for move timestamps and think times. */
export function nowMs(): number {
  return Date.now();
}

/** Short, URL-safe, collision-resistant enough for games and users. */
export function newId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
