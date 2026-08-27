import Link from "next/link";
import { currentUser } from "@/lib/auth";
import {
  listGamesForUser,
  listOpenGames,
  settleExpiredGames,
  sideOf,
  type GameWithPlayers,
} from "@/lib/db/queries";
import { relativeTime, describeTimeControl } from "@/lib/format";
import SignInForm from "@/components/SignInForm";
import NewGameForm from "@/components/NewGameForm";
import JoinGameButton from "@/components/JoinGameButton";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Deadlines are settled lazily; see settleExpiredGames.
  settleExpiredGames();

  const user = await currentUser();
  const myGames = user ? listGamesForUser(user.id) : [];
  const openGames = listOpenGames(user?.id);

  return (
    <>
      <h1>Gygès</h1>
      <p className="lede">
        A correspondence site for Gygès. Take your turn whenever you like — your
        opponent does not need to be online. Games are stored move by move, so
        you can always replay one from the start.
      </p>

      <div className="grid-2">
        <section>
          {user ? (
            <>
              <h2>Your games</h2>
              {myGames.length === 0 ? (
                <p className="muted">
                  No games yet. Create one, or join an open game.
                </p>
              ) : (
                <ul className="list">
                  {myGames.map((g) => (
                    <GameRow key={g.id} game={g} userId={user.id} />
                  ))}
                </ul>
              )}

              <h2 style={{ marginTop: 32 }}>Open games</h2>
              {openGames.length === 0 ? (
                <p className="muted">Nobody is waiting for an opponent.</p>
              ) : (
                <ul className="list">
                  {openGames.map((g) => (
                    <li key={g.id} className="list-item">
                      <span className="tag tag-waiting">Waiting</span>
                      <span style={{ flex: 1 }}>
                        {g.player1_name ?? "—"}
                        <span className="muted">
                          {" "}
                          · {describeTimeControl(g.move_seconds)}
                        </span>
                      </span>
                      <span className="muted">{relativeTime(g.created_at)}</span>
                      <JoinGameButton gameId={g.id} />
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <>
              <h2>Open games</h2>
              {openGames.length === 0 ? (
                <p className="muted">Nobody is waiting for an opponent.</p>
              ) : (
                <ul className="list">
                  {openGames.map((g) => (
                    <li key={g.id} className="list-item">
                      <span className="tag tag-waiting">Waiting</span>
                      <span style={{ flex: 1 }}>{g.player1_name ?? "—"}</span>
                      <span className="muted">Sign in to join</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>

        <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {user ? <NewGameForm /> : <SignInForm />}
          <div className="panel">
            <h2>Note</h2>
            <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>
              Move legality is not enforced yet — the board accepts any
              structurally valid move. Rules checking arrives with the engine.
              See <Link href="/rules">the rules</Link>.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}

function GameRow({ game, userId }: { game: GameWithPlayers; userId: string }) {
  const side = sideOf(game, userId);
  const yourTurn = game.status === "active" && side === game.turn;
  const opponent =
    side === 1 ? game.player2_name : side === -1 ? game.player1_name : null;

  let tag: React.ReactNode = null;
  if (game.status === "open") {
    tag = <span className="tag tag-waiting">Waiting</span>;
  } else if (game.status === "finished") {
    const won = game.result === 0 ? null : game.result === side;
    tag = (
      <span className="tag">
        {game.result === 0 ? "Draw" : won ? "Won" : "Lost"}
      </span>
    );
  } else if (yourTurn) {
    tag = <span className="tag tag-turn">Your turn</span>;
  } else {
    tag = <span className="tag">Their turn</span>;
  }

  return (
    <li className="list-item">
      {tag}
      <span style={{ flex: 1 }}>
        <Link href={`/game/${game.id}`}>
          {opponent ? `vs ${opponent}` : "waiting for an opponent"}
        </Link>
        <span className="muted"> · move {game.ply}</span>
      </span>
      <span className="muted">{relativeTime(game.updated_at)}</span>
    </li>
  );
}
