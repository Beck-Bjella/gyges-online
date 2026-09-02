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
 * The opponents carry their ladder rating in the list, because that is the
 * only number that says what beating one is worth — and choosing an opponent
 * is choosing what you are trying to prove.
 */
export default function StartComputerForm({ bots }: { bots: BotChoice[] }) {
  const [state, submit, pending] = useActionState(createBotGameAction, initial);

  return (
    <form action={submit} className="panel start-card">
      <h2>Play the computer</h2>
      <p className="muted">
        Starts at once, and it waits as long as you do. Take a move back and
        the game stops counting towards your rating.
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

      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "…" : "Play"}
      </button>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}
