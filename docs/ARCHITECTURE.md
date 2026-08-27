# Architecture

Working decisions for Gygès Online. This is a living document — revise it as
things get built and assumptions get tested.

---

## Product shape

**Correspondence-style asynchronous play**, in the model of Board Game Arena.
Players take turns over hours or days. Neither player needs to be online at the
same time. Each player is notified when it becomes their move.

This single choice drives most of what follows. In particular: **there is no
realtime requirement**, so v1 needs no WebSocket server, no clock synchronisation,
and no persistent socket connections. A move is one ordinary HTTP request.

---

## Non-negotiable: the server is the authority

The browser renders the board and submits *move intents*. It is never trusted.
The server holds the game state; the client holds a copy for display.

What the server decides, starting in v1:

- **who may act** — that the requester is a participant in this game
- **when they may act** — that it is their turn
- **the record** — the ordered move list, and the fact that a game has ended

What the server does **not** decide in the first version: whether a move is
*legal*. Validation comes from the Rust move generator and is wired in later —
see "Where the game rules live" below.

The distinction matters. "Server-authoritative" is about **who owns the truth**,
not about how much of it is rule-checked. Even with no rules, the server must be
the one that says whose turn it is and what the move history contains, because a
player can edit their own JavaScript. Any check written on the client is a
convenience for the player, never a guarantee against them.

When validation is added, it slots into this same structure as one more thing
the server decides.

---

## Store moves, not positions

A game is its **ordered list of moves**. The current board position is derived by
replaying them from the fixed starting position.

Why this matters:

- **Replay and review** come free — any historical position is reachable.
- **Integrity** — the server can re-validate an entire game from scratch, so a
  corrupted or tampered position cannot silently persist.
- **Export** — a PGN-like game record is a natural output.
- **Debugging** — a bug report is a move list, which reproduces exactly.

The current position may still be cached in a column for cheap list/lobby queries,
but it is a derived value, not the source of truth.

---

## Where the game rules live

**In code — specifically, in the existing Rust.** Not in the database, and not
duplicated in TypeScript.

The `gyges` Rust crate already contains a real legal-move generator
(`gyges/src/moves/movegen.rs`). `MoveGen::gen::<GenMoves, _>()` walks the active
line, handles piece-chaining traversal with backtracking and banned positions,
and produces a `RawMoveList` that decodes to a `Vec<Move>`.

### Why the rules must not be reimplemented in TypeScript

The engine needs legal move generation in order to search. So the same code that
will one day choose the bot's move is the code that can validate a human's move.
Writing a second implementation in TypeScript would guarantee the two eventually
disagree — and a bot playing by different rules than the validator enforces is a
serious defect.

**One rules implementation. Two uses: validation now, bot search later.**

### What the database does NOT do

The database stores rows. It has no knowledge of Gygès — not what a ring is, not
what the active line is, not what a legal move is. Its constraints are ordinary
bookkeeping:

- a game cannot reference a user that does not exist
- two rows cannot both claim to be ply 7 of the same game
- a username cannot be registered twice

That is all. Game understanding lives in software, never in schema.

### Connecting Rust rules to a TypeScript site

The site is TypeScript; the rules are Rust. They have to meet somewhere.

First, a distinction. Two things in the Rust are usually spoken of together but
behave nothing alike:

| | Move legality (`gyges`) | Bot move (`gyges_engine`) |
|---|---|---|
| Question answered | "what is legal here?" | "what is *best* here?" |
| Time | microseconds | seconds |
| CPU | trivial | a full core, and it wants threads (`YbwcPool`) |
| Called | on every human move, and while dragging | only in bot games |
| Fits in a web request? | yes | no — needs a job with a time budget |

That difference, not language, is what drives the design below.

**A. Compile `gyges` to WebAssembly.** The crate becomes a module the TypeScript
imports and calls directly — no extra service, no network hop, and the *same*
build can run in the browser to highlight legal moves.

The crate's docs claim x86_64-only, but the actual dependency is **a single
line**: `core::arch::x86_64::_pext_u64` at `movegen.rs:870` (the BMI2
parallel-bit-extract instruction). The standard fix is a portable software
fallback selected by `cfg(target_arch)` — native builds keep the fast
instruction, WASM builds use the fallback. Roughly 15 lines, with no effect on
native engine speed. **This has not yet been attempted and should be verified
before committing to it.**

**B. Run the Rust as a small service.** A long-lived Rust program exposing
endpoints the site calls over HTTP:

```
POST /legal-moves   { board, player }        -> the legal move list
POST /validate      { board, player, move }  -> accepted / rejected
POST /bot-move      { board, player, depth } -> the engine's chosen move
```

The site never knows the rules; it asks. Notes on building it:

- Link `gyges` and `gyges_engine` **as crates**, rather than spawning
  `gyges_engine.exe` and piping UGI text. They are libraries; `Searcher::new(...)`
  plus `go()` with an `AtomicBool` stop signal is the entry point. This avoids
  subprocess management and text parsing entirely.
