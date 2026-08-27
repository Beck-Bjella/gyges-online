import { leaderboard, settleExpiredGames } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default function LeaderboardPage() {
  settleExpiredGames();
  const rows = leaderboard();

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
                  <td>{r.username}</td>
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
    </>
  );
}
