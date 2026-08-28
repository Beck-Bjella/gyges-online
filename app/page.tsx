import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import {
  listActiveGames,
  listOpenGames,
  settleExpiredGames,
} from "@/lib/db/queries";
import { relativeTime } from "@/lib/format";
import SignInForm from "@/components/SignInForm";

export const dynamic = "force-dynamic";

/**
 * The front door.
 *
 * Signed in, there is nothing to say here that the dashboard does not say
 * better, so we send you there. Signed out, this is the pitch plus a way in.
 */
export default async function HomePage() {
  settleExpiredGames();

  const user = await currentUser();
  if (user) redirect("/dashboard");

  const openGames = listOpenGames();
  const activeGames = listActiveGames();

  return (
    <div className="landing">
      <section className="hero">
        <h1 className="hero-title">Gygès</h1>
        <p className="hero-sub">
          An abstract strategy game where nobody owns the pieces. Play
          correspondence-style against other people — take your turn whenever
          you like, and let your opponent do the same.
        </p>

        <div className="hero-actions">
          <Link href="/games" className="btn">
            Browse games
          </Link>
          <Link href="/rules" className="btn">
            How to play
          </Link>
        </div>

        <div className="hero-stats">
          <span>
            <strong>{activeGames.length}</strong> in progress
          </span>
          <span>
            <strong>{openGames.length}</strong> waiting for a player
          </span>
        </div>
      </section>

      <section className="landing-side">
        <SignInForm />

        {openGames.length > 0 && (
          <div className="panel">
            <h2>Someone is waiting</h2>
            <ul className="list" style={{ gap: 6 }}>
              {openGames.slice(0, 4).map((g) => (
                <li key={g.id} className="list-item" style={{ padding: "9px 12px" }}>
                  <span className="avatar avatar-amber">
                    {(g.player1_name ?? "?").charAt(0).toUpperCase()}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <strong>{g.player1_name}</strong>
                    <br />
                    <span className="muted">{relativeTime(g.created_at)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
