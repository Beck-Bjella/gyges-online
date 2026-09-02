import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { botLeaderboard, opponentRecords } from "@/lib/db/queries";
import { BOTS } from "@/lib/bots";
import { engineLadder, engineRatingFor } from "@/lib/ladder";
import ChallengeEngineButton from "@/components/ChallengeEngineButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "The computer · Gygès" };

/**
 * The engine's home.
 *
 * It used to live in a dropdown on the lobby and a row on the leaderboard,
 * which is a strange place to keep the one thing this site has that nothing
 * else does. Here the bots are rungs: strongest at the top, because that is
 * what a ladder looks like and climbing is the point. Each says what it is,
 * what beating it is worth, how you have done against it, and offers a game.
 */
export default async function ComputerPage() {
  const user = await currentUser();
  const bots = botLeaderboard();
  const ladder = engineLadder();
  const standing = user ? engineRatingFor(user.id) : null;

  // Your record against each of them: the column that makes a rung personal
  // rather than a specification.
  const records = new Map(
    user
      ? opponentRecords(user.id)
          .filter((o) => o.isBot)
          .map((o) => [o.username, o] as const)
      : [],
  );

  // Strongest first, by rating — which is the measured order, and not the
  // order of search depth. See lib/bots.ts.
  const rungs = bots
    .map((b) => ({
      ...b,
      rating: BOTS.find((spec) => spec.username === b.username)?.rating ?? 0,
    }))
    .sort((a, b) => b.rating - a.rating);

  const rating = standing?.rating ?? 0;
  /** The weakest rung not yet beaten: the one worth trying next. */
  const next = [...rungs]
    .reverse()
    .find((r) => (records.get(r.username)?.wins ?? 0) === 0);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>The computer</h1>
          <p className="lede" style={{ marginBottom: 0 }}>
            Five strengths of the same engine, each its own account with a fixed
            rating. Yours is what your results against them say it is — and
            beating one far below you moves nothing, so the only way up is to
            beat a better one.
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
                No finished games against the computer yet. Start at the bottom:{" "}
                <strong>{rungs[rungs.length - 1]?.username}</strong> is the one
                to beat first.
              </>
            ) : standing.bestBeaten ? (
              <>
                Best win against <strong>{standing.bestBeaten}</strong>
                {next ? (
                  <>
                    {" · next rung up: "}
                    <strong>{next.username}</strong>
                  </>
                ) : (
                  <> · you have beaten every one of them.</>
                )}
              </>
            ) : (
              <>
                {standing.games} game{standing.games === 1 ? "" : "s"} played,
                none won yet. <strong>{next?.username}</strong> is the rung to
                take first.
              </>
            )}
          </p>
        </div>
      )}

      {/* The ladder. A marker drops in at the height of your rating, so the
          number has somewhere to stand rather than floating free. */}
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
                    <span className="rung-rating">{rung.rating}</span>
                    {beaten && <span className="tag tag-turn">beaten</span>}
                    {user && !beaten && next?.username === rung.username && (
                      <span className="tag tag-waiting">next up</span>
                    )}
                  </div>
                  {rung.description && (
                    <p className="muted rung-desc">{rung.description}</p>
                  )}
                  <p className="hint">
                    {record && record.played > 0
                      ? `You: ${record.wins}W – ${record.losses}L in ${record.played} game${record.played === 1 ? "" : "s"}`
                      : user
                        ? "You have not played this one."
                        : `${rung.wins} won, ${rung.losses} lost against everyone`}
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

      {/*
        Who has climbed it, and the rung leads rather than the number: "beat
        Helios-Sharp" is what someone tells a friend, while 3900 means nothing
        until you know what the rungs are.
      */}
      <div className="section-head">
        <h2>Who has climbed it</h2>
        {ladder.length > 0 && <span className="count">{ladder.length}</span>}
      </div>
      {ladder.length === 0 ? (
        <p className="empty">
          Nobody has finished a game against the computer yet. Be first.
        </p>
      ) : (
        <div className="panel">
          <table>
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>Player</th>
                <th>Highest beaten</th>
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
