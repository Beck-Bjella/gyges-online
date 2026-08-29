/**
 * Password hashing.
 *
 * Passwords are never stored. What goes in the database is a slow one-way hash,
 * so a stolen database still cannot reveal anyone's password.
 *
 * ## Why scrypt
 *
 * The roadmap said "argon2id or bcrypt". This uses **scrypt**, which is in the
 * same family — a deliberately slow, *memory-hard* KDF — and is built into Node
 * (`node:crypto`). That last part is the deciding argument: argon2 and bcrypt
 * are native addons that must compile against the host's Node ABI. On a
 * serverless host that is a real deployment hazard, and it is an entire class of
 * problem that simply does not exist for a built-in.
 *
 * Memory-hardness is the property that matters. A plain fast hash (SHA-256) can
 * be attacked by GPUs at billions of guesses a second. scrypt forces each guess
 * to allocate real memory — 64 MB at these parameters — which is exactly what
 * GPUs and ASICs are bad at.
 *
 * ## Parameters
 *
 * N=65536, r=8, p=1 costs ~120ms and 64 MB per hash. That is above OWASP's
 * floor for scrypt, fast enough that signing in feels instant, and small enough
 * to stay inside a serverless function's memory limit.
 *
 * N is stored *in the hash string*, so these can be raised later without
 * invalidating existing passwords: an old hash still verifies against its own
 * recorded parameters. `needsRehash` reports when a stored hash is below current
 * policy, so it can be upgraded silently the next time someone signs in.
 *
 * ## Format
 *
 *     scrypt$N$r$p$<salt-hex>$<hash-hex>
 *
 * Self-describing, like the modular crypt format bcrypt uses. Everything needed
 * to verify a hash travels with it, so changing policy never orphans a row.
 */

import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

/**
 * Promisified scrypt.
 *
 * Written out rather than `promisify(scrypt)` because scrypt is overloaded
 * (with and without an options object) and promisify resolves to the overload
 * without options, which loses the cost parameters.
 */
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

/** Current cost. Raise over time; old hashes keep verifying against their own. */
const N = 65536;
const R = 8;
const P = 1;

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/**
 * scrypt needs roughly 128 * N * r bytes. Node's default maxmem is 32 MB, which
 * N=65536 exceeds, so it must be raised explicitly or the call throws.
 */
const MAX_MEM = 256 * 1024 * 1024;

/**
 * The shortest password we accept.
 *
 * Length beats character-class rules: "correct horse battery staple" is far
 * stronger than "P@ss1!", and forcing symbols mostly produces predictable
 * substitutions plus a password on a sticky note. NIST SP 800-63B has
 * recommended against composition rules since 2017, and against mandatory
 * rotation with it.
 */
export const MIN_PASSWORD_LENGTH = 8;

/** Guards against a megabyte of "password" being sent as a denial-of-service. */
export const MAX_PASSWORD_LENGTH = 200;

/**
 * Check a password is acceptable. Returns null if fine, else why not.
 *
 * Deliberately permissive about *content*. The one substantive rule is length.
 */
export function validatePassword(password: string): string | null {
  if (typeof password !== "string" || password.length === 0) {
    return "Enter a password.";
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

/** Hash a password for storage. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password, salt, KEY_LENGTH, {
    N,
    r: R,
    p: P,
    maxmem: MAX_MEM,
  });

  return [
    "scrypt",
    N,
    R,
    P,
    salt.toString("hex"),
    derived.toString("hex"),
  ].join("$");
}

interface ParsedHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

/** Parse a stored hash. Returns null for anything malformed. */
function parseHash(stored: string): ParsedHash | null {
  if (typeof stored !== "string") return null;
  const parts = stored.split("$");
  if (parts.length !== 6) return null;

  const [scheme, nRaw, rRaw, pRaw, saltHex, hashHex] = parts;
  if (scheme !== "scrypt") return null;

  const parsedN = Number(nRaw);
  const parsedR = Number(rRaw);
  const parsedP = Number(pRaw);
  if (
    !Number.isInteger(parsedN) ||
    !Number.isInteger(parsedR) ||
    !Number.isInteger(parsedP) ||
    parsedN < 2 ||
    parsedR < 1 ||
    parsedP < 1
  ) {
    return null;
  }

  // Reject absurd parameters from a corrupted row: without this, a hostile or
  // damaged value could make scrypt allocate unbounded memory.
  if (parsedN > 1 << 22 || parsedR > 32 || parsedP > 16) return null;
  if (!/^[0-9a-f]+$/.test(saltHex) || !/^[0-9a-f]+$/.test(hashHex)) return null;

  return {
    N: parsedN,
    r: parsedR,
    p: parsedP,
    salt: Buffer.from(saltHex, "hex"),
    hash: Buffer.from(hashHex, "hex"),
  };
}

/**
 * Check a password against a stored hash.
 *
 * Uses the parameters recorded *in the hash*, not the current constants, so
 * raising the cost never locks anyone out.
 *
 * The comparison is `timingSafeEqual`: a plain `===` returns faster the earlier
 * two buffers differ, which leaks the hash byte by byte to an attacker who can
 * measure it.
 */
export async function verifyPassword(
  password: string,
  stored: string | null,
): Promise<boolean> {
  if (!stored) return false;
  if (typeof password !== "string" || password.length === 0) return false;
  // Refuse to spend 64 MB hashing an oversized string someone sent us.
  if (password.length > MAX_PASSWORD_LENGTH) return false;

  const parsed = parseHash(stored);
  if (!parsed) return false;

  let derived: Buffer;
  try {
    derived = await scrypt(password, parsed.salt, parsed.hash.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: MAX_MEM,
    });
  } catch {
    // Bad stored parameters, or a memory limit. Treat as a failed sign-in
    // rather than a crash — one corrupt row must not take the site down.
    return false;
  }

  if (derived.length !== parsed.hash.length) return false;
  return timingSafeEqual(derived, parsed.hash);
}

/**
 * Whether a stored hash was made with weaker parameters than current policy.
 *
 * Call after a *successful* sign-in — that is the only moment the plaintext is
 * available to re-hash with. Lets the cost be raised over time without a reset
 * email, and without anyone noticing.
 */
export function needsRehash(stored: string | null): boolean {
  if (!stored) return false;
  const parsed = parseHash(stored);
  if (!parsed) return true;
  return parsed.N < N || parsed.r < R || parsed.p < P;
}
