/**
 * Tests for password hashing.
 *
 * The properties that matter: a hash never reveals its password, the same
 * password hashes differently every time, verification accepts only the right
 * password, and nothing malformed can crash the check.
 *
 * Run with: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const {
  hashPassword,
  verifyPassword,
  validatePassword,
  needsRehash,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
} = await import("../lib/password.ts");

test("a hash does not contain the password", async () => {
  const hash = await hashPassword("hunter2-and-a-bit");
  assert.ok(!hash.includes("hunter2"), "the password must not appear in the hash");
});

test("the hash records its own parameters", async () => {
  const hash = await hashPassword("correct horse battery");
  const parts = hash.split("$");
  assert.equal(parts.length, 6);
  assert.equal(parts[0], "scrypt");
  assert.ok(Number(parts[1]) >= 16384, "cost factor is recorded and non-trivial");
});

test("the same password hashes differently each time", async () => {
  const a = await hashPassword("the same password");
  const b = await hashPassword("the same password");
  assert.notEqual(a, b, "a random salt must make each hash unique");
  // ...but both still verify.
  assert.ok(await verifyPassword("the same password", a));
  assert.ok(await verifyPassword("the same password", b));
});

test("the right password verifies", async () => {
  const hash = await hashPassword("a good long password");
  assert.ok(await verifyPassword("a good long password", hash));
});

test("a wrong password does not verify", async () => {
  const hash = await hashPassword("a good long password");
  assert.ok(!(await verifyPassword("a good long passwore", hash)));
  assert.ok(!(await verifyPassword("", hash)));
  assert.ok(!(await verifyPassword("A GOOD LONG PASSWORD", hash)));
});

test("verification is case sensitive", async () => {
  const hash = await hashPassword("MixedCasePassword");
  assert.ok(await verifyPassword("MixedCasePassword", hash));
  assert.ok(!(await verifyPassword("mixedcasepassword", hash)));
});

test("a null or malformed hash never verifies, and never throws", async () => {
  for (const bad of [
    null,
    "",
    "not-a-hash",
    "scrypt$1$2$3",
    "scrypt$abc$8$1$aa$bb",
    "bcrypt$16384$8$1$aa$bb",
    "scrypt$16384$8$1$zz$bb",
    "scrypt$-1$8$1$aa$bb",
    // Absurd cost, which must be rejected rather than allocating for it.
    "scrypt$999999999$8$1$aa$bb",
  ]) {
    assert.ok(
      !(await verifyPassword("anything", bad as string | null)),
      `must reject ${JSON.stringify(bad)}`,
    );
  }
});

test("unicode passwords work", async () => {
  const pw = "pässwörd-with-ünicode-日本語";
  const hash = await hashPassword(pw);
  assert.ok(await verifyPassword(pw, hash));
  assert.ok(!(await verifyPassword("password-with-unicode", hash)));
});

test("validatePassword enforces length and nothing else", () => {
  assert.ok(validatePassword("") !== null, "empty is refused");
  assert.ok(validatePassword("short") !== null, "too short is refused");
  assert.equal(validatePassword("a".repeat(MIN_PASSWORD_LENGTH)), null);
  assert.equal(validatePassword("all lowercase letters and spaces"), null);
  assert.ok(
    validatePassword("a".repeat(MAX_PASSWORD_LENGTH + 1)) !== null,
    "absurdly long is refused",
  );
});

test("an oversized password is refused rather than hashed", async () => {
  const hash = await hashPassword("a good long password");
  const huge = "x".repeat(MAX_PASSWORD_LENGTH + 1000);
  assert.ok(!(await verifyPassword(huge, hash)));
});

test("needsRehash reports weaker-than-current parameters", async () => {
  const current = await hashPassword("a good long password");
  assert.equal(needsRehash(current), false, "a fresh hash is current");
  assert.equal(needsRehash("scrypt$16384$8$1$aa$bb"), true, "a weaker N needs rehash");
  assert.equal(needsRehash("garbage"), true, "unparseable counts as needing rehash");
  assert.equal(needsRehash(null), false, "no password is not a weak password");
});
