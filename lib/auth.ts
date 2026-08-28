/**
 * Session handling.
 *
 * Deliberately minimal for local development: a username claims an account, and
 * the session token goes in an httpOnly cookie. There are no passwords yet —
 * anyone who knows a username can sign in as them.
 *
 * This is fine for local play and testing, and MUST be replaced before the site
 * is public. See docs/ARCHITECTURE.md for the open question on auth method.
 */

import { cookies } from "next/headers";
import {
  createSession,
  createUser,
  deleteSession,
  findUserByName,
  userForSession,
  type User,
} from "./db/queries";

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

/** Sign in to an existing account, or create one if the name is free. */
export async function signIn(username: string): Promise<User> {
  const existing = findUserByName(username);
  const user = existing ?? createUser(username);
  const token = createSession(user.id);

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 86400,
    secure: useSecureCookies(),
  });
  return user;
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) deleteSession(token);
  store.delete(SESSION_COOKIE);
}
