"use client";

import { useActionState } from "react";
import { createBotGameAction, type ActionState } from "@/app/actions";

const initial: ActionState = {};

export interface BotChoice {
  id: string;
  username: string;
  rating: number;
}

/**
 * Play the computer, starting immediately.
 *
 * Each opponent shows its rating in the list, because that is the number that
 * says how hard it is.
 */
export default function StartComputerForm({
  bots,
  more,
}: {
  bots: BotChoice[];
  /** Where the full ladder lives, for people who want to choose properly. */
  more?: string;
}) {
  const [state, submit, pending] = useActionState(createBotGameAction, initial);

  return (
    <form action={submit} className="panel start-card">
      <h2>Play the computer</h2>
      <p className="muted">
        Starts right away, and the computer waits as long as you need.
      </p>

      <label className="start-field">
        <span>Opponent</span>
        <select name="bot_id" defaultValue={bots[0]?.id}>
          {bots.map((b) => (
            <option key={b.id} value={b.id}>
              {b.username} · {b.rating}
            </option>
          ))}
        </select>
      </label>

      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "…" : "Play"}
        </button>
        {more && (
          <a className="btn" href={more}>
            All opponents
          </a>
        )}
      </div>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}
