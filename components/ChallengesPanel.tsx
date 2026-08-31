"use client";

/**
 * Challenges in both directions, apart from the friends list — friends are
 * where challenges are SENT from; this is where they arrive and wait.
 *
 * Accepting joins the game, the same action the lobby uses. Declining deletes
 * it: the game never started, and leaving it to rot in the sender's waiting
 * list would be worse than an answer.
 */

import Link from "next/link";
import { useActionState } from "react";
import {
  declineChallengeAction,
  joinGameAction,
  type ActionState,
} from "@/app/actions";

interface Challenge {
  id: string;
  name: string;
}

const initial: ActionState = {};

export default function ChallengesPanel({
  incoming,
  outgoing,
}: {
  incoming: Challenge[];
  outgoing: Challenge[];
}) {
  const [joinResult, submitJoin] = useActionState(joinGameAction, initial);
  const [declineResult, submitDecline] = useActionState(declineChallengeAction, initial);
  const error = joinResult.error ?? declineResult.error;

  if (incoming.length === 0 && outgoing.length === 0) return null;

  return (
    <div className="panel">
      <h2>Challenges</h2>

      {incoming.length > 0 && (
        <ul className="list" style={{ margin: 0 }}>
          {incoming.map((c) => (
            <li key={c.id} className="list-item">
              <span style={{ flex: 1 }}>
                <strong>{c.name}</strong> challenged you
              </span>
              <form action={submitJoin}>
                <input type="hidden" name="game_id" value={c.id} />
                <button className="btn btn-primary">Accept</button>
              </form>
              <form action={submitDecline}>
                <input type="hidden" name="game_id" value={c.id} />
                <button className="btn">Decline</button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {outgoing.length > 0 && (
        <p className="hint" style={{ margin: incoming.length ? "12px 0 0" : 0 }}>
          Waiting on:{" "}
          {outgoing.map((c, i) => (
            <span key={c.id}>
              {i > 0 && ", "}
              <Link href={`/game/${c.id}`}>{c.name}</Link>
            </span>
          ))}
        </p>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  );
}
