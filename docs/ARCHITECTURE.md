# Architecture

Working decisions for Gygès Online. This is a living document — revise it as
things get built and assumptions get tested.

---

## Status

**Built and working locally** (see the README to run it): accounts and sessions,
creating and joining games, an interactive SVG board with displacement moves,
per-move history with review, resignation, forfeit on time, and a leaderboard.
The server enforces participation and turn order. 47 unit tests and 31
end-to-end checks pass.

**Local stack differs from the target in one place:** development uses SQLite
rather than Postgres, on a schema deliberately restricted to the portable
subset. Everything else below describes the intended production shape.

**Not built yet:** move legality (waiting on the engine service), passwords,
email notifications, and bot play.

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

## Schema decisions, checked against other servers

The data model was reviewed against seven open-source turn-based game servers
(lila/lidraughts, pychess-variants, boardgame.io, govsgo, two Rails chess apps,
and Board Game Arena's published conventions). Three conclusions worth keeping:

**Two player columns, not a junction table.** Lichess embeds both players
directly in the game (`p0`/`p1`); pychess-variants uses an ordered two-element
array. The one surveyed project using a junction table has to infer colour from
row order and carries a TODO admitting it. A junction table buys flexibility
that an asymmetric two-player game never spends.

**Tombstone deleted users; never cascade.** Lichess replaces a closed account
with a "ghost" sentinel so every historical game survives, and unsets personal
fields rather than deleting the row. One surveyed project cascades deletes into
its game archive, which destroys game records when a user leaves. Hence
`users.deleted_at` and `ON DELETE RESTRICT` here.

**The cached position earns its keep by guarding writes, not by speeding reads.**
pychess-variants includes the stored position in its update filter so a stale
move cannot land; govsgo re-reads the current player inside the write path for
the same reason. Meanwhile govsgo *removed* a pure read-optimisation cache and
lichess moved off its cached piece map toward replaying a compressed log. Our
`submitMove` follows the pattern that survived: the final UPDATE is conditional
on the ply and turn we read, so a move that lost a race changes zero rows and
reports a conflict.

---

## Store moves, not positions

A game is its **ordered list of moves**. The current board position is derived by
replaying them from the fixed starting position.

One precision worth stating, because an earlier draft of this document
overclaimed: the `games` row is the authority on a game's *state* (status,
result, whose turn), and `moves` is the authority on its *history*. They are
separate because **not every ending is a move** — resignations and timeouts
finish a game without adding a move row, so replaying the move list alone
cannot tell you how a game ended. If that ever needs to be reconstructible from
history alone, terminal events get a `kind` column in `moves`.

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

**B. Keep the engine as one executable; the backend is a bridge to it.**

This is the preferred approach. The engine stays exactly what it already is — a
self-contained `.exe` with a text command interface (UGI) — and gains the
verification commands it lacks. The web backend spawns it and feeds it commands.

Adding legality to the engine is small: `MoveGen` is already imported in
`gyges_engine/src/ugi.rs`, and the existing `eval` command shows the pattern
(build a `MoveGen`, run it against the board, print the result). Roughly 20
lines.

Advantages that matter:

- **The engine stays independent.** It does not learn that a website exists, and
  the website does not depend on crate internals.
- **Debuggable by hand.** Run the exe in a terminal, type commands, read replies.
  Reproducing a reported bug needs no web stack at all.
- **Already proven.** The desktop UIs drove the engine this way for years.

### How chess platforms do this

This design is the standard one, and Lichess (open source) is the citable case.
Its `lila` README lists the two as separate concerns:

- *"Chess logic: scalachess submodule"* — a rules library with **no search and no
  evaluation**. Legal move generation, variants, FEN/PGN, game state.
- *"Chess engine: Stockfish, via fishnet AI cluster"* — a different system
  entirely.

**For a normal human-vs-human game, Stockfish is not in the path at all.** The
move is validated by scalachess and broadcast. The engine appears only for
analysis and for "play the computer," and even then it runs off-box: lila talks
to Redis, which talks to a `lila-fishnet` coordinator service, which hands work
over HTTP to volunteers running Stockfish on their own machines.

The detail worth copying: **the bot's own move is re-validated.** fishnet returns
a plain UCI move string, and lila puts it through scalachess like any other move.
The engine is a consultant with no authority over game state — which is why
Lichess can safely run it on strangers' desktops.

