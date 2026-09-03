import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import {
  listGamesForUser,
  playerStats,
  sideOf,
  type GameWithPlayers,
  listFriends,
  listFriendRequests,
  listIncomingChallenges,
  listOutgoingChallenges,
  dashboardVersion,
} from "@/lib/db/queries";
import { now } from "@/lib/db/index";
import FriendsPanel from "@/components/FriendsPanel";
import ChallengesPanel from "@/components/ChallengesPanel";
import CancelGameButton from "@/components/CancelGameButton";
import MiniBoard from "@/components/MiniBoard";
import { decodeBoard } from "@/lib/db/queries";
import { relativeTime, endingSuffix } from "@/lib/format";
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

  const user = await currentUser();
  if (!user) redirect("/");

  const stats = playerStats(user.username)!;
  const games = listGamesForUser(user.id);

  // One list of games, ordered so the ones needing you come first, then play
  // in progress, then open tables with nothing to do but wait. A game does not
  // change section when your opponent moves, joins, or was never there — the
  // row's colour and label carry the state instead.
  //
  // Outgoing challenges are open games too, but they render under Challenges
  // with the incoming ones; only public tables belong here.
  const active = games
    .filter(
      (g) =>
        g.status === "active" ||
        g.status === "setup" ||
        (g.status === "open" && !g.invited_id),
    )
    .sort((a, b) => {
      const rank = (g: GameWithPlayers) =>
        g.status === "open" ? 2 : sideOf(g, user.id) === g.turn ? 0 : 1;
      return rank(a) - rank(b) || b.updated_at - a.updated_at;
    });

  const yourMoveCount = active.filter(
    (g) => sideOf(g, user.id) === g.turn,
  ).length;

  const friends = listFriends(user.id).map((u) => ({ id: u.id, username: u.username }));
  const requests = listFriendRequests(user.id).map((u) => ({
    id: u.id,
    username: u.username,
  }));
  const incoming = listIncomingChallenges(user.id).map((g) => ({
    id: g.id,
    name: g.player1_name ?? "someone",
    at: g.updated_at,
  }));
  const outgoing = listOutgoingChallenges(user.id).map((g) => ({
    id: g.id,
    name: g.invited_name ?? "someone",
    at: g.updated_at,
  }));

  const finished = games.filter((g) => g.status === "finished");

  return (
    <>
      {/* Your games change when an opponent acts, so this page watches too. */}
      {/* The site version only watches games; a dashboard also changes when
          a friend request or challenge lands, so it polls its own probe. */}
      <AutoRefresh url="/api/me/version" version={dashboardVersion(user.id)} />
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
        <StatCard
          label="Win rate"
          value={stats.played ? `${Math.round((100 * stats.wins) / stats.played)}%` : "—"}
        />
        <StatCard label="In progress" value={stats.active} accent="amber" />
      </div>

      {/*
        Every section is always shown, empty or not. A page whose headings
        appear and disappear depending on state is hard to read: you cannot
        learn where anything lives, and an absent section is indistinguishable
        from a section you have scrolled past.
      */}
      <div style={{ marginTop: 32 }}>
        <ChallengesPanel incoming={incoming} outgoing={outgoing} />

        <GameSection
          title="Games in progress"
          games={active}
          userId={user.id}
          accent={yourMoveCount > 0 ? "mint" : undefined}
          empty={
            <>
              No games in play. <Link href="/games">Find an opponent.</Link>
            </>
          }
        />

        {/*
          The archive, and it reads like one: rows, not board tiles. A finished
          game and a game waiting on your move were drawing the same 150px
          square, which gave the two the same weight on a page that exists to
          tell you what needs doing.
        */}
        <div className="section-head">
          <h2>Completed games</h2>
          {finished.length > 0 && <span className="count">{finished.length}</span>}
        </div>
        {finished.length === 0 ? (
          <p className="empty">
            No finished games yet. <Link href="/games">Find an opponent.</Link>
          </p>
        ) : (
          <>
            <ul className="list">
              {finished.slice(0, RECENT_FINISHED).map((g) => (
                <FinishedGame key={g.id} game={g} userId={user.id} />
              ))}
            </ul>
            {finished.length > RECENT_FINISHED && (
              <p className="hint" style={{ marginTop: 10 }}>
                Your {RECENT_FINISHED} most recent, of {finished.length}.
              </p>
            )}
          </>
        )}

        <div style={{ marginTop: 34 }}>
          <FriendsPanel requests={requests} friends={friends} />
        </div>
      </div>
    </>
  );
}

