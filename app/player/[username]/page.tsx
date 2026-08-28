import Link from "next/link";
import { notFound } from "next/navigation";
import {
  playerStats,
  finishedGamesForUser,
  listGamesForUser,
  settleExpiredGames,
  sideOf,
} from "@/lib/db/queries";
import { relativeTime } from "@/lib/format";
import { currentUser } from "@/lib/auth";
import RenameForm from "@/components/RenameForm";

export const dynamic = "force-dynamic";

export default async function PlayerPage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  settleExpiredGames();

  const stats = playerStats(decodeURIComponent(username));
  if (!stats) notFound();

  const { user } = stats;
  const viewer = await currentUser();
  const isMe = viewer?.id === user.id;

  // A closed account keeps its games but shows nothing personal.
  if (user.deleted_at) {
    return (
      <>
        <h1>{user.username}</h1>
        <p className="lede">This account is closed.</p>
      </>
    );
  }

  const finished = finishedGamesForUser(user.id);
  const active = listGamesForUser(user.id).filter((g) => g.status === "active");

  return (
    <>
      <h1>{user.username}</h1>
      <p className="lede">
        Member since {relativeTime(user.created_at)}.
      </p>

      {isMe && (
        <div className="panel" style={{ marginBottom: 24 }}>
          <h2>Your account</h2>
          <RenameForm current={user.username} />
        </div>
      )}

      <div className="panel" style={{ marginBottom: 24 }}>
        <div className="statrow">
          <Stat label="Played" value={stats.played} />
          <Stat label="Won" value={stats.wins} accent="var(--accent-mint)" />
          <Stat label="Lost" value={stats.losses} />
          <Stat label="Drawn" value={stats.draws} />
          <Stat label="In progress" value={stats.active} accent="var(--accent-amber)" />
        </div>
      </div>

      {active.length > 0 && (
        <>
          <h2>In progress</h2>
          <ul className="list" style={{ marginBottom: 28 }}>
            {active.map((g) => {
              const side = sideOf(g, user.id);
              const opponent = side === 1 ? g.player2_name : g.player1_name;
              return (
                <li key={g.id} className="list-item">
                  <span style={{ flex: 1 }}>
                    <Link href={`/game/${g.id}`}>vs {opponent ?? "—"}</Link>
                    <span className="muted"> · move {g.ply}</span>
                  </span>
                  <span className="muted">{relativeTime(g.updated_at)}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <h2>Finished games</h2>
      {finished.length === 0 ? (
        <p className="muted">No finished games yet.</p>
      ) : (
        <ul className="list">
          {finished.map((g) => {
            const side = sideOf(g, user.id);
            const opponent = side === 1 ? g.player2_name : g.player1_name;
            const outcome =
              g.result === 0 ? "Draw" : g.result === side ? "Won" : "Lost";
            return (
              <li key={g.id} className="list-item">
                <span
                  className="tag"
                  style={
                    outcome === "Won"
                      ? { borderColor: "var(--accent-mint)", color: "var(--accent-mint)" }
                      : undefined
                  }
                >
                  {outcome}
                </span>
                <span style={{ flex: 1 }}>
                  <Link href={`/game/${g.id}`}>vs {opponent ?? "—"}</Link>
                  <span className="muted">
                    {" "}
                    · {g.ply} moves
                    {g.result_reason && g.result_reason !== "goal"
                      ? ` · by ${g.result_reason}`
                      : ""}
                  </span>
                </span>
                <span className="muted">{relativeTime(g.updated_at)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <div>
      <div className="statvalue" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      <div className="statlabel">{label}</div>
    </div>
  );
}
