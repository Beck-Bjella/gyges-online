import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import SignInForm from "@/components/SignInForm";
import Board from "@/components/Board";
import { STARTING_BOARD } from "@/lib/game/board";

export const dynamic = "force-dynamic";

/**
 * The front door.
 *
 * Signed in, there is nothing to say here that the dashboard does not say
 * better, so we send you there. Signed out, this page has one job: explain the
 * game and get you an account. Browsing live games belongs on /games.
 */
export default async function HomePage() {
  const user = await currentUser();
  if (user) redirect("/dashboard");

  return (
    <div className="landing">
      <section className="hero">
        <h1 className="hero-title">Gygès</h1>
        <p className="hero-sub">
          An abstract strategy game where nobody owns the pieces. Play
          correspondence-style against other people — take your turn whenever
          you like, and let your opponent do the same.
        </p>

        <ul className="hero-points">
          <li>
            <strong>Nobody owns the pieces.</strong> You may only move a piece
            in the row nearest you, and it travels as far as it has rings.
          </li>
          <li>
            <strong>You arrange your own back row.</strong> Every game starts
            from an empty board, so your first decision is the shape of your
            own line.
          </li>
          <li>
            <strong>No clock to sit through.</strong> Take hours or days over a
            move. Your opponent does not need to be online.
          </li>
        </ul>

        <div className="hero-actions">
          <Link href="/rules" className="btn">
            How to play
          </Link>
          <Link href="/games" className="btn">
            Watch a game
          </Link>
        </div>
      </section>

      <section className="landing-side">
        {/* The best-looking thing the site owns, doing the talking. Purely
            decorative: the standard opening, not interactive. */}
        <div className="landing-board" aria-hidden="true">
          <Board board={[...STARTING_BOARD]} />
        </div>
        <SignInForm />
      </section>
    </div>
  );
}