/**
 * How many finished games the dashboard lists.
 *
 * The archive is not why anyone opens this page, and an unbounded list of it
 * pushes everything else off the screen for a player with a long history.
 */
const RECENT_FINISHED = 10;

/**
 * A finished game, as a row.
 *
 * Deliberately not the tile the live games get: the position of a game that
 * ended is worth a click, not a square of the page.
 */
function FinishedGame({
  game,
  userId,
}: {
  game: GameWithPlayers;
  userId: string;
}) {
  const side = sideOf(game, userId);
  const opponent = side === 1 ? game.player2_name : game.player1_name;
  const outcome =
    game.result === 0 ? "Draw" : game.result === side ? "Won" : "Lost";

  return (
    <li className="list-item">
      <Link className="stretch-link" href={`/game/${game.id}`} aria-label="Open game" />
      <span className={outcome === "Won" ? "tag tag-turn" : "tag"}>{outcome}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        vs{" "}
        {opponent ? (
          <Link href={`/player/${encodeURIComponent(opponent)}`}>
            <strong>{opponent}</strong>
          </Link>
        ) : (
          "—"
        )}
      </span>
      <span className="muted">
        {game.ply} moves{endingSuffix(game.result_reason, " · by ")} ·{" "}
        {relativeTime(game.updated_at)}
      </span>
    </li>
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
      <div className="section-head">
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
        <ul className="watch-grid">
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
  // A takeback offered to you reads as your turn: there is a decision waiting
  // on this game and it is yours, even though the game is over unless you say
  // otherwise.
  const takebackForYou =
    game.status === "finished" && game.takeback_offered === 1 && side !== game.result;
  // A draw offered to you is the same kind of thing: the game is waiting on an
  // answer from you, whoever's move it is.
  const drawForYou =
    game.status === "active" &&
    game.draw_offered_by !== null &&
    game.draw_offered_by !== side;
  // Their clock has run out and the win is sitting there. It needs a click,
  // which made it exactly the kind of game that must not look like one of the
  // games where there is nothing to do.
  const claimable =
    game.status === "active" &&
    side !== game.turn &&
    game.deadline_at !== null &&
    game.deadline_at <= now();
  const yourTurn =
    (inPlay && side === game.turn) || takebackForYou || drawForYou || claimable;
  const open = game.status === "open";

  // Two states cover everything unfinished: it is your turn, or you are
  // waiting. The distinctions underneath — placing, moving, joining — are
  // visible the moment the game is opened, and the list reads faster without
  // them.
  // Whenever the person being waited on has a name, the label uses it — the
  // generic "opponent" is only for a public table nobody has claimed yet.
  const waitingOn = opponent ?? game.invited_name;
  const waitingLabel = waitingOn ? `waiting for ${waitingOn}` : "waiting for opponent";

  let label: string;
  if (claimable) label = "their time is up — claim the win";
  else if (drawForYou) label = "draw offered — your call";
  else if (open) label = waitingLabel;
  else if (game.status === "setup") {
    label = yourTurn ? "your turn" : waitingLabel;
  } else if (game.status === "finished") {
    label = takebackForYou
      ? "takeback offered — your call"
      : (game.result === 0 ? "drawn" : game.result === side ? "you won" : "you lost") +
        endingSuffix(game.result_reason) +
        (game.takeback_offered === 1 ? " · takeback offered" : "");
  } else {
    label = yourTurn ? "your turn" : waitingLabel;
  }

  return (
    <li
      className={
        yourTurn
          ? "game-card list-item urgent"
          : open
            ? "game-card list-item waiting"
            : "game-card list-item"
      }
    >
      <Link
        className="stretch-link"
        href={`/game/${game.id}`}
        aria-label="Open game"
      />
      <MiniBoard board={decodeBoard(game.board)} lastMove={game.last_move} size={150} />
      <div className="game-card-meta">
        <div>
          {opponent ? (
            <>
              vs{" "}
              <Link href={`/player/${encodeURIComponent(opponent)}`}>
                <strong>{opponent}</strong>
              </Link>
            </>
          ) : (
            "Open game"
          )}
        </div>
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
      </div>
      {yourTurn && (
        <span className="tag tag-turn">{claimable ? "claim" : "play"}</span>
      )}
      {open && <CancelGameButton gameId={game.id} />}
    </li>
  );
}