Lichess also ships a WebAssembly Stockfish (`stockfish-web`) for in-browser
analysis. So there are three independent engine deployments, and **none of them
decides whether a move is legal.**

### Why the split is universal

The two computations are categorically different:

| | Move validation | Engine search |
|---|---|---|
| Nature | exact, total, deterministic | heuristic, approximate, anytime |
| Correct answer | exists and is unique | none — only better or worse |
| Cost | ~1 microsecond, bounded | seconds, unbounded |
| Trust | must be authoritative, server-side | advisory; safe on untrusted machines |
| A bug means | corrupt game state | a worse suggestion |
| Scales with | number of players | analysis demand — independently |

Concrete numbers: the `shakmaty` Rust chess library reports perft 5 (4.87M
positions) in 24 ms, roughly 200M move-generations/second. fishnet's minimum
hardware bar for a volunteer is "~2 meganodes in 6 seconds" of real search. That
is a **six-to-seven order of magnitude** gap. Anything with that cost ratio
belongs on the other side of a process boundary.

Rules-only libraries are a well-established category — `chess.js` describes
itself as *"everything but the AI"*; `shakmaty`, `cozy-chess`, `python-chess`,
and `scalachess` are all rules without search. Engines (Stockfish, Fairy-
Stockfish, Leela) are separate programs reached over **UCI** — a text protocol
whose entire purpose is to keep the rules authority separate from the thinking
process.

**The Gygès equivalent already exists.** `gyges` is the rules library,
`gyges_engine` is the engine, and UGI is the boundary protocol. The structure
chess arrived at is the structure this project already has.

*(Chess.com is closed source and publishes nothing on its move-validation
architecture. It certainly does not validate moves with Stockfish, but that is
inference, not a citable fact.)*

### The one structural catch: UGI is single-user

The UGI loop is one `stdin` reader over **one board** (`search_options.board`)
running **one search at a time**. That is correct for one human at one desktop,
and unsafe for many simultaneous players:

- `setpos` overwrites the single board, so two players' requests corrupt each
  other's position.
- Commands are **stateful and paired** — every request is really `setpos` then a
  query. Interleave two users and the pairing breaks.
- `go` sets `searching = true`; a second `go` mid-search is a conflict, not a
  queued job.
- Replies are `println!` text with no request identifier, so with several callers
  there is no way to tell whose `bestmove` just arrived.

None of this is a defect in the engine. It just means the bridge has to provide
what the protocol does not.

### The fix: split by workload, not a general pool

The requests are **bimodal** — microseconds or seconds, with nothing in between.
So rather than a general process pool, run one engine instance per *kind* of work:

```
Backend (bridge)
   |
   +--> engine instance "fast"   legalmoves, validate     (microseconds)
   |
   +--> engine instance "bot"    go / search              (seconds)
```

Same executable, two instances, different jobs. A long bot search cannot block a
legality check, because they do not share a process. This is simpler than a pool
and matches the actual shape of the work, while adding:

- **Independent tuning.** The bot instance gets threads and the large
  transposition table (`init()` allocates 400 MB). The fast instance needs
  neither — it only calls `MoveGen`.
- **Independent failure.** A hung or OOM-killed bot search does not take legality
  checking down with it.
- **Independent scaling.** More players means more fast instances; more bot games
  means more bot instances.

**Sequencing:** the second instance is only needed once bot play exists. Until
then one instance serves everything. The split is a configuration change, not a
redesign.

### A rules-only mode is what makes the fast instance cheap

`Ugi::init()` currently allocates the 400 MB transposition table and loads the
neural network **unconditionally** — including for a process that will only ever
answer `legalmoves`. Neither is used by `MoveGen`; both are search machinery.

So the engine should take a flag — a `--rules-only` startup mode, or a
`setoption` honoured before init — that skips `init_tt` and `load_network`
entirely. A fast instance then costs a few megabytes instead of 400, which is the
difference between fitting the cheapest host and not.

This is what lets one executable serve both roles honestly:

| | fast instance | bot instance |
|---|---|---|
| Transposition table | skipped | `2^22` (400 MB) or tuned down |
| Neural network | not loaded | loaded |
| `threads` | 1 | many |
| Answers | `legalmoves`, `validate` | `go` |
| Memory | a few MB | hundreds of MB |

