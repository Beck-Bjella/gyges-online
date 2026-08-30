import Link from "next/link";
import { currentUser } from "@/lib/auth";
import {
  botLeaderboard,
  listActiveGames,
  listOpenGames,
  listRecentFinishedGames,
  settleExpiredGames,
  siteVersion,
  type GameWithPlayers,
} from "@/lib/db/queries";
import { relativeTime, describeTimeControl, endingSuffix } from "@/lib/format";
import NewGameForm from "@/components/NewGameForm";
import NewBotGameForm from "@/components/NewBotGameForm";
import AutoRefresh from "@/components/AutoRefresh";
import JoinGameButton from "@/components/JoinGameButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Games · Gygès" };

/**
 * The lobby: host a game, join one, or watch.
 *
 * Deliberately the same page signed in or out. A visitor sees everything a
 * member does except the controls that require an account, so the site is
 * worth looking at before signing up.
 */
export default async function GamesPage() {
  settleExpiredGames();

  const user = await currentUser();
  const openGames = listOpenGames();
  const activeGames = listActiveGames();
  const recentGames = listRecentFinishedGames();
  // Rendered with this version; the poll refreshes the page when it changes,
  // so a game someone else creates or joins appears here on its own.
  const version = siteVersion();

  // The engine's accounts, as choosable opponents. The work budget is pulled
  // out of the stored UGI options only so the form can estimate a wait; the
  // site does not otherwise interpret them.
  const botOptions = botLeaderboard().map((b) => {
    let maxNodes: number | null = null;
    let skill: number | null = null;
    try {
      const parsed = JSON.parse(b.options ?? "{}") as Record<string, unknown>;
      if (typeof parsed.maxNodes === "number") maxNodes = parsed.maxNodes;
      if (typeof parsed.skill === "number") skill = parsed.skill;
    } catch {
      /* a malformed row simply shows no dials */
    }
    return {
      id: b.id,
      username: b.username,
      description: b.description,
      maxNodes,
      skill,
    };
  });

  return (
    <>
      <AutoRefresh version={version} />
      <header className="page-head">
        <div>
          <h1>Games</h1>
          <p className="lede" style={{ marginBottom: 0 }}>
            Host a game and wait for a challenger, or join one that is already
            waiting. Games in progress are open to watch.
          </p>
        </div>
      </header>

      <div className="grid-2">
        <section>
          <SectionHead
            title="Waiting for a player"
            count={openGames.length}
            accent="amber"
          />
          {openGames.length === 0 ? (
            <Empty>
              Nobody is waiting right now.{" "}
              {user ? "Host one and see who turns up." : "Sign in to host one."}
            </Empty>
          ) : (
            <ul className="list">
              {openGames.map((g) => (
                <li key={g.id} className="list-item">
                  <span className="avatar avatar-amber">
                    {initial(g.player1_name)}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <strong>{g.player1_name ?? "—"}</strong>
                    <span className="muted">
                      {" "}
                      · {describeTimeControl(g.move_seconds)}
                    </span>
                    <br />
                    <span className="muted">
                      opened {relativeTime(g.created_at)}
                    </span>
                  </span>
                  {!user ? (
                    <span className="muted">sign in to join</span>
                  ) : g.player1_id === user.id ? (
                    <span className="tag tag-turn">yours</span>
                  ) : (
                    <JoinGameButton gameId={g.id} />
                  )}
                </li>
              ))}
            </ul>
          )}

          <SectionHead
            title="In progress"
            count={activeGames.length}
            accent="mint"
            style={{ marginTop: 34 }}
          />
          {activeGames.length === 0 ? (
            <Empty>No games are being played right now.</Empty>
          ) : (
            <ul className="list">
              {activeGames.map((g) => (
                <GameLine
                  key={g.id}
                  game={g}
                  kind="active"
                  yours={
                    user
                      ? g.player1_id === user.id || g.player2_id === user.id
                      : false
                  }
                />
              ))}
            </ul>
          )}

          <SectionHead
            title="Recently finished"
            count={recentGames.length}
            style={{ marginTop: 34 }}
          />
          {recentGames.length === 0 ? (
            <Empty>No games have finished yet.</Empty>
          ) : (
            <ul className="list">
              {recentGames.map((g) => (
                <GameLine
                  key={g.id}
                  game={g}
                  kind="finished"
                  yours={
                    user
                      ? g.player1_id === user.id || g.player2_id === user.id
                      : false
                  }
                />
              ))}
            </ul>
          )}
        </section>

        <aside className="rail">
          {user ? (
            <>
              <NewGameForm />
              <NewBotGameForm bots={botOptions} />
            </>
          ) : (
            <div className="panel">
              <h2>Want to play?</h2>
              <p className="muted" style={{ margin: "0 0 14px", lineHeight: 1.6 }}>
                Pick a name and you can host or join a game. Games are
                correspondence-style, so you take your turn whenever suits you.
              </p>
              <Link href="/" className="btn btn-primary">
                Get started
              </Link>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

function SectionHead({
  title,
  count,
  accent,
  style,
}: {
  title: string;
  count: number;
  accent?: "mint" | "amber";
  style?: React.CSSProperties;
}) {
  return (
    <div className="section-head" style={style}>
      <h2>{title}</h2>
      {count > 0 && (
        <span className={accent ? `count count-${accent}` : "count"}>{count}</span>
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="empty">{children}</p>;
}

function initial(name: string | null): string {
  return (name ?? "?").charAt(0).toUpperCase();
}

function GameLine({
  game,
  kind,
  yours,
}: {
  game: GameWithPlayers;
  kind: "active" | "finished";
  /** Marked rather than hidden, so the list means the same thing to everyone. */
  yours: boolean;
}) {
  const winner =
    game.result === 0 ? null : game.result === 1 ? game.player1_name : game.player2_name;

  return (
    <li className="list-item">
      <span className={kind === "active" ? "avatar avatar-mint" : "avatar"}>
        {kind === "active" ? game.ply : "✓"}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <Link href={`/game/${game.id}`}>
          <strong>{game.player1_name ?? "—"}</strong>
          <span className="muted"> vs </span>
          <strong>{game.player2_name ?? "—"}</strong>
        </Link>
        {yours && <span className="tag tag-turn" style={{ marginLeft: 8 }}>yours</span>}
        <br />
        <span className="muted">
          {kind === "active"
            ? `${game.status === "setup" ? "placing pieces" : `${game.turn === 1 ? game.player1_name : game.player2_name} to move`} · ${relativeTime(game.updated_at)}`
            : `${winner ? `${winner} won` : "drawn"}${endingSuffix(
                game.result_reason,
              )} · ${game.ply} plies`}
        </span>
      </span>
    </li>
  );
}
