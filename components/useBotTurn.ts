"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface BotTurnState {
  /** True while a search is running in the worker. */
  thinking: boolean;
  /** Seconds since this search began, for a progress line the player can read. */
  elapsed: number;
  /** Which bot is thinking, once the server has told us. */
  botName: string | null;
  error: string | null;
}

/**
 * Runs the engine when it is the bot's turn.
 *
 * The search happens in a Web Worker (public/engine/engine-worker.js) so a
 * multi-second search does not freeze the page. The exchange with the server is
 * two steps — "what should I search?" then "here is what it said" — and the
 * orientation of the board is decided server-side, so this hook never has to
 * reason about which side the bot is playing.
 *
 * ## Restarting, not resuming
 *
 * If the tab is closed mid-search the work is lost, and the next page load
 * begins the search again from zero. That is deliberate: resuming would mean
 * continuing with a partly-filled transposition table, which is a different
 * search and could produce a different move — the very thing a fixed node
 * budget exists to prevent. Nothing partial is ever stored.
 *
 * The worker is torn down on unmount, so navigating away really does stop the
 * CPU work rather than leaving it running behind the page.
 */
export function useBotTurn(
  gameId: string,
  /** True when the game is in progress and the engine is the side to move. */
  isBotTurn: boolean,
  onMovePlayed: () => void,
): BotTurnState {
  const [thinking, setThinking] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [botName, setBotName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);
  // Guards against starting a second search for the same turn — the poll that
  // refreshes the page can fire while one is already in flight.
  const runningRef = useRef(false);

  const stopWorker = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  const run = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setError(null);

    try {
      // 1. Ask the server what to do. During setup it places the bot's home row
      //    itself and answers `done`, since the engine cannot search a partial
      //    board.
      const ask = await fetch(`/api/games/${gameId}/bot-move`, { method: "POST" });
      const plan = (await ask.json()) as {
        done?: boolean;
        board?: string;
        options?: Record<string, string | number | boolean>;
        bot?: { username: string };
        error?: string;
      };

      if (!ask.ok) {
        // A 409 means the turn moved on under us — harmless, not worth showing.
        if (ask.status !== 409) setError(plan.error ?? "The engine could not move.");
        return;
      }
      if (plan.done) {
        onMovePlayed();
        return;
      }
      if (!plan.board) {
        setError("The server did not say what to search.");
        return;
      }

      setBotName(plan.bot?.username ?? null);
      setThinking(true);

      // 2. Search, in a worker so the page stays responsive.
      const worker = new Worker("/engine/engine-worker.js");
      workerRef.current = worker;

      const found = await new Promise<string | null>((resolve, reject) => {
        worker.onmessage = (event) => {
          const data = event.data as { ok: boolean; move?: string; error?: string };
          if (data.ok) resolve(data.move ?? null);
          else reject(new Error(data.error ?? "the engine failed"));
        };
        worker.onerror = () => reject(new Error("the engine could not be loaded"));
        worker.postMessage({ id: 1, board: plan.board, options: plan.options ?? {} });
      });

      stopWorker();

      if (!found) {
        setError("The engine found no move in this position.");
        return;
      }

      // 3. Hand it back. The server validates it exactly as it would a human's.
      const play = await fetch(`/api/games/${gameId}/bot-move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ move: found }),
      });
      if (!play.ok) {
        const body = (await play.json().catch(() => ({}))) as { error?: string };
        if (play.status !== 409) setError(body.error ?? "The engine's move was refused.");
        return;
      }
      onMovePlayed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The engine failed.");
    } finally {
      setThinking(false);
      runningRef.current = false;
      stopWorker();
    }
  }, [gameId, onMovePlayed, stopWorker]);

  // Start a search whenever it becomes the engine's turn.
  useEffect(() => {
    if (isBotTurn) void run();
  }, [isBotTurn, run]);

  // A visible clock while it thinks. The worker is busy, not the page, so this
  // keeps ticking — which is the point: a frozen number looks like a hang.
  useEffect(() => {
    if (!thinking) {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    const timer = setInterval(() => setElapsed((Date.now() - started) / 1000), 200);
    return () => clearInterval(timer);
  }, [thinking]);

  // Never leave a search running behind a page the player has left.
  useEffect(() => stopWorker, [stopWorker]);

  return { thinking, elapsed, botName, error };
}
