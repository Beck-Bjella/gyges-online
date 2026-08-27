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
    secure: process.env.NODE_ENV === "production",
  });
  return user;
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) deleteSession(token);
  store.delete(SESSION_COOKIE);
}
