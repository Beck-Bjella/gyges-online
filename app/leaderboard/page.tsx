import Link from "next/link";
import { leaderboard } from "@/lib/db/queries";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Leaderboard · Gygès" };

export default async function LeaderboardPage() {
  const rows = leaderboard();
  // A ranking you cannot find yourself in is doing half its job.
  const viewer = await currentUser();

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Leaderboard</h1>
          <p className="lede" style={{ marginBottom: 0 }}>
            Finished games between people.
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

    </>
  );
}
