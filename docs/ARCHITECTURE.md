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

Every move is validated server-side against the authoritative game state before it
is persisted. Anything else is trivially cheatable — a player can edit client-side
JavaScript, so client-side validation is a UX affordance only.

This is a deliberate reversal of how the old desktop UIs worked. Those performed
no validation at all, on purpose, so the engine could be tested from arbitrary
positions. That affordance does not survive into competitive online play.

Concretely:

- The client may compute legal moves to highlight them and to reject obvious
  mistakes instantly. This is for feel, not for correctness.
- The server recomputes legality from its own state on every submission.
- The server also owns turn order, game termination, and rating changes.

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

## Where the rules live

The authoritative rules exist today in the `gyges` Rust crate, in the separate
Gyges engine project. That crate documents itself as **x86_64 only**, so it does
not drop unchanged into a web server or a WASM build.

Three options for the server-side validator:

| Option | Cost | Benefit |
|--------|------|---------|
| 1. Port move generation to TypeScript | ~500 lines, plus a test suite | Runs anywhere; no cross-language build; simplest deploy |
| 2. Compile `gyges` to WebAssembly | Must fix x86_64 assumptions first | One source of truth for the rules |
| 3. Separate Rust validation service | Two deployables, network hop per move | Maximum fidelity to the engine |

**Decision for v1: option 1.** Shipping matters more than sharing one
implementation, and a TypeScript validator can run in *both* the browser and the
server — giving instant client-side move highlighting from the same code that
enforces legality. The risk is drift between two rule implementations; the
mitigation is a test suite of positions cross-checked against the Rust move
generator offline.

Option 2 becomes attractive later, when the engine is integrated as an opponent
and a WASM build is needed anyway.

The validator lives in an isolated, dependency-free module so it can be swapped
for a WASM implementation without touching anything that calls it.

---

## Stack

**Next.js (TypeScript) + PostgreSQL, single repository, single deployable.**

Rationale:

- **One codebase, not a split frontend/backend.** At this scale, splitting them
  doubles deployment work and buys nothing. Next.js server routes provide the API
  and the pages together, with types shared across the boundary.
- **PostgreSQL over MySQL** for real constraints, transactions, and JSON columns.
  Move lists and game state benefit from both.
- **TypeScript throughout**, so the board encoding, move format, and validation
  logic are literally the same code on client and server.

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
│   │   ├── game/            board encoding, move generation, validation
│   │   ├── db/              schema and queries
│   │   └── auth/            sessions and accounts
│   └── styles/
├── tests/                   rules tests against known positions
└── package.json
```

`src/lib/game/` is the important boundary: **no framework imports, no database
imports, no I/O**. Pure functions over a board state. That is what lets the same
module run in the browser for responsiveness and on the server for authority, and
what makes it swappable for WASM later.

---

## Data model sketch

Not final; recorded so the shape is agreed before implementation.

- **users** — identity, display name, credentials, timestamps.
- **games** — the two players, status (pending / active / finished), result,
  whose turn it is, the starting position, timestamps, and time control settings
  (for correspondence, this is a per-move deadline such as 72 hours).
- **moves** — game reference, ply number, the move itself, the player who made
  it, and when. Unique on (game, ply). This table is the source of truth.
- **ratings** — rating per user, updated on game completion.

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
