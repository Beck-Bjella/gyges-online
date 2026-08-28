/**
 * Client for the Gygès engine service.
 *
 * NOT WIRED UP YET. This is the shape the integration will take, written down
 * so the seam is visible rather than hypothetical. Every function currently
 * short-circuits when GYGES_ENGINE_URL is unset, which it is.
 *
 * The engine service is a separate program: a thin bridge that runs
 * gyges_engine.exe as a child process, translates HTTP requests into UGI
 * commands on its stdin, and reads replies from its stdout. See
 * docs/ARCHITECTURE.md.
 *
 * Server-side only. The browser must never call this directly — a player can
 * edit their own JavaScript, so any check made there is a convenience, never a
 * guarantee.
 */

import { boardToString, type BoardState, type Move, type Player } from "../game/board.ts";

const ENGINE_URL = process.env.GYGES_ENGINE_URL;

/** Whether an engine service is configured. False today. */
export function engineAvailable(): boolean {
  return Boolean(ENGINE_URL);
}

export interface LegalityResult {
  /** True if the move is legal, or if no engine is configured to say otherwise. */
  legal: boolean;
  /** Why it was rejected, when the engine says so. */
  reason?: string;
  /** False when no engine answered, so the caller knows this was not a real check. */
  checked: boolean;
}

/**
 * Ask the engine whether a move is legal.
 *
 * Until an engine service exists this returns `{legal: true, checked: false}` —
 * the current, deliberate "rule-free" behaviour. Callers that care about the
 * difference should look at `checked`.
 */
export async function validateMove(
  board: BoardState,
  player: Player,
  move: Move,
): Promise<LegalityResult> {
  if (!ENGINE_URL) return { legal: true, checked: false };

  const res = await fetch(`${ENGINE_URL}/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      board: boardToString(board),
      player,
      move: move.join("|"),
    }),
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) throw new Error(`engine returned ${res.status}`);
  const body = (await res.json()) as { legal: boolean; reason?: string };
  return { legal: body.legal, reason: body.reason, checked: true };
}

/**
 * Ask the engine for every legal move in a position.
 *
 * Intended for highlighting a piece's destinations while dragging. Returns null
 * when no engine is configured.
 */
export async function legalMoves(
  board: BoardState,
  player: Player,
): Promise<Move[] | null> {
  if (!ENGINE_URL) return null;

  const res = await fetch(`${ENGINE_URL}/legal-moves`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ board: boardToString(board), player }),
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) throw new Error(`engine returned ${res.status}`);
  const body = (await res.json()) as { moves: string[] };
  return body.moves.map((m) => m.split("|").map(Number));
}

/**
 * Ask the engine to choose a move.
 *
 * A search takes seconds and occupies a CPU core, so this must never block a
 * page render. When bot play is built this belongs in a queued job: accept the
 * request, search, then write the move and notify the opponent.
 */
export async function botMove(
  board: BoardState,
  player: Player,
  maxSeconds = 5,
): Promise<Move | null> {
  if (!ENGINE_URL) return null;

  const res = await fetch(`${ENGINE_URL}/bot-move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      board: boardToString(board),
      player,
      maxSeconds,
    }),
    // Generous: a search is allowed to take its time.
    signal: AbortSignal.timeout((maxSeconds + 10) * 1000),
  });

  if (!res.ok) throw new Error(`engine returned ${res.status}`);
  const body = (await res.json()) as { move: string };
  return body.move.split("|").map(Number);
}