One binary, two configurations. Day one runs a single instance doing both; the
split later changes configuration, not code.

This is also the closest analogue to what chess platforms get by using a separate
rules *library* — the difference being that here it is the same binary in a
different mode, which keeps a single implementation of the rules.

### Make the fast commands stateless — from the start

This part should **not** wait. Verification commands must carry their input
rather than depending on remembered state:

```
legalmoves <boardstring> <player>            -> the legal move list
validate   <boardstring> <player> <move>     -> accepted / rejected
```

Not `setpos` followed by `legalmoves`. The reason is a silent correctness bug:
with any concurrency at all — two instances, or one instance serving two players
whose requests interleave — player A's `setpos`, then player B's `setpos`, then
A's `legalmoves` returns A the wrong answer. No crash, no error message, just a
wrong legal-move list.

Self-contained commands make that impossible by construction, make retries safe,
and mean a crashed process loses nothing. The cost today is nothing.

`go` may stay stateful; it runs one search at a time on a dedicated process by
design.

### Hosting consequence and cost

This service cannot be serverless: the engine wants real threads (`YbwcPool`) and
seconds of CPU, which Vercel functions do not provide. It needs an ordinary
always-on host — Railway or Fly, roughly **$2-5/mo**.

That is the entire cost, and it stays small because **correspondence play is the
cheapest possible workload**:

- Moves arrive hours or days apart, so the server is idle almost all the time. A
  *live* game site is what makes engine hosting expensive — every game holding an
  open connection and a running clock. This is not that.
- Legality checks are microseconds of CPU. Thousands a day would not register.
- Only bot searches consume real CPU, only in bot games, and only for the few
  seconds allowed by `maxTime`.

**The binding constraint is RAM, not CPU.** `Ugi::init()` allocates a 400 MB
transposition table (`init_tt(2usize.pow(22))`), which does not fit the cheapest
instances. Two constants make it fit:

- Transposition table: `2usize.pow(20)` is roughly 100 MB and fits a small box.
  The lost search strength is not meaningful at correspondence time controls.
- `threads` already defaults to 1, which is correct for a small instance.

Both are configuration for the server build, not code changes.

Ways to reduce the cost further:

1. **Do not run it yet.** v1 has no bot and no validation, so there is no engine
   service and no bill — $0 beyond the domain. Add it when rules or bots arrive.
2. **Scale-to-zero hosting.** Fly stops an idle machine and restarts on request; a
   stopped machine costs about $0.15/GB/month. A quiet correspondence site pays
   for the minutes it actually uses. The tradeoff is a cold start on the first
   request after a lull — acceptable for submitting a move or queueing a bot job.
3. **Self-host during development.** For friends-and-testing, the engine can run
   on a personal machine behind a tunnel at $0. Not appropriate for a public
   site, but fine while proving the design.

### Which to choose

**Decision: B.** The engine stays one executable with a text interface, and the
web backend is a thin bridge that feeds it commands — with the bridge owning a
lock or a process pool, and verification commands made self-contained.

B is also needed eventually regardless: a bot cannot run inside a serverless
function, so the moment bot play arrives this service has to exist. Building it
now brings that work forward rather than duplicating it.

**A stays available as a later refinement, for one interaction only:**
highlighting legal moves *while a player drags a piece*. Through a service, every
hover is a network round-trip for something computable in microseconds. A WASM
build would put a copy of the rules in the browser for instant feedback while the
server still enforces them independently from the same source. That is polish, not
architecture — revisit it only if dragging feels laggy.

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

**Engine service** — the existing Gygès engine executable, plus a thin bridge
that feeds it commands. Answers "is this move legal?" now and "what move should
the bot play?" later. Needs an always-on host rather than a serverless one.

Each piece does a single job and any one can be replaced without disturbing the
others:

```
Browser
   |
   v
Vercel (Next.js)  --->  Neon Postgres     accounts, games, move lists
   |
   +-------------->  Engine service       legality now, bot moves later
   |                   (Rust exe + bridge)
   |
   +-------------->  Resend               "it's your turn" email
```

The site holds no game knowledge; it asks the engine service. The database holds
no game knowledge; it stores rows.

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
