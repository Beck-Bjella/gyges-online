"use client";

/**
 * One click from the engine table to a game against that bot.
 *
 * The same action the old opponent-picker form used, minus the picking: the
 * row already says who the bot is and how it has done, so the button's whole
 * job is to start. Time control takes the default — a bot never feels
 * pressure, so the deadline only ever paces the human.
 */

import { useActionState } from "react";
import { createBotGameAction, type ActionState } from "@/app/actions";

const initial: ActionState = {};

export default function ChallengeEngineButton({ botId }: { botId: string }) {
  const [state, submit, pending] = useActionState(createBotGameAction, initial);

  return (
    <form action={submit}>
      <input type="hidden" name="bot_id" value={botId} />
      <button className="btn btn-primary" disabled={pending}>
        {pending ? "…" : "Play"}
      </button>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}
