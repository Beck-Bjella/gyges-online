"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { changePassword, currentUser, signIn, signOut, signUp } from "@/lib/auth";
import {
  createBotGame,
  createGame,
  joinGame,
  renameUser,
  GameError,
  createChallenge,
  declineChallenge,
  respondToFriendRequest,
  removeFriend,
  sendFriendRequest,
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

  let id: string;
  try {
    id = createGame(user.id, seconds).id;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create the game." };
  }
  redirect(`/game/${id}`);
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

  let id: string;
  try {
    id = createBotGame(user.id, botId, seconds).id;
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
  let id: string;
  try {
    id = createChallenge(user.id, otherId).id;
  } catch (err) {
    if (err instanceof GameError) return { error: err.message };
    return { error: "Could not send that challenge." };
  }
  redirect(`/game/${id}`);
}

/** Turn a challenge down; the reserved game is deleted. */
export async function declineChallengeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await currentUser();
  if (!user) return { error: "Sign in first." };
  try {
    declineChallenge(String(formData.get("game_id") ?? ""), user.id);
  } catch (err) {
    if (err instanceof GameError) return { error: err.message };
    return { error: "Could not decline." };
  }
  revalidatePath("/dashboard");
  return {};
}
