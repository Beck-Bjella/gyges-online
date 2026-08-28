/**
 * Tests for the migration runner.
 *
 * The properties that matter: migrations run once, in order, and re-running is
 * a no-op. Those are what make it safe to call on every start, and what makes
 * a schema change to a live database predictable rather than frightening.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

const {
  migrate,
  migrationFiles,
  appliedMigrations,
  pendingMigrations,
} = await import("../lib/db/migrate.ts");

const dir = mkdtempSync(join(tmpdir(), "gyges-migrate-"));
const open = (name: string) => new Database(join(dir, name));

after(() => rmSync(dir, { recursive: true, force: true }));

test("there is at least one migration, and they sort in order", () => {
  const files = migrationFiles();
  assert.ok(files.length >= 1);
  assert.deepEqual(files, [...files].sort(), "files must sort into run order");
  assert.ok(files[0].startsWith("0001"), "the first migration is 0001");
});

test("migrating an empty database creates the schema", () => {
  const db = open("fresh.db");
  const result = migrate(db);

  assert.equal(result.applied.length, migrationFiles().length);
  assert.equal(result.alreadyApplied, 0);

  const tables = (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[]
  ).map((r) => r.name);

  for (const expected of ["users", "games", "moves", "sessions"]) {
    assert.ok(tables.includes(expected), `${expected} table should exist`);
  }
  db.close();
});

test("migrating twice applies nothing the second time", () => {
  const db = open("twice.db");
  const first = migrate(db);
  const second = migrate(db);

  assert.ok(first.applied.length > 0, "the first run does the work");
  assert.equal(second.applied.length, 0, "the second run is a no-op");
  assert.equal(second.alreadyApplied, first.applied.length);
  db.close();
});

test("applied migrations are recorded with a timestamp", () => {
  const db = open("recorded.db");
  migrate(db);

  const applied = appliedMigrations(db);
  assert.equal(applied.length, migrationFiles().length);
  for (const m of applied) {
    assert.ok(m.applied_at > 0, `${m.name} should record when it ran`);
  }
  db.close();
});

test("a fresh database reports everything as pending", () => {
  const db = open("pending.db");
  assert.deepEqual(pendingMigrations(db), migrationFiles());

  migrate(db);
  assert.deepEqual(pendingMigrations(db), [], "nothing pending once applied");
  db.close();
});

test("appliedMigrations is safe on a database that has never migrated", () => {
  const db = open("virgin.db");
  assert.deepEqual(appliedMigrations(db), []);
  db.close();
});

test("the migrated schema accepts a real row and enforces its checks", () => {
  const db = open("checks.db");
  migrate(db);

  db.prepare(
    "INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, ?)",
  ).run("u1", "beck", "beck", 0);

  // A duplicate name, differing only by case, must be refused.
  assert.throws(() =>
    db
      .prepare(
        "INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, ?)",
      )
      .run("u2", "Beck", "beck", 0),
  );

  // A board must be 38 digits.
  assert.throws(() =>
    db
      .prepare(
        `INSERT INTO games (id, player1_id, start_board, board, move_seconds)
         VALUES ('g1', 'u1', 'nope', 'nope', 100)`,
      )
      .run(),
  );

  db.close();
});
