import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { gamesAwaitingUser } from "@/lib/db/queries";
import "./globals.css";

/**
 * What a shared link looks like. The title is written the way game sites
 * write theirs — the action first — because that is the line people see in a
 * chat or a search result, and "play X online from your browser" is the whole
 * pitch in one string.
 */
export const metadata: Metadata = {
  metadataBase: new URL("https://playgyges.com"),
  // Written to never need changing: no counts, no feature names — nothing
  // that a redesign or a new bot lineup could make untrue.
  title: {
    default: "Play Gygès online — take on the computer or other players",
    template: "%s",
  },
  description:
    "Play the board game Gygès free in your browser. No download, and no rush — take your turns whenever you like.",
  openGraph: {
    title: "Play Gygès online — take on the computer or other players",
    description:
      "Free, in your browser, no download. Take your turns whenever you like.",
    url: "/",
    siteName: "playgyges.com",
    type: "website",
  },
  twitter: {
    card: "summary",
  },
};

export const viewport = {
  themeColor: "#12100e",
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
              {/* The same file the browser tab shows — one mark, two places. */}
              <img src="/icon.svg" alt="" className="brand-mark" width={20} height={20} />
              Gygès
            </Link>
            <nav>
              {user && (
                <Link href="/dashboard">
                  Dashboard
                  {waiting > 0 && <span className="nav-count">{waiting}</span>}
                </Link>
              )}
              <Link href="/games">Games</Link>
              <Link href="/computer">Computer</Link>
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
