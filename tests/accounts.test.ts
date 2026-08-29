/**
 * Tests for accounts: passwords and session hygiene.
 *
 * These exercise the query layer directly. The lib/auth.ts wrapper is not
 * tested here because it reaches for next/headers cookies, which needs a
 * request context; what it adds over this layer is the cookie, and the flows
 * below are the part with rules in them.
 *
 * Run with: npm test
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "gyges-accounts-"));
process.env.GYGES_DB_PATH = join(dir, "test.db");

const {
  createUser,
  findUserByName,
  getUser,
  passwordHashFor,
  setPasswordHash,
  createSession,
  userForSession,
  deleteSessionsForUser,
  purgeExpiredSessions,
  GameError,
} = await import("../lib/db/queries.ts");

const { hashPassword, verifyPassword } = await import("../lib/password.ts");
const { getDb } = await import("../lib/db/index.ts");

after(() => {
  try {
    getDb().close();
  } catch {
    /* already closed */
  }
  rmSync(dir, { recursive: true, force: true });
});

let n = 0;
const name = (p: string) => `${p}${++n}`;

test("a new account stores a hash, not the password", async () => {
  const hash = await hashPassword("a good long password");
  const user = createUser(name("hasher"), hash);

  const stored = passwordHashFor(user.id);
  assert.ok(stored, "a hash is stored");
  assert.ok(!stored!.includes("a good long password"));
  assert.ok(await verifyPassword("a good long password", stored));
});

test("the User object never carries the hash", async () => {
  const hash = await hashPassword("a good long password");
  const created = createUser(name("nohash"), hash);

  for (const user of [created, findUserByName(created.username), getUser(created.id)]) {
    assert.ok(user, "user exists");
    assert.ok(
      !("password_hash" in (user as object)),
      "password_hash must never be a field on User",
    );
    assert.equal(user!.has_password, true);
    // The whole serialised object must not contain the hash, since this is
    // what gets handed to pages and client components.
    assert.ok(!JSON.stringify(user).includes(hash.split("$")[5]));
  }
});

test("an account with no password reports has_password false", () => {
  const user = createUser(name("nopw"));
  assert.equal(user.has_password, false);
  assert.equal(passwordHashFor(user.id), null);
  assert.equal(findUserByName(user.username)!.has_password, false);
});

test("a duplicate username is refused, case-insensitively", async () => {
  const hash = await hashPassword("a good long password");
  const user = createUser(name("Dup"), hash);

  assert.throws(() => createUser(user.username, hash), GameError);
  assert.throws(() => createUser(user.username.toUpperCase(), hash), GameError);
  assert.throws(() => createUser(user.username.toLowerCase(), hash), GameError);
});

test("an account with no password cannot be signed in to", async () => {
  // Bots are stored this way. verifyPassword must refuse a null hash outright:
  // there is no path that turns a passwordless account into a usable one.
  const user = createUser(name("nopassword"));
  assert.equal(passwordHashFor(user.id), null);

  assert.equal(await verifyPassword("anything at all", passwordHashFor(user.id)), false);
  assert.equal(await verifyPassword("", passwordHashFor(user.id)), false);
});

test("setPasswordHash replaces an existing password", async () => {
  const user = createUser(name("changer"), await hashPassword("the old password"));
  setPasswordHash(user.id, await hashPassword("the new password"));

  const stored = passwordHashFor(user.id);
  assert.ok(await verifyPassword("the new password", stored));
  assert.ok(!(await verifyPassword("the old password", stored)));
});

test("setPasswordHash on a missing account is an error", async () => {
  const hash = await hashPassword("a good long password");
  assert.throws(() => setPasswordHash("no-such-user-id", hash), GameError);
});

test("changing a password can end other sessions but keep the current one", async () => {
  const user = createUser(name("sessions"), await hashPassword("a good long password"));

  const phone = createSession(user.id);
  const laptop = createSession(user.id);
  const other = createSession(user.id);

  assert.ok(userForSession(phone));
  assert.ok(userForSession(laptop));

  const ended = deleteSessionsForUser(user.id, laptop);
  assert.equal(ended, 2, "the other two sessions end");

  assert.equal(userForSession(phone), null, "phone is signed out");
  assert.equal(userForSession(other), null, "other is signed out");
  assert.ok(userForSession(laptop), "the current session survives");
});

test("expired sessions are purged; live ones are not", () => {
  const user = createUser(name("purge"));
  const live = createSession(user.id);
  const stale = createSession(user.id);

  // Backdate one session past its expiry.
  getDb()
    .prepare("UPDATE sessions SET expires_at = ? WHERE token = ?")
    .run(Math.floor(Date.now() / 1000) - 60, stale);

  // It is already unusable before any purge — expiry is checked on read.
  assert.equal(userForSession(stale), null);

  const removed = purgeExpiredSessions();
  assert.ok(removed >= 1, "at least the stale session is deleted");

  const rows = getDb()
    .prepare("SELECT COUNT(*) AS n FROM sessions WHERE token = ?")
    .get(stale) as { n: number };
  assert.equal(rows.n, 0, "the stale row is gone from the table");

  assert.ok(userForSession(live), "the live session still works");
});