- Caveat: `gyges_engine`'s own docs say it is "not intended to be used as a
  dependency," so expect small changes to link it cleanly.
- It cannot be serverless. The engine wants real threads and seconds of CPU,
  which rules out Vercel functions. This needs an ordinary always-on host
  (Railway or Fly, roughly $2-5/mo).
- Bot moves should be a **queued job**, not a blocking HTTP call: accept the
  request, search, then write the move and notify. Correspondence play makes this
  natural — nobody is watching a spinner.

### Which to choose

**These are not exclusive, and B is needed eventually regardless** — a bot cannot
run inside a serverless function, so the moment bot play arrives, a service like
B has to exist. Choosing B first is therefore not wasted work; it is work brought
forward.

The argument for A alongside it is latency on one specific interaction: if
legality lives only in a service, then highlighting legal moves while a player
drags a piece means a network round-trip per hover, for something that takes
microseconds to compute. A WASM build puts a copy of the rules in the browser for
instant feedback, while the server still enforces them independently from the
same source, so the two cannot disagree.

**Recommended: start with B.** One service, one deployment, one mental model, and
it covers both jobs. Add A later purely as a client-side responsiveness
improvement, if dragging feels laggy.

The reverse order also works if the bot is far off and the site should stay on a
single free host for now.

### Sequencing

Validation is **not** required for the first version to be useful. A v1 that
accepts any move is playable among people who know the rules, and it lets the
accounts / games / board / notifications work be finished and tested first.

Because games are stored as an **ordered move list** rather than board
snapshots, wiring in the validator later is a drop-in: the stored shape of a move
does not change, no migration is needed, and existing games stay readable.

Ranked play and public matchmaking should wait for validation, since ratings are
meaningless while illegal moves are accepted.

---

## Stack

**Next.js (TypeScript) + PostgreSQL, single repository, single deployable.**

Rationale:

- **One codebase, not a split frontend/backend.** At this scale, splitting them
  doubles deployment work and buys nothing. Next.js server routes provide the API
  and the pages together, with types shared across the boundary.
- **PostgreSQL over MySQL** for real constraints, transactions, and JSON columns.
  Move lists and game state benefit from both.
- **TypeScript throughout** for the site, so the board encoding and move format
  are literally the same code on client and server.
- **Game rules stay in Rust**, reached from TypeScript. They are never rewritten
  in another language and never encoded in the schema.

Deliberately deferred: WebSockets, a job queue, a separate API service, and
microservices of any kind. None are needed for turn-based correspondence play, and
each can be added later without restructuring.

---

## Repository layout

```
GygesUI/
├── docs/
│   ├── BOARD_REFERENCE.md   board topology, piece encoding, geometry, colors
│   └── ARCHITECTURE.md      this file
├── src/
│   ├── app/                 Next.js routes — pages and API endpoints
│   ├── components/          board SVG, game list, profile, layout
│   ├── lib/
│   │   ├── game/            board encoding, move format
│   │   ├── rules/           WASM bindings to the gyges Rust move generator
│   │   ├── db/              schema and queries
│   │   └── auth/            sessions and accounts
│   └── styles/
├── tests/                   tests
└── package.json
```

`src/lib/game/` is the important boundary: **no framework imports, no database
imports, no I/O**. Pure functions over a board state. That is what lets the same
module run in the browser for responsiveness and on the server for authority.
Keeping this boundary clean now is what makes adding validation later a drop-in
rather than a rewrite.

---

## Data model sketch

Not final; recorded so the shape is agreed before implementation.

- **users** — identity, display name, credentials, timestamps.
- **games** — the two players, status (pending / active / finished), result,
  whose turn it is, the starting position, timestamps, and time control settings
  (for correspondence, this is a per-move deadline such as 72 hours).
- **moves** — game reference, ply number, the move itself, the player who made
  it, and when. Unique on (game, ply). This table is the source of truth.
- **ratings** — rating per user, updated on game completion. Deferred until
  move validation exists; ranked play is meaningless while illegal moves are
  accepted.

Correspondence play needs one background concern: **timeouts**. If a player does
not move within the deadline, the game is forfeited. That is a scheduled job, not
a realtime system — a periodic task that finds expired games and resolves them.

---

## Notifications

Correspondence play is unusable without "it's your turn" notifications. Planned
order:

1. **In-app** — a list of games awaiting your move. Required; trivial.
2. **Email** — needs a transactional email provider.
3. **Web push** — best experience, more complexity. On iOS this requires the
   site to be installed to the home screen as a PWA.

---

## The three pieces of a website

Plain-language version, because "hosting" bundles three separate jobs that are
often three separate companies.

1. **The domain** — the name, e.g. `gyges.com`. It is *rented*, holds no code,
   and stores nothing. Every domain has DNS settings: a control panel that says
   "when someone types this name, send them to that server." Change two records
   and the name points anywhere.
2. **The application** — the program that builds pages and receives moves. It
   must be running constantly, waiting for requests.
3. **The database** — permanent storage for accounts, games, and moves. Survives
   restarts, crashes, and deploys.

