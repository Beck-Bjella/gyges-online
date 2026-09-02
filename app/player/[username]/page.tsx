import Link from "next/link";
import { notFound } from "next/navigation";
import {
  headToHead,
  playerStats,
  finishedGamesForUser,
  listGamesForUser,
  sideOf,
  type Record_,
} from "@/lib/db/queries";
import { relativeTime, endingSuffix } from "@/lib/format";
import { currentUser } from "@/lib/auth";
import RenameForm from "@/components/RenameForm";
import SocialButtons from "@/components/SocialButtons";
import MiniBoard from "@/components/MiniBoard";
import { decodeBoard } from "@/lib/db/queries";
import { friendState, opponentRecords } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default async function PlayerPage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;

  const stats = playerStats(decodeURIComponent(username));
  if (!stats) notFound();

  const { user } = stats;
  const viewer = await currentUser();
  const isMe = viewer?.id === user.id;

  // A closed account keeps its games but shows nothing personal.
  if (user.deleted_at) {
    return (
      <>
        <header className="page-head">
          <div>
            <h1>{user.username}</h1>
            <p className="lede" style={{ marginBottom: 0 }}>
              This account is closed.
            </p>
          </div>
        </header>
      </>
    );
  }

  const finished = finishedGamesForUser(user.id);
  const all = listGamesForUser(user.id);
  const active = all.filter((g) => g.status === "active");
  // Games with an empty seat: public tables and challenges waiting on an
  // answer. Named by whoever the seat is held for, when it is held.
  const waiting = all.filter((g) => g.status === "open");
  const opponents = opponentRecords(user.id);

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
      <header className="page-head">
        <div>
          <h1>{user.username}</h1>
          <p className="lede" style={{ marginBottom: 0 }}>
            Member since {relativeTime(user.created_at)}.
          </p>
        </div>
      </header>

      {isMe && (
        <div className="panel" style={{ marginBottom: 24 }}>
          <h2>Your account</h2>
          <RenameForm current={user.username} />
        </div>
      )}

      {viewer && !isMe && user.bot_strength === null && (
        <SocialButtons userId={user.id} state={friendState(viewer.id, user.id)} />
      )}

      {/* Against people. This is the record — the one the leaderboard ranks. */}
      <div className="statcards" style={{ marginBottom: 26 }}>
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

      {waiting.length > 0 && (
        <>
          <SectionHead title="Waiting" count={waiting.length} accent="amber" />
          <ul className="watch-grid" style={{ marginBottom: 28 }}>
            {waiting.map((g) => (
              <li key={g.id} className="game-card list-item waiting">
                <Link
                  className="stretch-link"
                  href={`/game/${g.id}`}
                  aria-label="Open game"
                />
                <MiniBoard board={decodeBoard(g.board)} lastMove={g.last_move} size={150} />
                <div className="game-card-meta">
                  <div>{g.invited_name ? `vs ${g.invited_name}` : "Open game"}</div>
                  <span className="muted">
                    {g.invited_name ? "challenge sent" : "anyone may join"} ·{" "}
                    {relativeTime(g.created_at)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {active.length > 0 && (
        <>
          <SectionHead title="In progress" count={active.length} accent="mint" />
          <ul className="watch-grid" style={{ marginBottom: 28 }}>
            {active.map((g) => {
              const side = sideOf(g, user.id);
              const opponent = side === 1 ? g.player2_name : g.player1_name;
              return (
                <li key={g.id} className="game-card list-item">
                  <Link
                    className="stretch-link"
                    href={`/game/${g.id}`}
                    aria-label="Open game"
                  />
                  <MiniBoard board={decodeBoard(g.board)} lastMove={g.last_move} size={150} />
                  <div className="game-card-meta">
                    <div>vs {opponent ?? "—"}</div>
                    <span className="muted">
                      move {g.ply} · {relativeTime(g.updated_at)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {opponents.length > 0 && (
        <>
          <SectionHead title="Opponents" count={0} />
          <div className="panel" style={{ marginBottom: 28 }}>
            <table>
              <thead>
                <tr>
                  <th>Opponent</th>
                  <th style={{ textAlign: "right" }}>Won</th>
                  <th style={{ textAlign: "right" }}>Lost</th>
                  <th style={{ textAlign: "right" }}>Drawn</th>
                  <th style={{ textAlign: "right" }}>Played</th>
                  <th style={{ textAlign: "right" }}>Win %</th>
                </tr>
              </thead>
              <tbody>
                {opponents.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/player/${encodeURIComponent(o.username)}`}>
                        {o.username}
                      </Link>
                      {o.isBot ? <span className="muted"> · engine</span> : null}
                    </td>
                    <td className="num">{o.wins}</td>
                    <td className="num">{o.losses}</td>
                    <td className="num">{o.draws}</td>
                    <td className="num">{o.played}</td>
                    <td className="num">
                      {o.played ? `${Math.round((100 * o.wins) / o.played)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <SectionHead title="Completed games" count={finished.length} />
      {finished.length === 0 ? (
        <p className="muted">No completed games yet.</p>
      ) : (
        <ul className="watch-grid">
          {finished.map((g) => {
            const side = sideOf(g, user.id);
            const opponent = side === 1 ? g.player2_name : g.player1_name;
            const outcome =
              g.result === 0 ? "Draw" : g.result === side ? "Won" : "Lost";
            return (
              <li key={g.id} className="game-card list-item">
                <Link
                  className="stretch-link"
                  href={`/game/${g.id}`}
                  aria-label="Open game"
                />
                <MiniBoard board={decodeBoard(g.board)} lastMove={g.last_move} size={150} />
                <div className="game-card-meta">
                  <div>
                    <span
                      className="tag"
                      style={
                        outcome === "Won"
                          ? {
                              borderColor: "var(--accent-mint)",
                              color: "var(--accent-mint)",
                            }
                          : undefined
                      }
                    >
                      {outcome}
                    </span>{" "}
                    vs {opponent ?? "—"}
                  </div>
                  <span className="muted">
                    {g.ply} moves{endingSuffix(g.result_reason, " · by ")} ·{" "}
                    {relativeTime(g.updated_at)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** The same section header the lobby uses: real size, count chip beside. */
function SectionHead({
  title,
  count,
  accent,
}: {
  title: string;
  /** Omitted where a count would say nothing — a table of one thing. */
  count?: number;
  accent?: "mint" | "amber";
}) {
  return (
    <div className="section-head">
      <h2>{title}</h2>
      {count !== undefined && count > 0 && (
        <span className={accent ? `count count-${accent}` : "count"}>{count}</span>
      )}
    </div>
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
