"use client";

/**
 * Something threw while rendering. The player gets a way to retry and a way
 * out, instead of Next's bare production error screen.
 */
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="oops">
      <h1>Something went wrong</h1>
      <p className="lede">
        That was the site&apos;s fault, not yours. Your games are safe — every
        move lives on the server the moment it is made.
      </p>
      <div className="row">
        <button className="btn btn-primary" onClick={reset}>
          Try again
        </button>
        <a href="/" className="btn">
          Home
        </a>
      </div>
    </div>
  );
}
