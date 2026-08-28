import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import {
  listGamesForUser,
  playerStats,
  timingStats,
  settleExpiredGames,
  sideOf,
  type GameWithPlayers,
} from "@/lib/db/queries";
import { relativeTime, describeThinkTime } from "@/lib/format";

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

  const yourMove = games.filter(
    (g) =>
      (g.status === "active" || g.status === "setup") &&
      sideOf(g, user.id) === g.turn,
  );
  const theirMove = games.filter(
    (g) =>
      (g.status === "active" || g.status === "setup") &&
      sideOf(g, user.id) !== g.turn,
  );
  const waiting = games.filter((g) => g.status === "open");
  const finished = games.filter((g) => g.status === "finished");

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{user.username}</h1>
          <p className="lede" style={{ marginBottom: 0 }}>
            {yourMove.length > 0
              ? `You have ${yourMove.length} game${yourMove.length === 1 ? "" : "s"} waiting on you.`
              : "Nothing is waiting on you right now."}
          </p>
        </div>
        <Link href="/games" className="btn btn-primary">
          Find a game
        </Link>
      </header>

      <div className="statcards">
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
          {yourMove.length > 0 && (
            <>
              <div className="section-head">
                <h2>Your move</h2>
                <span className="count count-mint">{yourMove.length}</span>
              </div>
              <ul className="list">
                {yourMove.map((g) => (
                  <MyGame key={g.id} game={g} userId={user.id} urgent />
                ))}
              </ul>
            </>
          )}

          {theirMove.length > 0 && (
            <>
              <div className="section-head" style={{ marginTop: 30 }}>
                <h2>Waiting on your opponent</h2>
                <span className="count">{theirMove.length}</span>
              </div>
              <ul className="list">
                {theirMove.map((g) => (
                  <MyGame key={g.id} game={g} userId={user.id} />
                ))}
              </ul>
            </>
          )}

          {waiting.length > 0 && (
            <>
              <div className="section-head" style={{ marginTop: 30 }}>
                <h2>Waiting for a challenger</h2>
                <span className="count count-amber">{waiting.length}</span>
              </div>
              <ul className="list">
                {waiting.map((g) => (
                  <MyGame key={g.id} game={g} userId={user.id} />
                ))}
              </ul>
            </>
          )}

          <div className="section-head" style={{ marginTop: 30 }}>
            <h2>Finished</h2>
            {finished.length > 0 && <span className="count">{finished.length}</span>}
          </div>
          {finished.length === 0 ? (
            <p className="empty">
              No finished games yet. <Link href="/games">Find an opponent.</Link>
            </p>
          ) : (
            <ul className="list">
              {finished.map((g) => (
                <MyGame key={g.id} game={g} userId={user.id} />
              ))}
            </ul>
          )}

          {games.length === 0 && (
            <p className="empty" style={{ marginTop: 20 }}>
              You have not played a game yet.{" "}
              <Link href="/games">Host or join one</Link> to get started.
            </p>
          )}
        </section>

        <aside className="rail">
          <div className="panel">
            <h2>Account</h2>
            <p className="muted" style={{ margin: "0 0 14px", lineHeight: 1.6 }}>
              Member since {relativeTime(user.created_at)}.
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

function MyGame({
  game,
  userId,
  urgent = false,
}: {
  game: GameWithPlayers;
  userId: string;
  urgent?: boolean;
}) {
  const side = sideOf(game, userId);
  const opponent = side === 1 ? game.player2_name : game.player1_name;

  let label: string;
  if (game.status === "open") label = "waiting for a challenger";
  else if (game.status === "setup") label = "placing pieces";
  else if (game.status === "finished") {
    label =
      game.result === 0
        ? "drawn"
        : game.result === side
          ? "you won"
          : "you lost";
    if (game.result_reason && game.result_reason !== "goal") {
      label += ` by ${game.result_reason}`;
    }
  } else label = `ply ${game.ply}`;

  return (
    <li className={urgent ? "list-item urgent" : "list-item"}>
      <span className={urgent ? "avatar avatar-mint" : "avatar"}>
        {(opponent ?? "?").charAt(0).toUpperCase()}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <Link href={`/game/${game.id}`}>
          {opponent ? `vs ${opponent}` : "Open game"}
        </Link>
        <br />
        <span className="muted">
          {label} · {relativeTime(game.updated_at)}
        </span>
      </span>
      {urgent && <span className="tag tag-turn">play</span>}
    </li>
  );
}
