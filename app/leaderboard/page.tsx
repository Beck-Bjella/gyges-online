import Link from "next/link";
import { botLeaderboard, leaderboard, settleExpiredGames } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default function LeaderboardPage() {
  settleExpiredGames();
  const rows = leaderboard();
  const bots = botLeaderboard();

  return (
    <>
      <h1>Leaderboard</h1>
      <p className="lede">
        Finished games only. Ratings will arrive once move validation does —
        ranking players is not meaningful while illegal moves are accepted.
      </p>

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
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td className="num" style={{ color: "var(--text-dim)" }}>
                    {i + 1}
                  </td>
                  <td>
                    <Link href={`/player/${encodeURIComponent(r.username)}`}>
                      {r.username}
                    </Link>
                  </td>
                  <td className="num">{r.wins}</td>
                  <td className="num">{r.losses}</td>
                  <td className="num">{r.draws}</td>
                  <td className="num">{r.played}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {bots.length > 0 && (
        <>
          <h2 style={{ marginTop: 32 }}>The engine</h2>
          <p className="lede">
            Each strength is its own account, and plays by the same rules as
            anyone else. Click one to see its games.
          </p>
          <div className="panel">
            <table>
              <thead>
                <tr>
                  <th>Bot</th>
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
        </>
      )}
    </>
  );
}
