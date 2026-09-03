import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { botLeaderboard, opponentRecords } from "@/lib/db/queries";
import { BOTS } from "@/lib/bots";
import { engineRatingFor } from "@/lib/ladder";
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

      <ol className="ladder">
        {rungs.map((rung, i) => {
          const record = records.get(rung.username);
          const beaten = (record?.wins ?? 0) > 0;

          return (
            <li key={rung.id}>
              <div className={beaten ? "rung beaten" : "rung"}>
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
                    /* Stretched over the whole rung: the card IS the play
                       button. The name link stays clickable on top of it. */
                    <ChallengeEngineButton botId={rung.id} stretch />
                  ) : (
                    <Link href="/" className="btn">
                      Sign in
                    </Link>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

    </>
  );
}
