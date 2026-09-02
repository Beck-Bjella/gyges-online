import Link from "next/link";
import { currentUser } from "@/lib/auth";
import {
  botLeaderboard,
  listActiveGames,
  listOpenGames,
  listRecentFinishedGames,
  siteVersion,
  type GameWithPlayers,
} from "@/lib/db/queries";
import { relativeTime, describeTimeControl, endingSuffix } from "@/lib/format";
import NewGameForm from "@/components/NewGameForm";
import Tabs from "@/components/Tabs";
import ChallengeEngineButton from "@/components/ChallengeEngineButton";
import AutoRefresh from "@/components/AutoRefresh";
import ChatPanel from "@/components/ChatPanel";
import JoinGameButton from "@/components/JoinGameButton";
import MiniBoard from "@/components/MiniBoard";
import { decodeBoard } from "@/lib/db/queries";

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

  const user = await currentUser();
  const openGames = listOpenGames();
  const activeGames = listActiveGames();
  const recentGames = listRecentFinishedGames();
  // Rendered with this version; the poll refreshes the page when it changes,
  // so a game someone else creates or joins appears here on its own.
  const version = siteVersion();

  // The engine's accounts, shown as rows to challenge — the same table the
  // leaderboard prints, plus a button. No opponent-picker form: the row
  // already says who the bot is and how it has done.
  const bots = botLeaderboard();

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

      <section>
        {/* Two tabs: starting a game, and looking at games. Finding an
            opponent — a person or the computer — is one activity; spectating
            is another; mixing them made the page a scroll of everything. */}
          <Tabs
            tabs={[
              {
                label: "Play",
                content: (
                  <>
          {user ? (
            <NewGameForm />
          ) : (
            <div className="panel host-panel">
              <div className="host-copy">
                <h2>Want to play?</h2>
                <p className="muted">
                  Pick a name and you can host or join a game. Games are
                  correspondence-style, so you take your turn whenever suits
                  you.
                </p>
              </div>
              <Link href="/" className="btn btn-primary">
                Get started
              </Link>
            </div>
          )}

          <SectionHead title="Play the computer" />
          <p className="muted" style={{ margin: "0 0 12px", lineHeight: 1.6 }}>
            Each strength is its own account and plays by the same rules as
            anyone else. The game runs in your browser, and the computer waits
            as long as you do.
          </p>
          <div className="panel">
            <table>
              <thead>
                <tr>
                  <th>Bot</th>
                  <th style={{ textAlign: "right" }}>Won</th>
                  <th style={{ textAlign: "right" }}>Lost</th>
                  <th style={{ width: 1 }} />
                </tr>
              </thead>
              <tbody>
                {bots.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <Link href={`/player/${encodeURIComponent(b.username)}`}>
                        {b.username}
                      </Link>
                      {b.description && (
                        <div className="muted" style={{ fontSize: "0.85em" }}>
                          {b.description}
                        </div>
                      )}
                    </td>
                    <td className="num">{b.wins}</td>
                    <td className="num">{b.losses}</td>
                    <td style={{ textAlign: "right" }}>
                      {user ? (
                        <ChallengeEngineButton botId={b.id} />
                      ) : (
                        <span className="muted">sign in</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <SectionHead
            title="Waiting for a player"
            count={openGames.length}
            accent="amber"
          />
          <p className="muted" style={{ margin: "0 0 12px", lineHeight: 1.6 }}>
            Games other players have hosted and are waiting for an opponent —
            join one and it starts right away.
          </p>
          {openGames.length === 0 ? (
            <Empty>
              Nobody is waiting right now.{" "}
              {user ? "Host one and see who turns up." : "Sign in to host one."}
            </Empty>
          ) : (
            <ul className="watch-grid">
              {openGames.map((g) => (
                <li key={g.id} className="game-card list-item">
                  <Link
                    className="stretch-link"
                    href={`/game/${g.id}`}
                    aria-label="Open game"
                  />
                  <MiniBoard board={decodeBoard(g.board)} size={150} />
                  <div className="game-card-meta">
                    <div>
                      <strong>{nameLink(g.player1_name)}</strong>
                    </div>
                    <span className="muted">
                      {describeTimeControl(g.move_seconds)} ·{" "}
                      {relativeTime(g.created_at)}
                    </span>
                  </div>
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
                  </>
                ),
              },
              {
                label: "Active games",
                content: (
                  <>
          <SectionHead
            title="In progress"
            count={activeGames.length}
            accent="mint"
          />
          {activeGames.length === 0 ? (
            <Empty>No games are being played right now.</Empty>
          ) : (
            <ul className="watch-grid">
              {activeGames.map((g) => (
                <GameCard key={g.id} game={g} kind="active" />
              ))}
            </ul>
          )}

          <SectionHead title="Recently finished" count={recentGames.length} />
          {recentGames.length === 0 ? (
            <Empty>No games have finished yet.</Empty>
          ) : (
            <ul className="watch-grid">
              {recentGames.map((g) => (
                <GameCard key={g.id} game={g} kind="finished" />
              ))}
            </ul>
          )}
                  </>
                ),
              },
            ]}
          />
      </section>

      {/* The same band the game page puts it in: across the foot, under the
          thing the page is actually for. */}
      <section className="chat-band">
        <ChatPanel title="Lobby" canPost={user !== null} />
      </section>
    </>
  );
}

function SectionHead({
  title,
  count,
  accent,
}: {
  title: string;
  /** Omitted where a count would say nothing. */
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

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="empty">{children}</p>;
}

/** A player's name as a link to their profile, or a dash for an empty seat. */
function nameLink(name: string | null) {
  if (!name) return "—";
  return <Link href={`/player/${encodeURIComponent(name)}`}>{name}</Link>;
}

/** A game as a card: the position doing the talking, names underneath. */
function GameCard({
  game,
  kind,
}: {
  game: GameWithPlayers;
  kind: "active" | "finished";
}) {
  const winner =
    game.result === 0 ? null : game.result === 1 ? game.player1_name : game.player2_name;
  return (
    <li className="game-card list-item">
      <Link className="stretch-link" href={`/game/${game.id}`} aria-label="Open game" />
      <MiniBoard board={decodeBoard(game.board)} lastMove={game.last_move} size={160} />
      <div className="game-card-meta">
        <div>
          <strong>{nameLink(game.player1_name)}</strong>
          <span className="muted"> vs </span>
          <strong>{nameLink(game.player2_name)}</strong>
        </div>
        <span className="muted">
          {kind === "active"
            ? `move ${game.ply} · ${relativeTime(game.updated_at)}`
            : `${winner ? `${winner} won` : "drawn"}${endingSuffix(game.result_reason)}`}
        </span>
      </div>
    </li>
  );
}

