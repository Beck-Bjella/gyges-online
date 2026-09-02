"use client";

import { useActionState } from "react";
import { quickGameAction, type ActionState } from "@/app/actions";

const initial: ActionState = {};

/**
 * Sit down at whichever table has waited longest.
 *
 * Joins only — it never hosts. Wanting a game right now and being willing to
 * wait for one are different intentions, and a button that silently did the
 * second when the first was impossible would leave people staring at an empty
 * board wondering what they had started.
 */
export default function QuickGameButton() {
  const [state, submit, pending] = useActionState(quickGameAction, initial);

  return (
    <form action={submit}>
      <button className="btn btn-primary" disabled={pending}>
        {pending ? "…" : "Play now"}
      </button>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}
