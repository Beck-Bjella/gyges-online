/**
 * Database connection.
 *
 * SQLite for local development — no server to install, and the file lives in
 * .data/. The schema sticks to a subset that ports to PostgreSQL for
 * production; see lib/db/schema.sql.
 */

import Database from "better-sqlite3";
import { readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const DB_PATH = process.env.GYGES_DB_PATH ?? join(process.cwd(), ".data", "gyges.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const schema = readFileSync(join(process.cwd(), "lib", "db", "schema.sql"), "utf8");
  db.exec(schema);

  return db;
}

/** Run a function inside a transaction. */
export function transaction<T>(fn: () => T): T {
  return getDb().transaction(fn)();
}

export function now(): number {
  return Math.floor(Date.now() / 1000);
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
