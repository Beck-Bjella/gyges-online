"use client";

import { useActionState } from "react";
import { createGameAction, type ActionState } from "@/app/actions";

const initial: ActionState = {};

export default function NewGameForm() {
  const [state, formAction, pending] = useActionState(createGameAction, initial);

  return (
    <form action={formAction} className="panel">
      <h2>New game</h2>
      <div className="row">
        <select name="move_seconds" defaultValue="259200">
          <option value="86400">1 day per move</option>
          <option value="259200">3 days per move</option>
          <option value="604800">7 days per move</option>
          <option value="300">5 minutes per move (testing)</option>
        </select>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "…" : "Create"}
        </button>
      </div>
      <p className="muted" style={{ margin: "12px 0 0", lineHeight: 1.5 }}>
        Creates an open game. Anyone signed in can join it.
      </p>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}
