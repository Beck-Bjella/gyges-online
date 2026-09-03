"use client";

import { useActionState } from "react";
import { createGameAction, type ActionState } from "@/app/actions";

const initial: ActionState = {};

/**
 * Host an open game and wait for an opponent.
 *
 * One of the three ways to start a game, and the only one that does not begin
 * immediately — which is the thing the copy has to convey, since a table that
 * sits there looking like nothing happened is the most confusing outcome on
 * this page.
 */
export default function NewGameForm() {
  const [state, formAction, pending] = useActionState(createGameAction, initial);

  return (
    <form action={formAction} className="panel start-card">
      <h2>Host a game</h2>
      <p className="muted">
        Creates an open game that waits in the list below until another player
        joins it.
      </p>

      <label className="start-field">
        <span>Pace</span>
        <select name="move_seconds" defaultValue="259200">
          <option value="43200">12 hours per move</option>
          <option value="86400">1 day per move</option>
          <option value="259200">3 days per move</option>
          <option value="604800">7 days per move</option>
          <option value="1209600">14 days per move</option>
          <option value="300">5 minutes per move</option>
        </select>
      </label>

      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "…" : "Host game"}
      </button>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}
