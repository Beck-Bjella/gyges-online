"use client";

import { useActionState } from "react";
import { createGameAction, type ActionState } from "@/app/actions";

const initial: ActionState = {};

/**
 * Hosting, spelled out: what a table is, where it appears, when it starts.
 * This sits at the top of the Play tab, so it carries the explanation for
 * the whole flow — the sections below it are what it creates.
 */
export default function NewGameForm() {
  const [state, formAction, pending] = useActionState(createGameAction, initial);

  return (
    <form action={formAction} className="panel host-panel">
      <div className="host-copy">
        <h2>Host an open game</h2>
        <p className="muted">
          Puts a table up for anyone signed in to join. It waits in the list
          below, and the game starts the moment someone sits down — the pace
          you pick is how long each move may take, not a clock you must watch.
        </p>
      </div>
      <div className="host-controls">
        <label className="muted" htmlFor="host-pace">
          Pace
        </label>
        <select id="host-pace" name="move_seconds" defaultValue="259200">
          <option value="86400">1 day per move</option>
          <option value="259200">3 days per move</option>
          <option value="604800">7 days per move</option>
          <option value="300">5 minutes per move (testing)</option>
        </select>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "…" : "Host game"}
        </button>
      </div>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}
