"use client";

/**
 * Requests to answer and friends to challenge. Challenges themselves live in
 * their own panel — this is where they are sent FROM, not where they arrive.
 */

import Link from "next/link";
import { useActionState } from "react";
import { challengeAction, friendAction, type ActionState } from "@/app/actions";

interface Person {
  id: string;
  username: string;
}

const initial: ActionState = {};

export default function FriendsPanel({
  requests,
  friends,
}: {
  requests: Person[];
  friends: Person[];
}) {
  const [friendResult, submitFriend] = useActionState(friendAction, initial);
  const [challengeResult, submitChallenge] = useActionState(challengeAction, initial);
  const error = friendResult.error ?? challengeResult.error;

  return (
    <div className="panel">
      <h2>Friends</h2>

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
