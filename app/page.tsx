import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import SignInForm from "@/components/SignInForm";
import Board from "@/components/Board";
import { STARTING_BOARD } from "@/lib/game/board";

export const dynamic = "force-dynamic";

/**
 * The front door.
 *
 * Signed in, the dashboard says everything better, so we send you there.
 * Signed out: the board fills the background, and the name and the sign-in
 * float over it, centred — the first thing a visitor can do is the thing the
 * page is for. No copy beyond one line; the board makes the case better than
 * bullet points did.
 */
export default async function HomePage() {
  const user = await currentUser();
  if (user) redirect("/dashboard");

  return (
    <div className="splash">
      {/* The standard opening, as scenery. Not interactive. */}
      <div className="splash-bg" aria-hidden="true">
        <Board board={[...STARTING_BOARD]} />
      </div>

      <div className="splash-fg">
        <h1 className="splash-title">Gygès</h1>
        <p className="splash-line">
          Play online, against people or the computer.
        </p>

        <SignInForm />

        <p className="splash-links">
          <Link href="/rules">How to play</Link>
          <Link href="/games">Watch a game</Link>
          <Link href="/computer">The computer</Link>
        </p>
      </div>
    </div>
  );
}