A single provider *can* do all three. NameHero cannot do all three for this
particular app, for the reasons in the Hosting section below.

## Why each tool

**Next.js** puts the pages people see and the server code behind them in one
project, in one language. The alternative — a separate frontend app and backend
API — means two things to deploy, two to debug, and hand-written glue between
them. At this scale that is pure overhead. One codebase means the definition of
a board or a move is written once and used by both sides.

**TypeScript** is JavaScript with type checking. When the server sends a board of
38 numbers and a page expects something else, that is caught while writing the
code rather than by a player hitting a broken screen.

**PostgreSQL** over MySQL because it is stricter about *bookkeeping* integrity.
It can refuse impossible rows — two moves both claiming to be ply 7 of one game,
or a game referencing a player who does not exist. This is ordinary record
keeping and involves no knowledge of Gygès; the rules live in Rust, never in the
schema.

**Vercel** is made by the same people as Next.js. Connect the GitHub repo and
every push deploys automatically; HTTPS, CDN, and scaling are handled. Crucially
it does not sleep — some free hosts shut down after minutes of inactivity and
take about a minute to wake, which makes a site look broken to anyone arriving
during a quiet period.

**Neon** runs the Postgres server so it does not have to be installed, patched,
or backed up by hand.

**Resend** sends the "it's your turn" emails. Correspondence play is unusable
without them.

Three services rather than one, but each does a single job, each is free at this
scale, and any one can be replaced without disturbing the others.

## Hosting

**Use NameHero for the domain only. Host the application elsewhere.**

NameHero's shared/cPanel plans are the wrong platform for this app:

- Their database documentation covers **only MySQL/MariaDB**; there is no
  evidence Postgres is available on shared plans.
- It is a PHP / LiteSpeed / WordPress platform. Node runs, if at all, under a
  Passenger-based cPanel "Node.js Selector" with constrained RAM and no real
  control over the process supervisor — a poor fit for Next.js.
- Their VPS plans (~$5–22/mo, root access) *would* work, but that means doing
  your own sysadmin against platforms purpose-built for this.

A registrar and a host do not have to be the same company. Buy the domain at
NameHero and point the DNS wherever the app lives. This costs nothing extra and
keeps every option open.

### Recommended starting point

| Concern | Choice | Cost |
|---------|--------|------|
| App | Vercel Hobby | $0 |
| Database | Neon free tier | $0 |
| Email | Resend free tier | $0 |
| Domain | NameHero | ~$10–15/yr |

Two caveats on this combination, both of which are fine now and worth revisiting
if the site grows:

1. **Vercel's Hobby tier is designated personal / non-commercial.** The moment
   this site takes money — subscriptions, ads, anything — it needs Vercel Pro
   ($20/mo) or a different host.
2. **Vercel Hobby cron fires at most once per day.** Correspondence games need a
   periodic job to forfeit players who exceed their move deadline. Once a day is
   tolerable for a 72-hour deadline, but it is a real constraint. If finer
   granularity is needed, an alternative is to resolve expiry lazily — check and
   settle the deadline whenever a game is loaded — with the daily job as a
   backstop.

Notes on the alternatives considered:

- **Neon over Supabase** for the database: Supabase's free tier **pauses a
  project after one week of inactivity**, requiring manual restore. For a
  turn-based game with quiet stretches, that is a real hazard. Neon suspends
  after 5 minutes idle but wakes automatically on the next query, and its paid
  path scales by usage rather than jumping to a $25/mo tier.
- **Avoid Render's free tier.** It spins down after 15 minutes without traffic
  and takes roughly a minute to wake, showing a loading page. The app would feel
  broken to anyone arriving at a quiet moment.
- **Railway Hobby ($5/mo)** or **Fly.io (~$2–5/mo)** are better shaped than
  Vercel if real background workers or sub-daily cron become necessary, because
  both run ordinary long-lived containers rather than bounded serverless
  functions.
- **Fly.io no longer has a free tier** — the free allowances were discontinued
  in October 2024.

*Pricing verified August 2026 from provider pricing pages; NameHero figures come
from third-party reviews because their site blocks automated access. Re-check
before committing money.*

---

## Notification channels, revisited

Research finding that shapes the plan: **iOS delivers web push only to sites the
user has installed to the Home Screen** (Share → Add to Home Screen), requiring a
web app manifest with `display: standalone` and a service worker. There is no way
to trigger that installation programmatically, so it needs instructional UI and
will lose a meaningful fraction of users.

Therefore: **email is the primary notification channel**, and web push is an
enhancement for users who opt in. Desktop Chrome/Firefox/Edge and Android have no
such restriction.

Resend's free tier allows 3,000 emails/month but caps at **100 per day** — worth
watching, since it is the binding limit long before the monthly figure.

---

## Open questions

- Authentication method: passwords, magic links, or OAuth providers.
- Rating system: Elo or Glicko-2.
- Move deadline defaults for correspondence games (72 hours is a common choice),
  and whether players may configure it per game.
