"use client";

/**
 * The social corner of the dashboard: requests to answer, friends to
 * challenge, and challenges travelling in each direction.
 *
 * A challenge is an open game reserved for one player, so accepting one IS
 * joining a game — the same action the lobby uses.
 */

import Link from "next/link";
import { useActionState } from "react";
import {
  challengeAction,
  friendAction,
  joinGameAction,
  type ActionState,
} from "@/app/actions";

interface Person {
  id: string;
  username: string;
}

interface Challenge {
  id: string;
  name: string;
}

const initial: ActionState = {};

export default function FriendsPanel({
  requests,
  friends,
  incoming,
  outgoing,
}: {
  requests: Person[];
  friends: Person[];
  incoming: Challenge[];
  outgoing: Challenge[];
}) {
  const [friendResult, submitFriend] = useActionState(friendAction, initial);
  const [challengeResult, submitChallenge] = useActionState(challengeAction, initial);
  const [joinResult, submitJoin] = useActionState(joinGameAction, initial);
  const error = friendResult.error ?? challengeResult.error ?? joinResult.error;

  return (
    <div className="panel">
      <h2>Friends</h2>

      {incoming.length > 0 && (
        <ul className="list" style={{ marginBottom: 12 }}>
          {incoming.map((c) => (
            <li key={c.id} className="list-item">
              <span style={{ flex: 1 }}>
                <strong>{c.name}</strong> challenged you
              </span>
              <form action={submitJoin}>
                <input type="hidden" name="game_id" value={c.id} />
                <button className="btn btn-primary">Accept</button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {requests.length > 0 && (
        <ul className="list" style={{ marginBottom: 12 }}>
          {requests.map((p) => (
            <li key={p.id} className="list-item">
              <span style={{ flex: 1 }}>
                <Link href={`/player/${encodeURIComponent(p.username)}`}>
                  {p.username}
                </Link>{" "}
                wants to be friends
              </span>
              <Answer op="accept" label="Accept" userId={p.id} action={submitFriend} />
              <Answer op="decline" label="Decline" userId={p.id} action={submitFriend} />
            </li>
          ))}
        </ul>
      )}

      {friends.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          No friends yet — add people from their profiles.
        </p>
      ) : (
        <ul className="list" style={{ margin: 0 }}>
          {friends.map((p) => (
            <li key={p.id} className="list-item">
              <span style={{ flex: 1 }}>
                <Link href={`/player/${encodeURIComponent(p.username)}`}>
                  {p.username}
                </Link>
              </span>
              <form action={submitChallenge}>
                <input type="hidden" name="user_id" value={p.id} />
                <button className="btn">Challenge</button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {outgoing.length > 0 && (
        <p className="hint" style={{ margin: "12px 0 0" }}>
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

function Answer({
  op,
  label,
  userId,
  action,
}: {
  op: string;
  label: string;
  userId: string;
  action: (formData: FormData) => void;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="user_id" value={userId} />
      <input type="hidden" name="op" value={op} />
      <button className={op === "accept" ? "btn btn-primary" : "btn"}>{label}</button>
    </form>
  );
}
