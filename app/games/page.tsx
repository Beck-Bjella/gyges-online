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
import QuickGameButton from "@/components/QuickGameButton";
import StartComputerForm from "@/components/StartComputerForm";
import { BOTS } from "@/lib/bots";
import Tabs from "@/components/Tabs";
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
            Join a table, host one, or take on the computer. Games in progress
            are open to watch.
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
          {/*
            Three ways to start, side by side, because they are three answers
            to one question and the old page made you scroll past two of them
            to find the third. Each says what it costs you: quick match and the
            computer begin at once, hosting waits.
          */}
          <SectionHead title="Start a game" />
          {user ? (
            <div className="start-grid">
              <div className="panel start-card">
                <h2>Quick match</h2>
                <p className="muted">
                  Sits you down at the table that has waited longest.
                </p>
                <div className="start-spacer" />
                <QuickGameButton />
              </div>

              <NewGameForm />

              <StartComputerForm
                bots={bots.map((b) => ({
                  id: b.id,
                  username: b.username,
                  rating: BOTS.find((spec) => spec.username === b.username)?.rating ?? 0,
                }))}
              />
            </div>
          ) : (
            <div className="panel host-panel">
              <div className="host-copy">
                <h2>Want to play?</h2>
                <p className="muted">
                  Pick a name and you can host a table, join one, or take on the
                  computer. Games are correspondence-style, so you take your turn
                  whenever suits you.
                </p>
              </div>
              <Link href="/" className="btn btn-primary">
                Get started
              </Link>
            </div>
          )}

          <SectionHead
            title="Open tables"
            count={openGames.length}
            accent="amber"
          />
          <p className="muted" style={{ margin: "0 0 12px", lineHeight: 1.6 }}>
            Hosted by other players and waiting for an opponent. Joining one
            starts it immediately.
          </p>
          {openGames.length === 0 ? (
            <Empty>
              Nobody is waiting right now.{" "}
              {user ? "Host a table and see who turns up." : "Sign in to host one."}
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
                      {g.rated === 0 && (
                        <span className="tag" style={{ marginLeft: 8 }}>
                          casual
                        </span>
                      )}
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

