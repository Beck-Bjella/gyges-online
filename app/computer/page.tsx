import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { botLeaderboard, opponentRecords } from "@/lib/db/queries";
import { BOTS } from "@/lib/bots";
import { engineLadder, engineRatingFor } from "@/lib/ladder";
import ChallengeEngineButton from "@/components/ChallengeEngineButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Play the computer · Gygès" };

/**
 * The computer opponents, as a ladder to climb.
 *
 * The copy here is deliberately plain. An earlier version explained the rating
 * mechanics in its own vocabulary — anchors, rungs, farm ceilings — and read
 * as nonsense to anyone who had not built it. The mechanics have not changed;
 * they are just described in words a visitor already has.
 */
export default async function ComputerPage() {
  const user = await currentUser();
  const bots = botLeaderboard();
  const ladder = engineLadder();
  const standing = user ? engineRatingFor(user.id) : null;

  // The viewer's record against each opponent.
  const records = new Map(
    user
      ? opponentRecords(user.id)
          .filter((o) => o.isBot)
          .map((o) => [o.username, o] as const)
      : [],
  );

  // Hardest at the top, easiest at the bottom — and each end says so.
  const rungs = bots
    .map((b) => ({
      ...b,
      rating: BOTS.find((spec) => spec.username === b.username)?.rating ?? 0,
    }))
    .sort((a, b) => b.rating - a.rating);

  const rating = standing?.rating ?? 0;
  const easiest = rungs[rungs.length - 1];
  /** The easiest opponent not beaten yet. */
  const next = [...rungs]
    .reverse()
    .find((r) => (records.get(r.username)?.wins ?? 0) === 0);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Play the computer</h1>
          <p className="lede" style={{ marginBottom: 0 }}>
            Five computer opponents, from easiest to hardest. Winning raises
            your rating — but wins against opponents far below you count for
            nothing, so the only way up is to beat the next one.
          </p>
        </div>
      </header>

      {user && (
        <div className="panel standing">
          <div className="standing-figure">
            <span className="standing-label">Your rating</span>
            <span className="standing-value">{rating}</span>
          </div>
          <p className="standing-note">
            {standing === null ? (
              <>
                You haven&apos;t played the computer yet. Start with{" "}
                <strong>{easiest?.username}</strong>.
              </>
            ) : standing.bestBeaten ? (
              <>
                Best win: <strong>{standing.bestBeaten}</strong>.
                {next ? (
                  <>
                    {" "}
                    Next one up: <strong>{next.username}</strong>.
                  </>
                ) : (
                  <> You have beaten all five.</>
                )}
              </>
            ) : (
              <>
                No wins yet from {standing.games} game
                {standing.games === 1 ? "" : "s"}. Start with{" "}
                <strong>{next?.username}</strong>.
              </>
            )}
          </p>
        </div>
      )}

      {/* Your rating drops in as a line at its own height, so the number means
          a place on the ladder rather than floating free. */}
      <ol className="ladder">
        {user && standing !== null && rating >= (rungs[0]?.rating ?? 0) && (
          <YouAreHere rating={rating} />
        )}
        {rungs.map((rung, i) => {
          const record = records.get(rung.username);
          const beaten = (record?.wins ?? 0) > 0;
          const below = rungs[i + 1];
          const markerHere =
            user !== null &&
            standing !== null &&
            rating < rung.rating &&
            (below === undefined || rating >= below.rating);

          return (
            <li key={rung.id}>
              <div className={beaten ? "rung beaten" : "rung"}>
                <span className="rung-mark" aria-hidden>
                  {beaten ? "✓" : ""}
                </span>
                <div className="rung-body">
                  <div className="rung-head">
                    <Link href={`/player/${encodeURIComponent(rung.username)}`}>
                      <strong>{rung.username}</strong>
                    </Link>
                    {i === 0 && <span className="tag">hardest</span>}
                    {i === rungs.length - 1 && <span className="tag">easiest</span>}
                    {beaten && <span className="tag tag-turn">beaten</span>}
                    {user && !beaten && next?.username === rung.username && (
                      <span className="tag tag-waiting">next</span>
                    )}
                    <span className="rung-rating">{rung.rating}</span>
                  </div>
                  {rung.description && (
                    <p className="muted rung-desc">{rung.description}</p>
                  )}
                  <p className="hint">
                    {record && record.played > 0
                      ? `Your record: ${record.wins} won, ${record.losses} lost`
                      : user
                        ? "Not played yet."
                        : `Players have won ${rung.losses} and lost ${rung.wins} against it`}
                  </p>
                </div>
                <div className="rung-action">
                  {user ? (
                    <ChallengeEngineButton botId={rung.id} />
                  ) : (
                    <Link href="/" className="btn">
                      Sign in
                    </Link>
                  )}
                </div>
              </div>
              {markerHere && <YouAreHere rating={rating} />}
            </li>
          );
        })}
      </ol>

      <div className="section-head">
        <h2>Rankings</h2>
        {ladder.length > 0 && <span className="count">{ladder.length}</span>}
      </div>
      <p className="muted" style={{ margin: "0 0 12px", lineHeight: 1.6 }}>
        Every player who has finished a game against the computer, best first.
      </p>
      {ladder.length === 0 ? (
        <p className="empty">No one has played the computer yet.</p>
      ) : (
        <div className="panel">
          <table>
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>Player</th>
                <th>Best win</th>
                <th style={{ textAlign: "right" }}>Rating</th>
                <th style={{ textAlign: "right" }}>Games</th>
              </tr>
            </thead>
            <tbody>
              {ladder.map((r, i) => (
                <tr key={r.id} className={r.id === user?.id ? "you" : undefined}>
                  <td className="num" style={{ color: "var(--text-dim)" }}>
                    {i + 1}
                  </td>
                  <td>
                    <Link href={`/player/${encodeURIComponent(r.username)}`}>
                      {r.username}
                    </Link>
                    {r.id === user?.id && (
                      <span className="tag tag-turn" style={{ marginLeft: 8 }}>
                        you
                      </span>
                    )}
                  </td>
                  <td>
                    {r.bestBeaten ? (
                      <Link href={`/player/${encodeURIComponent(r.bestBeaten)}`}>
                        <strong>{r.bestBeaten}</strong>
                      </Link>
                    ) : (
                      <span className="muted">none yet</span>
                    )}
                  </td>
                  <td className="num">{r.rating}</td>
                  <td className="num">{r.games}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** The line on the ladder where the viewer currently stands. */
function YouAreHere({ rating }: { rating: number }) {
  return (
    <div className="ladder-marker">
      <span>you · {rating}</span>
    </div>
  );
}
