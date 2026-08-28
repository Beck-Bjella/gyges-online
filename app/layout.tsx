import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { gamesAwaitingUser } from "@/lib/db/queries";
import SignOutButton from "@/components/SignOutButton";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gygès Online",
  description: "Play Gygès online, correspondence style.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await currentUser();
  const waiting = user ? gamesAwaitingUser(user.id) : 0;

  return (
    <html lang="en">
      <body>
        <div className="site">
          <header className="topbar">
            <Link href="/" className="brand">
              Gygès
            </Link>
            <nav>
              <Link href="/">
                Games
                {waiting > 0 && <span className="badge">{waiting}</span>}
              </Link>
              <Link href="/leaderboard">Leaderboard</Link>
              <Link href="/rules">Rules</Link>
            </nav>
            <div className="spacer" />
            {user ? (
              <div className="row">
                <span className="who">
                  signed in as{" "}
                  <Link href={`/player/${encodeURIComponent(user.username)}`}>
                    <strong>{user.username}</strong>
                  </Link>
                </span>
                <SignOutButton />
              </div>
            ) : (
              <span className="who">not signed in</span>
            )}
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
