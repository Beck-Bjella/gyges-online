/**
 * Sessions and authentication.
 *
 * A username plus a password identifies an account; the session token goes in
 * an httpOnly cookie. Passwords are never stored — see lib/password.ts.
 *
 * ## Sign-up and sign-in are different actions
 *
 * They used to be one: any username signed you in, creating the account if it
 * was free. That is why a typo silently made a second account, and why anyone
 * who knew a name could be that person.
 *
 * Now `signUp` refuses a name that exists, and `signIn` refuses one that does
 * not. Wanting to create an account and wanting to use one are different
 * intentions, and conflating them is what made the old behaviour surprising.
 *
 * ## Every account has a password
 *
 * There is no path that sets a password by signing in. An account without one
 * cannot be signed in to at all — which is exactly what makes the bots' rows
 * safe to leave passwordless.
 */

import { cookies } from "next/headers";
import {
  createSession,
  createUser,
  deleteSession,
  deleteSessionsForUser,
  findUserByName,
  passwordHashFor,
  purgeExpiredSessions,
  setPasswordHash,
  userForSession,
  GameError,
  type User,
} from "./db/queries";
import {
  hashPassword,
  needsRehash,
  validatePassword,
  verifyPassword,
} from "./password";

export const SESSION_COOKIE = "gyges_session";

/**
 * Whether to mark the session cookie Secure.
 *
 * A Secure cookie is only ever sent back over HTTPS. That is correct for a
 * deployed site, and silently breaks sign-in when the production build is
 * served over plain http — which is exactly how the site is tested on a local
 * network. The browser accepts the cookie and then never returns it, so every
 * request looks signed out.
 *
 * So: on by default in production, but switched off when GYGES_INSECURE_COOKIES
 * is set, which the LAN scripts do. Never set that in a real deployment.
 */
function useSecureCookies(): boolean {
  if (process.env.GYGES_INSECURE_COOKIES === "1") return false;
  return process.env.NODE_ENV === "production";
}

export async function currentUser(): Promise<User | null> {
  const store = await cookies();
  return userForSession(store.get(SESSION_COOKIE)?.value);
}

/** Issue a session and set the cookie. */
async function startSession(user: User): Promise<void> {
  const token = createSession(user.id);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 86400,
    secure: useSecureCookies(),
  });
}

/**
 * The message shown when a username or password is wrong.
 *
 * Deliberately identical for both cases. Saying "no such user" would turn the
 * sign-in form into a way to test which usernames exist, which is the first
 * step in attacking one. The site leaks usernames elsewhere by design — the
 * leaderboard lists them — but there is no reason to hand out a *checker*.
 */
const BAD_CREDENTIALS =
  "Incorrect username or password. If you are new, use Create account.";

/**
 * Create a new account.
 *
 * Refuses an existing name, including one that differs only by case: usernames
 * are unique case-insensitively, so "Beck" and "beck" cannot both exist.
 */
export async function signUp(username: string, password: string): Promise<User> {
  const problem = validatePassword(password);
  if (problem) throw new GameError(problem);

  // Check before hashing: no reason to spend 120ms on a name that is taken.
  // createUser re-checks and the UNIQUE index is the real guarantee.
  if (findUserByName(username)) throw new GameError("That username is taken.");

  const hash = await hashPassword(password);
  const user = createUser(username, hash);

  purgeExpiredSessions();
  await startSession(user);
  return user;
}

/**
 * Sign in to an existing account.
 *
 * Two outcomes: the password verifies, or it does not. An account with no
 * stored password — which today means a bot — can never be signed in to, since
 * verifyPassword refuses a null hash outright.
 */
export async function signIn(username: string, password: string): Promise<User> {
  if (!password) throw new GameError(BAD_CREDENTIALS);

  const user = findUserByName(username);
  if (!user || user.deleted_at) throw new GameError(BAD_CREDENTIALS);

  const stored = passwordHashFor(user.id);

  if (!(await verifyPassword(password, stored))) {
    throw new GameError(BAD_CREDENTIALS);
  }

  // Upgrade a hash made with older, cheaper parameters. This is the only moment
  // the plaintext exists to re-hash with, and it is invisible to the player.
  if (needsRehash(stored)) {
    setPasswordHash(user.id, await hashPassword(password));
  }

  purgeExpiredSessions();
  await startSession(user);
  return user;
}

/**
 * Change the password of the signed-in account.
 *
 * Requires the current password even though there is already a valid session:
 * it is what stops someone at a borrowed keyboard from taking the account over.
 * Every *other* session is ended, on the assumption that a password change may
 * be a response to a compromise.
 */
export async function changePassword(
  user: User,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const problem = validatePassword(newPassword);
  if (problem) throw new GameError(problem);

  if (!(await verifyPassword(currentPassword, passwordHashFor(user.id)))) {
    throw new GameError("Your current password is not correct.");
  }

  setPasswordHash(user.id, await hashPassword(newPassword));

  const store = await cookies();
  deleteSessionsForUser(user.id, store.get(SESSION_COOKIE)?.value);
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) deleteSession(token);
  store.delete(SESSION_COOKIE);
}
