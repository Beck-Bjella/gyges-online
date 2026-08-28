"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentUser, signIn, signOut } from "@/lib/auth";
import { createGame, joinGame, renameUser, GameError } from "@/lib/db/queries";

export interface ActionState {
  error?: string;
}

export async function signInAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const username = String(formData.get("username") ?? "");
  if (!username.trim()) return { error: "Enter a username." };
  try {
    await signIn(username);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not sign in." };
  }
  revalidatePath("/");
  return {};
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
