"use client";

/**
 * Add-friend and challenge, on another player's profile.
 *
 * The friend button is one control in four states rather than four controls:
 * ask, asked (disabled), answer, or friends (label only). The server owns the
 * truth — the state prop is what it said when the page rendered, and the
 * action revalidates this page so the label catches up on its own.
 */

import { useActionState } from "react";
import { usePathname } from "next/navigation";
import { challengeAction, friendAction, type ActionState } from "@/app/actions";
import type { FriendState } from "@/lib/db/queries";

const initial: ActionState = {};

export default function SocialButtons({
  userId,
  state,
}: {
  userId: string;
  state: FriendState;
}) {
  const [friendResult, submitFriend, friendPending] = useActionState(
    friendAction,
    initial,
  );
  const [challengeResult, submitChallenge, challengePending] = useActionState(
    challengeAction,
    initial,
  );
  const path = usePathname();

  return (
    <div className="row" style={{ margin: "0 0 22px" }}>
      {state === "friends" ? (
        <span className="tag" style={{ borderColor: "var(--accent-mint)", color: "var(--accent-mint)" }}>
          Friends
        </span>
      ) : state === "received" ? (
        <>
          <FriendForm op="accept" label="Accept friend request" primary
            userId={userId} path={path} action={submitFriend} pending={friendPending} />
          <FriendForm op="decline" label="Decline"
            userId={userId} path={path} action={submitFriend} pending={friendPending} />
        </>
      ) : (
        <FriendForm
          op="send"
          label={state === "sent" ? "Request sent" : "Add friend"}
          userId={userId}
          path={path}
          action={submitFriend}
          pending={friendPending || state === "sent"}
        />
      )}

      <form action={submitChallenge}>
        <input type="hidden" name="user_id" value={userId} />
        <button className="btn btn-primary" disabled={challengePending}>
          Challenge to a game
        </button>
      </form>

      {(friendResult.error || challengeResult.error) && (
        <p className="error" style={{ margin: 0 }}>
          {friendResult.error ?? challengeResult.error}
        </p>
      )}
    </div>
  );
}

function FriendForm({
  op,
  label,
  userId,
  path,
  action,
  pending,
  primary,
}: {
  op: string;
  label: string;
  userId: string;
  path: string;
  action: (formData: FormData) => void;
  pending: boolean;
  primary?: boolean;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="user_id" value={userId} />
      <input type="hidden" name="op" value={op} />
      <input type="hidden" name="path" value={path} />
      <button className={primary ? "btn btn-primary" : "btn"} disabled={pending}>
        {label}
      </button>
    </form>
  );
}
