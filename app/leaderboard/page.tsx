import Link from "next/link";
import { botLeaderboard, leaderboard } from "@/lib/db/queries";
import { currentUser } from "@/lib/auth";
import { engineLadder } from "@/lib/ladder";
import { BOTS } from "@/lib/bots";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const rows = leaderboard();
  const bots = botLeaderboard();
  const ladder = engineLadder();
  // A ranking you cannot find yourself in is doing half its job.
  const viewer = await currentUser();

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Leaderboard</h1>
          <p className="lede" style={{ marginBottom: 0 }}>
            Finished games between people. Games against the computer are not
            counted here — they appear on each player&apos;s profile instead.
          </p>
        </div>
      </header>

      <div className="section-head">
        <h2>Players</h2>
        {rows.length > 0 && <span className="count">{rows.length}</span>}
      </div>

      {rows.length === 0 ? (
        <p className="muted">No finished games yet.</p>
      ) : (
        <div className="panel">
          <table>
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>Player</th>
                <th style={{ textAlign: "right" }}>Won</th>
                <th style={{ textAlign: "right" }}>Lost</th>
                <th style={{ textAlign: "right" }}>Drawn</th>
                <th style={{ textAlign: "right" }}>Played</th>
                <th style={{ textAlign: "right" }}>Win %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className={r.id === viewer?.id ? "you" : undefined}>
                  <td className="num" style={{ color: "var(--text-dim)" }}>
                    {i + 1}
                  </td>
                  <td>
                    <Link href={`/player/${encodeURIComponent(r.username)}`}>
                      {r.username}
                    </Link>
                    {r.id === viewer?.id && (
                      <span className="tag tag-turn" style={{ marginLeft: 8 }}>
                        you
                      </span>
                    )}
                  </td>
                  <td className="num">{r.wins}</td>
                  <td className="num">{r.losses}</td>
                  <td className="num">{r.draws}</td>
                  <td className="num">{r.played}</td>
                  <td className="num">
                    {r.played ? `${Math.round((100 * r.wins) / r.played)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {bots.length > 0 && (
        <>
          <div className="section-head">
            <h2>The computer</h2>
            <span className="count">{bots.length}</span>
          </div>
          <p className="lede">
            Each strength is its own account with a fixed rating, and plays by
            the same rules as anyone else. Beating one is worth what its rating
            says it is.
          </p>
          <div className="panel">
            <table>
              <thead>
                <tr>
                  <th>Bot</th>
                  <th style={{ textAlign: "right" }}>Rating</th>
                  <th style={{ textAlign: "right" }}>Strength</th>
                  <th style={{ textAlign: "right" }}>Won</th>
                  <th style={{ textAlign: "right" }}>Lost</th>
                  <th style={{ textAlign: "right" }}>Drawn</th>
                  <th style={{ textAlign: "right" }}>Played</th>
                </tr>
              </thead>
              <tbody>
                {bots.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <Link href={`/player/${encodeURIComponent(b.username)}`}>
                        {b.username}
                      </Link>
                      {b.description && (
                        <div className="muted" style={{ fontSize: "0.85em" }}>
                          {b.description}
                        </div>
                      )}
                    </td>
                    <td className="num">
                      {BOTS.find((spec) => spec.username === b.username)?.rating ?? "—"}
                    </td>
                    <td className="num">{b.strength}</td>
                    <td className="num">{b.wins}</td>
                    <td className="num">{b.losses}</td>
                    <td className="num">{b.draws}</td>
                    <td className="num">{b.played}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

      {/*
            The ladder. Against people a rating needs a pool, and there is not one
            yet; against the bots it does not, because they never change — so this
            is the one ranking on the site that means something on day one.
          */}
          <div className="section-head">
            <h2>Who has climbed it</h2>
            {ladder.length > 0 && <span className="count">{ladder.length}</span>}
          </div>
          <p className="lede">
            Everyone starts at nothing and climbs. Each bot has a fixed rating, and
            yours is what your results against them say it is — but beating one far
            below you moves nothing, so the only way up is to beat a better one.
          </p>
          {ladder.length === 0 ? (
            <p className="empty">
              Nobody has finished a game against the computer yet.{" "}
              <Link href="/games">Take one on.</Link>
            </p>
          ) : (
            <div className="panel" style={{ marginBottom: 34 }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>#</th>
                    <th>Player</th>
                    <th style={{ textAlign: "right" }}>Rating</th>
                    <th>Best beaten</th>
                    <th style={{ textAlign: "right" }}>Games</th>
                  </tr>
                </thead>
                <tbody>
                  {ladder.map((r, i) => (
                    <tr key={r.id} className={r.id === viewer?.id ? "you" : undefined}>
                      <td className="num" style={{ color: "var(--text-dim)" }}>
                        {i + 1}
                      </td>
                      <td>
                        <Link href={`/player/${encodeURIComponent(r.username)}`}>
                          {r.username}
                        </Link>
                        {r.id === viewer?.id && (
                          <span className="tag tag-turn" style={{ marginLeft: 8 }}>
                            you
                          </span>
                        )}
                      </td>
                      <td className="num">{r.rating}</td>
                      <td>
                        {r.bestBeaten ? (
                          <Link href={`/player/${encodeURIComponent(r.bestBeaten)}`}>
                            {r.bestBeaten}
                          </Link>
                        ) : (
                          <span className="muted">none yet</span>
                        )}
                      </td>
                      <td className="num">{r.games}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
