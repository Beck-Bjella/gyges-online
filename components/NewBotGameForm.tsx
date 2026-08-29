"use client";

import { useActionState, useState } from "react";
import { createBotGameAction, type ActionState } from "@/app/actions";

const initial: ActionState = {};

export interface BotOption {
  id: string;
  username: string;
  description: string | null;
  /** Node budget, which is what actually decides the wait. */
  maxNodes: number | null;
}

/**
 * Start a game against the engine.
 *
 * The wait is stated up front rather than discovered. It is honest about being
 * an estimate: the engine runs on the player's own machine, so a phone takes
 * several times longer than a desktop for the same search — but because a bot
 * is bounded by node count rather than seconds, the *move* is identical either
 * way. Only the waiting differs.
 */
export default function NewBotGameForm({ bots }: { bots: BotOption[] }) {
  const [state, formAction, pending] = useActionState(createBotGameAction, initial);
  const [botId, setBotId] = useState(bots[0]?.id ?? "");

  const chosen = bots.find((b) => b.id === botId) ?? bots[0];

  if (bots.length === 0) return null;

  return (
    <form action={formAction} className="panel">
      <h2>Play the engine</h2>

      <div className="field">
        <label htmlFor="bot_id">Opponent</label>
        <select
          id="bot_id"
          name="bot_id"
          value={botId}
          onChange={(e) => setBotId(e.target.value)}
        >
          {bots.map((b) => (
            <option key={b.id} value={b.id}>
              {b.username}
            </option>
          ))}
        </select>
        {chosen?.description && <p className="hint">{chosen.description}</p>}
      </div>

      <div className="field">
        <label htmlFor="bot_move_seconds">Time control</label>
        <select id="bot_move_seconds" name="move_seconds" defaultValue="259200">
          <option value="86400">1 day per move</option>
          <option value="259200">3 days per move</option>
          <option value="604800">7 days per move</option>
          <option value="300">5 minutes per move (testing)</option>
        </select>
      </div>

      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "…" : "Play"}
        </button>
      </div>

      {chosen?.maxNodes != null && (
        <p className="hint" style={{ marginTop: 12 }}>
          {describeWait(chosen.maxNodes)} The engine runs in this browser tab,
          so a slower device waits longer — but plays the same opponent.
        </p>
      )}

      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}

/**
 * A rough wait, from the node budget.
 *
 * ~26,000 nodes a second on the desktop this was measured on. Deliberately
 * vague — the point is to set expectations, and quoting a precise number for
 * hardware we know nothing about would be false precision.
 */
function describeWait(maxNodes: number): string {
  const seconds = maxNodes / 26000;
  if (seconds < 2) return "Thinks for about a second per move.";
  if (seconds < 5) return "Thinks for a few seconds per move.";
  if (seconds < 20) return "Thinks for around ten seconds per move.";
  return "Thinks for up to a minute per move.";
}
