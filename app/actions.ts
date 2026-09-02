"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { changePassword, currentUser, signIn, signOut, signUp } from "@/lib/auth";
import {
  createBotGame,
  createGame,
  joinGame,
  oldestJoinableGame,
  renameUser,
  GameError,
  createChallenge,
  respondToFriendRequest,
  removeFriend,
  sendFriendRequest,
  setUserEmail,
} from "@/lib/db/queries";

export interface ActionState {
  error?: string;
  /** Set by actions that succeed without navigating, e.g. changing a password. */
  message?: string;
}

/**
 * Sign in, or create an account.
 *
 * One action behind one form, switched by which button was pressed, because
 * the two forms want exactly the same two fields. The distinction that matters
 * is in lib/auth.ts: signUp refuses a name that exists, signIn refuses one that
 * does not. This only routes to the right one.
 */
export async function signInAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  const intent = String(formData.get("intent") ?? "signin");

  if (!username.trim()) return { error: "Enter a username." };
  if (!password) return { error: "Enter a password." };

  try {
    if (intent === "signup") {
      await signUp(username, password);
    } else {
      await signIn(username, password);
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not sign in." };
  }

  // Sending the player straight to the dashboard, rather than re-rendering the
  // landing page, is what makes a successful sign-in feel like it worked.
  redirect("/dashboard");
}

export async function changePasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await currentUser();
  if (!user) return { error: "Sign in first." };

  const current = String(formData.get("current_password") ?? "");
  const next = String(formData.get("new_password") ?? "");
  const confirm = String(formData.get("confirm_password") ?? "");

  if (next !== confirm) return { error: "The new passwords do not match." };

  try {
    await changePassword(user, current, next);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not change your password.",
    };
  }

  return { message: "Password changed. Other sessions have been signed out." };
}

/**
 * Set or clear the email on your own account.
 *
 * Nothing is sent to it yet — it is stored so that notifications and password
 * recovery have somewhere to go when those exist. Submitting an empty field
 * takes the address back off the site.
 */
export async function setEmailAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await currentUser();
  if (!user) return { error: "Sign in first." };

  const email = String(formData.get("email") ?? "");
  try {
    setUserEmail(user.id, email);
  } catch (err) {
    if (err instanceof GameError) return { error: err.message };
    return { error: "Could not save that address." };
  }

  revalidatePath(`/player/${encodeURIComponent(user.username)}`);
  return {
    message: email.trim() ? "Email saved." : "Email removed.",
  };
}

export async function signOutAction(): Promise<void> {
  await signOut();
  revalidatePath("/");
  redirect("/");
}

export async function createGameAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await currentUser();
  if (!user) return { error: "Sign in first." };

  const seconds = Number(formData.get("move_seconds") ?? 259200);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return { error: "Invalid time control." };
  }

  try {
    createGame(user.id, seconds, undefined, formData.get("casual") === null);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create the game." };
  }
  // To the dashboard, not into the game. There is nothing to do in an empty
  // game but wait, and being dropped into one reads as though something went
  // wrong. The dashboard shows it waiting, next to everything else of yours.
  revalidatePath("/games");
  redirect("/dashboard");
}

/**
 * Sit down at whichever public table has waited longest.
 *
 * Joins only. It deliberately does not host one when there is nothing to
 * join: wanting a game now and being willing to wait for one are different
 * intentions, and quietly doing the second leaves someone looking at an empty
 * board wondering what they started. When nobody is waiting it says so, and
 * hosting is the button underneath.
 */
export async function quickGameAction(
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const user = await currentUser();
  if (!user) return { error: "Sign in first." };

  const table = oldestJoinableGame(user.id);
  if (!table) {
    return { error: "No open tables right now — host one and see who turns up." };
  }

  try {
    joinGame(table.id, user.id);
  } catch (err) {
    // Someone else took the seat between the query and the join. That is the
    // race this button invites, and the honest answer is to say so rather
    // than to loop looking for another.
    if (err instanceof GameError) return { error: err.message };
    return { error: "Could not join that game." };
  }
  redirect(`/game/${table.id}`);
}

/**
 * Start a game against the engine.
 *
 * Separate from createGameAction because there is no lobby step: the second
 * seat is filled immediately, so this goes straight to a playable game.
 */
export async function createBotGameAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await currentUser();
  if (!user) return { error: "Sign in first." };

  const botId = String(formData.get("bot_id") ?? "");
  if (!botId) return { error: "Choose an opponent." };

  const seconds = Number(formData.get("move_seconds") ?? 259200);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return { error: "Invalid time control." };
  }

  // Unchecked box sends nothing, so absence is "rated" — which is also the
  // right default when this is called from somewhere with no box at all.
  const rated = formData.get("casual") === null;

  let id: string;
  try {
    id = createBotGame(user.id, botId, seconds, rated).id;
  } catch (err) {
    if (err instanceof GameError) return { error: err.message };
    return { error: "Could not start that game." };
  }
  redirect(`/game/${id}`);
}

export async function joinGameAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await currentUser();
  if (!user) return { error: "Sign in first." };

  const gameId = String(formData.get("game_id") ?? "");
  try {
    joinGame(gameId, user.id);
  } catch (err) {
    if (err instanceof GameError) return { error: err.message };
    return { error: "Could not join that game." };
  }
  redirect(`/game/${gameId}`);
}

export async function renameAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await currentUser();
  if (!user) return { error: "Sign in first." };

  const username = String(formData.get("username") ?? "");
  if (username.trim() === user.username) return {};

  try {
    renameUser(user.id, username);
  } catch (err) {
    if (err instanceof GameError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Could not rename." };
  }

  revalidatePath("/", "layout");
  redirect(`/player/${encodeURIComponent(username.trim())}`);
}

/**
 * Send, accept or decline a friend request. One action for the three verbs,
 * because they are one button in three states.
 */
export async function friendAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await currentUser();
  if (!user) return { error: "Sign in first." };

  const otherId = String(formData.get("user_id") ?? "");
  const op = String(formData.get("op") ?? "");
  try {
    if (op === "send") sendFriendRequest(user.id, otherId);
    else if (op === "accept") respondToFriendRequest(user.id, otherId, true);
    else if (op === "decline") respondToFriendRequest(user.id, otherId, false);
    else if (op === "remove") removeFriend(user.id, otherId);
    else return { error: "Unknown request." };
  } catch (err) {
    if (err instanceof GameError) return { error: err.message };
    return { error: "Could not update friends." };
  }
  revalidatePath("/dashboard");
  // The profile the button lives on, so its label catches up immediately.
  const path = String(formData.get("path") ?? "");
  if (path.startsWith("/player/")) revalidatePath(path);
  return {};
}

/** Challenge a specific player: an open game reserved for them. */
export async function challengeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await currentUser();
  if (!user) return { error: "Sign in first." };

  const otherId = String(formData.get("user_id") ?? "");
  try {
    createChallenge(user.id, otherId);
  } catch (err) {
    if (err instanceof GameError) return { error: err.message };
    return { error: "Could not send that challenge." };
  }
  // Same reasoning as hosting: a challenge is sent, not entered. It waits
  // under Challenges on the dashboard until they answer.
  redirect("/dashboard");
}

