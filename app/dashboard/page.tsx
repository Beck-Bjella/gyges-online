import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import {
  listGamesForUser,
  playerStats,
  timingStats,
  settleExpiredGames,
  sideOf,
  siteVersion,
  type GameWithPlayers,
  listFriends,
  listFriendRequests,
  listIncomingChallenges,
  listOutgoingChallenges,
  openSeatCount,
  MAX_OPEN_GAMES,
} from "@/lib/db/queries";
import FriendsPanel from "@/components/FriendsPanel";
import { relativeTime, describeThinkTime, endingSuffix } from "@/lib/format";
import AutoRefresh from "@/components/AutoRefresh";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard · Gygès" };

/**
 * Your home when signed in: your record, and every game you are part of.
 *
 * Hosting and joining live on /games; this page is about what is already
 * yours.
 */
export default async function DashboardPage() {
  settleExpiredGames();

  const user = await currentUser();
  if (!user) redirect("/");

  const stats = playerStats(user.username)!;
  const timing = timingStats(user.id);
  const games = listGamesForUser(user.id);

  // One list of games in play, ordered so the ones needing you come first.
  // Whose turn it is is shown by colour rather than by splitting the list in
  // two — a game does not change category when your opponent moves.
  const active = games
    .filter((g) => g.status === "active" || g.status === "setup")
    .sort((a, b) => {
      const aYours = sideOf(a, user.id) === a.turn ? 0 : 1;
      const bYours = sideOf(b, user.id) === b.turn ? 0 : 1;
      return aYours - bYours || b.updated_at - a.updated_at;
    });

  const yourMoveCount = active.filter(
    (g) => sideOf(g, user.id) === g.turn,
  ).length;

  const waiting = games.filter((g) => g.status === "open");
  const seats = openSeatCount(user.id);
  const friends = listFriends(user.id).map((u) => ({ id: u.id, username: u.username }));
  const requests = listFriendRequests(user.id).map((u) => ({
    id: u.id,
    username: u.username,
  }));
  const incoming = listIncomingChallenges(user.id).map((g) => ({
    id: g.id,
    name: g.player1_name ?? "someone",
  }));
  const outgoing = listOutgoingChallenges(user.id).map((g) => ({
    id: g.id,
    name: g.invited_name ?? "someone",
  }));
  const finished = games.filter((g) => g.status === "finished");

  return (
    <>
      {/* Your games change when an opponent acts, so this page watches too. */}
      <AutoRefresh version={siteVersion()} />
      <header className="page-head">
        <div>
          <h1>{user.username}</h1>
          <p className="lede" style={{ marginBottom: 0 }}>
            {yourMoveCount > 0
              ? `It is your move in ${yourMoveCount} game${yourMoveCount === 1 ? "" : "s"}.`
              : "Nothing is waiting on you right now."}
          </p>
        </div>
        <Link href="/games" className="btn btn-primary">
          Find a game
        </Link>
      </header>

      <div className="statcards">
        {/* Against people. Games against the engine are on the profile. */}
        <StatCard label="Played" value={stats.played} />
        <StatCard label="Won" value={stats.wins} accent="mint" />
        <StatCard label="Lost" value={stats.losses} />
        <StatCard label="In progress" value={stats.active} accent="amber" />
        <StatCard
          label="Median reply"
          value={describeThinkTime(timing.medianThinkMs)}
        />
      </div>

      <div className="grid-2" style={{ marginTop: 32 }}>
        <section>
          {/*
            Every section is always shown, empty or not. A page whose headings
            appear and disappear depending on state is hard to read: you cannot
            learn where anything lives, and an absent section is
            indistinguishable from a section you have scrolled past.
          */}
          <GameSection
            title="Active games"
            games={active}
            userId={user.id}
            accent={yourMoveCount > 0 ? "mint" : undefined}
            empty={
              <>
                No games in play. <Link href="/games">Find an opponent.</Link>
              </>
            }
          />

          <GameSection
            title="Waiting for opponent"
            games={waiting}
            userId={user.id}
            accent="amber"
            empty={
              <>
                None open. <Link href="/games">Host a game</Link> and see who
                turns up.
              </>
            }
          />

          <GameSection
            title="Complete"
            games={finished}
            userId={user.id}
            empty={
              <>
                No finished games yet. <Link href="/games">Find an opponent.</Link>
              </>
            }
          />
        </section>

        <aside className="rail">
          <FriendsPanel
            requests={requests}
            friends={friends}
            incoming={incoming}
            outgoing={outgoing}
          />

          <div className="panel">
            <h2>Account</h2>
            <p className="muted" style={{ margin: "0 0 14px", lineHeight: 1.6 }}>
              Member since {relativeTime(user.created_at)}. Tables in use:{" "}
              <strong style={seats >= MAX_OPEN_GAMES ? { color: "var(--accent-amber)" } : undefined}>
                {seats}/{MAX_OPEN_GAMES}
              </strong>
              .
            </p>
            <Link
              href={`/player/${encodeURIComponent(user.username)}`}
              className="btn"
            >
              Public profile
            </Link>
          </div>

          <div className="panel">
            <h2>Reply times</h2>
            <dl className="deflist">
              <dt>Actions</dt>
              <dd>{timing.moves}</dd>
              <dt>Fastest</dt>
              <dd>{describeThinkTime(timing.fastestMs)}</dd>
              <dt>Median</dt>
              <dd>{describeThinkTime(timing.medianThinkMs)}</dd>
              <dt>Slowest</dt>
              <dd>{describeThinkTime(timing.slowestMs)}</dd>
            </dl>
          </div>
        </aside>
      </div>
    </>
  );
}

