import Link from "next/link";
import { notFound } from "next/navigation";
import {
  headToHead,
  playerStats,
  finishedGamesForUser,
  listGamesForUser,
  settleExpiredGames,
  sideOf,
  type Record_,
} from "@/lib/db/queries";
import { relativeTime, endingSuffix } from "@/lib/format";
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

  // The viewer's own record against this player. Only worth a panel when
  // there is one — most profiles a player looks at are strangers.
  const h2h = viewer && !isMe ? headToHead(viewer.id, user.id) : null;

  // Current streak, walked off the finished games already fetched: how many
  // of the most recent ended the same way. Decided in code rather than SQL
  // because "same way in a row" is awkward in a query and 25 rows is nothing.
  let streak = 0;
  let streakKind: "won" | "lost" | null = null;
  for (const g of finished) {
    if (g.result === 0) break;
    const kind = g.result === sideOf(g, user.id) ? "won" : "lost";
    if (streakKind === null) streakKind = kind;
    if (kind !== streakKind) break;
    streak++;
  }

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

      {/* Against people. This is the record — the one the leaderboard ranks. */}
      <div className="statcards" style={{ marginBottom: stats.vsBots.played ? 14 : 26 }}>
        <Stat label="Played" value={stats.played} />
        <Stat label="Won" value={stats.wins} accent="var(--accent-mint)" />
        <Stat label="Lost" value={stats.losses} />
        <Stat label="Drawn" value={stats.draws} />
        <Stat label="In progress" value={stats.active} accent="var(--accent-amber)" />
        {stats.played > 0 && (
          <Stat
            label="Win rate"
            value={`${Math.round((100 * stats.wins) / stats.played)}%`}
          />
        )}
        {streak >= 2 && (
          <Stat
            label="Streak"
            value={`${streak} ${streakKind}`}
            accent={streakKind === "won" ? "var(--accent-mint)" : undefined}
          />
        )}
      </div>

      {/* The same record split by seat. Player 1 places first, so their
          opponent arranges knowing their row — whether that matters is what
          this lets a player see about their own games. */}
      {stats.asP1.played > 0 && stats.asP2.played > 0 && (
        <p className="hint" style={{ margin: "0 0 26px" }}>
          As player 1: {recordLine(stats.asP1)} · as player 2:{" "}
          {recordLine(stats.asP2)}
        </p>
      )}

      {h2h && h2h.played > 0 && (
        <div className="panel" style={{ marginBottom: 26 }}>
          <h2>You against {user.username}</h2>
          <p style={{ margin: 0 }}>
            {recordLine(h2h)} across {h2h.played} game{h2h.played === 1 ? "" : "s"}.
          </p>
        </div>
      )}

      {/* Against the engine, kept apart rather than hidden. A bot plays a fixed
          published strength and will play a thousand games, so these numbers
          say something different — worth showing, not worth ranking. */}
      {stats.vsBots.played > 0 && (
        <>
          <p className="hint" style={{ margin: "0 0 8px" }}>
            Against the engine — not counted in the record above or on the
            leaderboard.
          </p>
          <div className="statcards" style={{ marginBottom: 26 }}>
            <Stat label="Played" value={stats.vsBots.played} />
            <Stat label="Won" value={stats.vsBots.wins} accent="var(--accent-mint)" />
            <Stat label="Lost" value={stats.vsBots.losses} />
            <Stat label="Drawn" value={stats.vsBots.draws} />
          </div>
        </>
      )}

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
                    {endingSuffix(g.result_reason, " · by ")}
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

/** A compact "3W – 1L – 2D" line for a record. */
function recordLine(r: Record_): string {
  return `${r.wins}W – ${r.losses}L${r.draws ? ` – ${r.draws}D` : ""}`;
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: string;
}) {
  return (
    <div className="statcard">
      <div className="statvalue" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      <div className="statlabel">{label}</div>
    </div>
  );
}
