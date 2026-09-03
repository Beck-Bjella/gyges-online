import Link from "next/link";

export const metadata = { title: "Not found · Gygès" };

/** A wrong link gets a page in the site's own voice, not a bare error. */
export default function NotFound() {
  return (
    <div className="oops">
      <h1>There is nothing here</h1>
      <p className="lede">
        The page you followed does not exist — the game may have been removed,
        or the link mistyped.
      </p>
      <div className="row">
        <Link href="/games" className="btn btn-primary">
          Find a game
        </Link>
        <Link href="/" className="btn">
          Home
        </Link>
      </div>
    </div>
  );
}