/**
 * One dashboard section: a heading, a count, and either rows or a reason there
 * are none. Always rendered, so the page keeps the same shape as games come
 * and go.
 */
function GameSection({
  title,
  games,
  userId,
  accent,
  empty,
}: {
  title: string;
  games: GameWithPlayers[];
  userId: string;
  accent?: "mint" | "amber";
  empty: React.ReactNode;
}) {
  return (
    <>
      <div className="section-head" style={{ marginTop: 30 }}>
        <h2>{title}</h2>
        <span
          className={
            games.length > 0 && accent ? `count count-${accent}` : "count"
          }
        >
          {games.length}
        </span>
      </div>
      {games.length === 0 ? (
        <p className="empty">{empty}</p>
      ) : (
        <ul className="list">
          {games.map((g) => (
            <MyGame key={g.id} game={g} userId={userId} />
          ))}
        </ul>
      )}
    </>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: "mint" | "amber";
}) {
  return (
    <div className="statcard">
      <div
        className="statvalue"
        style={accent ? { color: `var(--accent-${accent})` } : undefined}
      >
        {value}
      </div>
      <div className="statlabel">{label}</div>
    </div>
  );
}

/**
 * One of your games.
 *
 * The row colours itself by state rather than being told: mint and a "play"
 * tag when it is your move, amber while waiting for a challenger, plain
 * otherwise. That keeps whose-turn-it-is legible without splitting the list.
 */
function MyGame({
  game,
  userId,
}: {
  game: GameWithPlayers;
  userId: string;
}) {
  const side = sideOf(game, userId);
  // On an open challenge nobody sits opposite yet, but everyone knows who
  // will: the reserved seat's name is the honest label.
  const opponent =
    (side === 1 ? game.player2_name : game.player1_name) ?? game.invited_name;

  const inPlay = game.status === "active" || game.status === "setup";
  const yourTurn = inPlay && side === game.turn;
  const open = game.status === "open";

  let label: string;
  if (open) label = game.invited_id ? "waiting for them to accept" : "waiting for an opponent";
  else if (game.status === "setup") {
    label = yourTurn ? "place your pieces" : "opponent is placing";
  } else if (game.status === "finished") {
    label =
      (game.result === 0 ? "drawn" : game.result === side ? "you won" : "you lost") +
      endingSuffix(game.result_reason);
  } else {
    label = yourTurn ? "your move" : "their move";
  }

  const avatarClass = yourTurn
    ? "avatar avatar-mint"
    : open
      ? "avatar avatar-amber"
      : "avatar";

  return (
    <li className={yourTurn ? "list-item urgent" : "list-item"}>
      <span className={avatarClass}>
        {(opponent ?? "?").charAt(0).toUpperCase()}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <Link href={`/game/${game.id}`}>
          {opponent ? `vs ${opponent}` : "Open game"}
        </Link>
        <br />
        <span
          className="muted"
          style={
            yourTurn
              ? { color: "var(--accent-mint)" }
              : open
                ? { color: "var(--accent-amber)" }
                : undefined
          }
        >
          {label} · {relativeTime(game.updated_at)}
        </span>
      </span>
      {yourTurn && <span className="tag tag-turn">play</span>}
    </li>
  );
}
