import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { gamesAwaitingUser } from "@/lib/db/queries";
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
          {/*
            Three parts, and the middle one is centred on the PAGE rather than
            in whatever space is left over: brand, navigation, you. Equal-width
            outer columns are what make that true, so the tabs stay put whether
            the right-hand side says a long username or nothing at all.
          */}
          <header className="topbar">
            <Link href={user ? "/dashboard" : "/"} className="brand">
              <span className="brand-mark" aria-hidden />
              Gygès
            </Link>
            <nav>
              {user && (
                <Link href="/dashboard">
                  Dashboard
                  {waiting > 0 && <span className="badge">{waiting}</span>}
                </Link>
              )}
              <Link href="/games">Games</Link>
              <Link href="/leaderboard">Leaderboard</Link>
              <Link href="/rules">Rules</Link>
            </nav>
            <div className="topbar-end">
              {user ? (
                /* Your own profile is also your account page, so this single
                   button is the way to both. */
                <Link
                  href={`/player/${encodeURIComponent(user.username)}`}
                  className="profile-button"
                >
                  <span className="profile-initial" aria-hidden>
                    {user.username.charAt(0).toUpperCase()}
                  </span>
                  <span className="profile-name">{user.username}</span>
                </Link>
              ) : (
                <Link href="/" className="btn">
                  Sign in
                </Link>
              )}
            </div>
          </header>
          <main>{children}</main>
          <footer className="site-foot">
            <span>
              Gygès was designed by Claude Leroy and is published by Blue
              Orange. This is an unofficial, non-commercial implementation and
              is not affiliated with or endorsed by them.
            </span>
          </footer>
        </div>
      </body>
    </html>
  );
}
