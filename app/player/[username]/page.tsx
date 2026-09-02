import Link from "next/link";
import { notFound } from "next/navigation";
import {
  headToHead,
  playerStats,
  finishedGamesForUser,
  sideOf,
  emailFor,
  openSeatCount,
  MAX_OPEN_GAMES,
  type Record_,
} from "@/lib/db/queries";
import { relativeTime } from "@/lib/format";
import { currentUser } from "@/lib/auth";
import RenameForm from "@/components/RenameForm";
import EmailForm from "@/components/EmailForm";
import ChangePasswordForm from "@/components/ChangePasswordForm";
import ChallengeEngineButton from "@/components/ChallengeEngineButton";
import SignOutButton from "@/components/SignOutButton";
import SocialButtons from "@/components/SocialButtons";
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
  const isBot = user.bot_strength !== null;

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

  // Read for the streak below, not for a list — see the note before the
  // opponents table.
  const finished = finishedGamesForUser(user.id);
  const opponents = opponentRecords(user.id);
  // Only meaningful on your own profile, where the account panel prints it.
  const seats = isMe ? openSeatCount(user.id) : 0;

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
            {isBot
              ? (user.bot_description ??
                "One of the strengths the computer plays at.")
              : `Member since ${relativeTime(user.created_at)}.`}
          </p>
        </div>
        {/* The lobby links every computer's name here, so the answer to "what
            am I about to play" has to be here, and so does the way to play
            it. */}
        {isBot && viewer && <ChallengeEngineButton botId={user.id} />}
      </header>

      {/*
        Your own profile doubles as your account page. The public half is what
        everyone sees; this panel is the half only you get, and it is here
        rather than on the dashboard because "who I am" and "what is waiting
        for me" are different questions.
      */}
      {isMe && (
        <div className="panel account-panel">
          <div className="section-head">
            <h2>Your account</h2>
          </div>

          <div className="account-field">
            <span className="account-label">Username</span>
            <RenameForm current={user.username} />
          </div>

          <EmailForm current={emailFor(user.id)} />

          <ChangePasswordForm />

          <div className="account-field">
            <span className="account-label">This account</span>
            <p style={{ margin: "0 0 14px", fontSize: 15 }}>
              Tables in use:{" "}
              <strong
                style={{
                  color:
                    seats >= MAX_OPEN_GAMES
                      ? "var(--accent-amber)"
                      : "var(--accent-mint)",
                }}
              >
                {seats}/{MAX_OPEN_GAMES}
              </strong>
            </p>
            <SignOutButton />
          </div>
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

      {/*
        No game lists here. A profile answers "how does this person play" —
        their record, their form, who they have played. Which games are in
        progress is a different question, and it is the dashboard's: yours are
        there, waiting on you, and a list of someone else's games in progress
        was never something anyone came here to read.
      */}
      {opponents.length > 0 && (
        <>
          <div className="section-head">
            <h2>Opponents</h2>
          </div>
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
                      {o.isBot ? <span className="muted"> · computer</span> : null}
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
