"use client";

import { useActionState } from "react";
import { joinGameAction, type ActionState } from "@/app/actions";

const initial: ActionState = {};

export default function JoinGameButton({ gameId }: { gameId: string }) {
  const [state, formAction, pending] = useActionState(joinGameAction, initial);

  return (
    <form action={formAction}>
      <input type="hidden" name="game_id" value={gameId} />
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "…" : "Join"}
      </button>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}
