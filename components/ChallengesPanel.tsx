"use client";

/**
 * Challenges in both directions, answerable where they appear.
 *
 * The same decisions exist on each game's own page; these buttons are the
 * short path, because answering a challenge is a one-word reply and a page
 * visit is a lot to ask for one word. Accepting goes to the game, since
 * placing pieces is next; everything else stays here.
 *
 * Always rendered, empty or not, like every section on the dashboard: a page
 * whose headings come and go is hard to learn your way around.
 */

import Link from "next/link";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { relativeTime } from "@/lib/format";
import MiniBoard from "@/components/MiniBoard";
import { emptyBoard } from "@/lib/game/board";

interface Challenge {
  id: string;
  name: string;
  /** When it was last touched, for the same "· moments ago" the game rows carry. */
  at: number;
}

export default function ChallengesPanel({
  incoming,
  outgoing,
}: {
  incoming: Challenge[];
  outgoing: Challenge[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = useCallback(
    async (id: string, op: "join" | "decline" | "cancel") => {
      if (op === "cancel" && !confirm("Cancel this challenge? It will be removed."))
        return;
      setPending(true);
      setError(null);
      try {
        const res = await fetch(`/api/games/${id}/${op}`, { method: "POST" });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setError(body.error ?? "Could not do that.");
          return;
        }
        if (op === "join") router.push(`/game/${id}`);
        else router.refresh();
      } finally {
        setPending(false);
      }
    },
    [router],
  );

  return (
    <div style={{ marginBottom: 28 }}>
      <div className="section-head">
        <h2>Challenges</h2>
        {incoming.length + outgoing.length > 0 && (
          <span className={incoming.length > 0 ? "count count-mint" : "count count-amber"}>
            {incoming.length + outgoing.length}
          </span>
        )}
      </div>

      {incoming.length === 0 && outgoing.length === 0 && (
        <p className="muted" style={{ margin: 0 }}>
          None waiting. Challenge someone from their profile, or a friend from
          the list.
        </p>
      )}

      {(incoming.length > 0 || outgoing.length > 0) && (
        <ul className="watch-grid" style={{ margin: 0 }}>
          {incoming.map((c) => (
            <li key={c.id} className="game-card list-item urgent">
              <Link className="stretch-link" href={`/game/${c.id}`} aria-label="Open game" />
              <MiniBoard board={emptyBoard()} size={150} />
              <div className="game-card-meta">
                <div>
                  Challenge from{" "}
                  <Link href={`/player/${encodeURIComponent(c.name)}`}>
                    <strong>{c.name}</strong>
                  </Link>
                </div>
                <span className="muted" style={{ color: "var(--accent-mint)" }}>
                  {relativeTime(c.at)}
                </span>
              </div>
              <div className="row">
                <button
                  className="btn btn-primary"
                  onClick={() => act(c.id, "join")}
                  disabled={pending}
                >
                  Accept
                </button>
                <button
                  className="btn"
                  onClick={() => act(c.id, "decline")}
                  disabled={pending}
                >
                  Decline
                </button>
              </div>
            </li>
          ))}
          {outgoing.map((c) => (
            <li key={c.id} className="game-card list-item waiting">
              <Link className="stretch-link" href={`/game/${c.id}`} aria-label="Open game" />
              <MiniBoard board={emptyBoard()} size={150} />
              <div className="game-card-meta">
                <div>
                  Waiting for{" "}
                  <Link href={`/player/${encodeURIComponent(c.name)}`}>
                    <strong>{c.name}</strong>
                  </Link>
                </div>
                <span className="muted" style={{ color: "var(--accent-amber)" }}>
                  {relativeTime(c.at)}
                </span>
              </div>
              <button
                className="btn"
                onClick={() => act(c.id, "cancel")}
                disabled={pending}
              >
                Cancel
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  );
}
