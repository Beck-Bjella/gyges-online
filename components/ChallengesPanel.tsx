/**
 * Challenges waiting on the viewer, listed like the games they are.
 *
 * Rows only — accepting, declining and cancelling all live on the game's own
 * page, the same place every other decision about a game is made. This list
 * just says who is asking and takes you there.
 *
 * Always rendered, empty or not, like every section on the dashboard: a page
 * whose headings come and go is hard to learn your way around, and an absent
 * section is indistinguishable from one you scrolled past.
 */

import Link from "next/link";

interface Challenge {
  id: string;
  name: string;
}

export default function ChallengesPanel({ incoming }: { incoming: Challenge[] }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h2>Challenges</h2>
      {incoming.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          None waiting. Challenge someone from their profile, or a friend from
          the list.
        </p>
      ) : (
      <ul className="list" style={{ margin: 0 }}>
        {incoming.map((c) => (
          <li key={c.id} className="list-item urgent">
            <span className="avatar avatar-mint">
              {c.name.charAt(0).toUpperCase()}
            </span>
            <span style={{ flex: 1 }}>
              <Link href={`/game/${c.id}`}>
                <strong>{c.name}</strong> challenged you
              </Link>
            </span>
            <Link className="muted" href={`/player/${encodeURIComponent(c.name)}`}>
              profile
            </Link>
          </li>
        ))}
      </ul>
      )}
    </div>
  );
}
