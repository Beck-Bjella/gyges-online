# Architecture

Working decisions for Gygès Online. This is a living document — revise it as
things get built and assumptions get tested.

---

## Status

**Live at https://gyges.app since 2026-09-04.** One Lightsail box, deployed by
`deploy/setup.sh`, updated by `deploy/deploy.sh` — see `deploy/README.md`.

**Built and working**: accounts with passwords, sessions, creating and joining
games, an interactive SVG board with displacement moves, per-move history with
review, resignation, draws by agreement, forfeit on time, a leaderboard, and
five computer opponents with profile badges for beating them. The server
enforces participation, turn order, **and the rules of Gygès**. 170 tests
pass.

**Reversed decision — SQLite is the production database, not a stand-in for
one.** This document used to describe development on SQLite and production on
Neon Postgres. That port is off the roadmap; see "Hosting" below for why. The
schema stays inside the portable subset anyway, which costs nothing and keeps
the door open.

**Playing the engine works**, and nothing about it runs on the server: the
engine is compiled to WebAssembly and searches in the player's own browser. See
"The engine runs in the browser" below.

**Not built yet:** email notifications, and any rating system — one was built
(Elo against the bots as fixed anchors) and deliberately retired the same week
for profile badges, which say "beat Hard Bot" in words instead of a number
that needed explaining. The design survives in git history if a rating ever
earns its way back.

**Reversed decision — move legality is no longer waiting on the engine.** It is
implemented in `lib/game/rules.ts`, in TypeScript, in-process. See "Where the
game rules live" below for why the original plan was changed.

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
- **legality** — that the move is allowed by the rules of Gygès, checked with
  `lib/game/rules.ts`. See "Where the game rules live" below.

The distinction between authority and rule-checking still matters, because they
are separable and were separate for a while. "Server-authoritative" is about
**who owns the truth**, not about how much of it is rule-checked: even with no
rules at all, the server must be the one that says whose turn it is and what the
move history contains, because a player can edit their own JavaScript. The
browser now highlights legal moves from the same module the server validates
with, and that highlighting is a convenience for the player — never a guarantee
against them.

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

The **starting** position is different: it is stored on the game and never
changes. Replaying a move list has to start somewhere, and a client that
hardcoded the standard opening would silently redraw every historical game
wrongly the moment setup variants, handicaps or puzzle positions existed. A
test asserts that replaying the moves from the stored start reproduces the
cached current position.

---

## Where the game rules live

**In code, in TypeScript: `lib/game/rules.ts`.** Not in the database, and — for
now — not in the Rust.

> **This reverses an earlier decision.** This document previously argued the
> rules must live only in the Rust crate and be reached over a bridge. The
> argument below is what changed, and the objection that argument raised is
> real and is addressed rather than dismissed.

### Why it moved

Two things were being conflated: *legality* and *search*. They share code inside
the engine, but as services to a website they have nothing in common.

| | Move legality | Bot move |
|---|---|---|
| Question | "is this legal?" | "what is best?" |
| Cost | a bounded walk over 36 squares; microseconds | seconds, a full core, 400 MB of tables |
| Called | every move, and continuously while dragging | only in bot games |
| Fits in a web request? | yes, trivially | no — needs a queued job |

Legality is small. The entire implementation is one file of pure functions with
no I/O. Reaching for a network service to answer it would have added a hosting
bill, a network hop on every move, and a new failure mode — engine unreachable
means *nobody can play* — in exchange for nothing.

It also buys something a service could not. Because `lib/game/` is pure and
framework-free, the identical code runs in the browser, so the board highlights
legal destinations while dragging with **no round trip**. Over HTTP that is a
request per hover.

### The objection, which was correct

The earlier argument was that two implementations *will* eventually disagree,
and that a bot playing by different rules than the validator enforces is a
serious defect. That risk is real and is not waved away.

What makes it tolerable:

- **The bot is not built, and is optional.** Today there is exactly one
  implementation in use. The divergence risk begins when the engine arrives.
- **Disagreement is testable, not hypothetical.** `lib/engine/client.ts` is
  unchanged. When the engine is reachable, the two can be run against the same
  positions and compared; any disagreement is a bug with a reproducing case.
- **The bot's move goes through the same validation as a human's** — as it
  already must, for the reason Lichess does it. So the validator stays the
  authority even in bot games, and a divergence surfaces as a rejected bot move
  rather than as an illegal position on the board.

If the engine and this module ever disagree, the engine is probably right — it
is the battle-tested one — and this module gets fixed.

### What the engine is still for

Search — and that now happens in the browser too. See the next section.

---

## The engine runs in the browser

Bot play was expected to need a machine: a search takes seconds and wants a
core, which is the one thing serverless hosting is bad at. The plan was a small
always-on box reached over HTTP.

That is not what was built. The engine compiles to `wasm32-wasip1` and runs in
the player's own browser, which means **the server does no engine work at all**
and there is nothing to keep alive.

### What it took

Three changes to the engine, all `cfg`-gated so native builds are untouched
(committed in the engine repo as "support x86-64 and wasm32-wasip1 targets"):

- a portable software fallback for `_pext_u64`, the one x86-only instruction;
- the evaluation network compiled in with `include_bytes!`, since a browser has
  no filesystem to read weights from;
- the search runs inline rather than on a spawned thread, because wasm32 has no
  threads — and a smaller transposition table, since 400 MB per open tab is not
  reasonable.

Nothing else. The engine keeps its ordinary UGI interface: the worker in
`public/engine/engine-worker.js` writes `setpos`/`go` to stdin and reads
`bestmove` from stdout, exactly as a terminal would. WASI is what gives a wasm
module those streams, and the module imports precisely eight WASI functions —
small enough that the host is a hundred lines of JavaScript with no dependency.

### Reproducibility

A bot is bounded by **node count**, never by time. Bounding by time would make a
fast machine face a stronger opponent, so a bot's record would describe its
opponents' hardware rather than the bot. With a node budget a phone and a
desktop play the identical game; only the waiting differs. Verified: the native
binary and the wasm build return the same move and score for the same position
and budget.

Each search gets a fresh instance, so it also starts with an empty
transposition table. An interrupted search is discarded rather than resumed —
resuming with a half-filled table is a different search, and could produce a
different move.

### What the browser is trusted with

Nothing. The bot's move is submitted through an endpoint that validates it with
`lib/game/rules.ts`, exactly as a human's move is validated: a tampered client
cannot make the engine move out of turn or play an illegal move.

It *can* make the engine play a legal but weak move, and so beat it. That is
inherent to running the engine on the player's machine, and it is worth being
plain about: a bot's win/loss record is a record of games as they were played,
not a proof of the engine's strength.

### What it costs

The wasm is 28 MB — 5 MB of engine and 23 MB of network — which the browser
caches after the first visit. On a Lightsail instance, whose bundled transfer
is measured in terabytes, that is tens of thousands of first visits a month
before bandwidth is worth a thought; quantising the network would push it
further still. Compute is free, because there is none.

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

This service cannot be serverless: the engine wants real threads (`YbwcPool`)
and seconds of CPU. It needs an ordinary always-on host — which, now that the
site itself runs on one, is that same box. Nothing extra to rent.

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
gyges-online/
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

A single provider *can* do all three, and here two of them are the same box:
the application and the database live together, because the database is a file
on that machine's disk. Only the domain is bought elsewhere. See "Hosting".

## Why each tool

**Next.js** puts the pages people see and the server code behind them in one
project, in one language. The alternative — a separate frontend app and backend
API — means two things to deploy, two to debug, and hand-written glue between
them. At this scale that is pure overhead. One codebase means the definition of
a board or a move is written once and used by both sides.

**TypeScript** is JavaScript with type checking. When the server sends a board of
38 numbers and a page expects something else, that is caught while writing the
code rather than by a player hitting a broken screen.

**SQLite** because this application is shaped exactly like the workload SQLite
is good at, and because a database that is a file is one you can copy, inspect
and restore with tools you already have. It refuses impossible rows the way
Postgres would — two moves both claiming to be ply 7 of one game, a game
referencing a player who does not exist — and that is the whole of what the
database is asked to do. It holds no knowledge of Gygès; the rules live in
Rust, never in the schema.

Writes are serialised, one at a time, which sounds like a limit until it meets
the actual load: one row per move, and moves arrive minutes or days apart. With
WAL enabled readers never wait for the writer. Reads come out of the OS page
cache rather than over a network, which is why the query layer is synchronous.

**One always-on Linux box** rather than a serverless platform. Serverless asks
an application to have no memory between requests: a fresh process every time,
a blank disk, possibly in another region. Every part of this app disagrees with
that — an open file handle, a WAL beside it, a connection cached for the life
of the process. Renting one small machine is not a compromise here; it is the
shape the program already has.

**Resend** sends the "it's your turn" emails. Correspondence play is unusable
without them.

**Engine service** — the existing Gygès engine executable, plus a thin bridge
that feeds it commands. Answers "is this move legal?" now and "what move should
the bot play?" later. Needs an always-on host rather than a serverless one.

Each piece does a single job and any one can be replaced without disturbing the
others:

```
Browser  ---- runs the engine itself (wasm) for bot moves
   |
   v
One Linux box
   |
   +--  Caddy          TLS, reverse proxy to :3000
   +--  Next.js        pages and server code, under systemd
   +--  SQLite file    accounts, games, move lists, on the instance disk
   |
   +-------------->  S3        nightly copy of the database file
   +-------------->  Resend    "it's your turn" email
```

The site holds no game knowledge; it asks the engine service. The database holds
no game knowledge; it stores rows.

## Hosting

**One small Linux box, the database on its disk, the domain pointed at its IP.**

### Why not Vercel and a managed Postgres

That was the plan, and reversing it removes the largest single item from the
roadmap. Vercel cannot keep a file, so the arrangement required porting every
query in the data layer from synchronous SQLite to asynchronous Postgres — a
change touching every caller, undertaken for no reason but the platform. The
application gains nothing from it: a network round trip replaces a page read,
and code that is correct today becomes code that has to be re-verified.

The rest of the case is ordinary operations. A database that is a file can be
copied, opened with `sqlite3` over SSH, and restored by putting it back;
`npm run db:backup` already does exactly that. Resetting is deleting a file.
None of these are harder in the managed version, but none are easier either,
and each adds a console and a connection string between the operator and the
data.

What is given up: the platform no longer handles TLS, restarts and deploys, so
those become a Caddyfile, a systemd unit and a shell script. That is one
evening, once.

### The shape

- **Instance.** AWS Lightsail. Launched on the $5, 512 MB tier — workable
  because `setup.sh` creates a 2 GB swap file before anything else; the Next
  build is the only memory-hungry moment in the system, and with swap it is
  merely slow. If build times grate, snapshot and restore onto the 2 GB tier.
  EC2 is equivalent and slightly dearer once the separately-billed IPv4
  address is counted — worth it for VPC or IAM control, such as letting the
  backup job assume a role rather than hold a key.
- **Disk.** The database on the instance's own volume, and **never on EFS or
  any network filesystem** — SQLite's locking assumes a local disk, and over
  NFS it can corrupt rather than merely underperform. `GYGES_DB_PATH` chooses
  the path.
- **Process.** systemd, `Restart=always`, `systemctl enable`. Crashes and
  reboots recover unattended.
- **TLS.** Caddy in front, obtaining and renewing certificates by itself. Ports
  80 and 443 both open: 443 carries the traffic, 80 answers the certificate
  challenge.
- **One process against the file.** Several processes on one host are fine —
  SQLite locks properly — but never two machines sharing a volume.
- **Backups.** Cron runs `npm run db:backup` and copies the result to S3, so a
  copy exists off the machine; instance snapshots cover the whole disk. A
  snapshot alone is not a backup if the account is what goes wrong.
- **Watching.** An external uptime ping (Healthchecks.io, UptimeRobot) rather
  than CloudWatch alone: what matters is whether the site answers, not whether
  the instance is running.
- **Domain.** Any registrar; a registrar and a host need not be the same
  company. One A record for the apex pointing at the **static** IP — a
  Lightsail static IP or an EC2 Elastic IP, never the default public address,
  which changes when the instance stops. `www` as a second A record or a CNAME
  to the apex. Point DNS before starting Caddy, since the certificate challenge
  needs the name to resolve first.
- **`GYGES_INSECURE_COOKIES` must stay unset.** It exists so LAN testing over
  plain http works; set in production it stops session cookies being Secure.

### Cost

| Concern | Choice | Cost |
|---------|--------|------|
| App and database | Lightsail 512 MB (as launched) | $5/mo |
| Backups | S3 | pennies |
| Email | Resend free tier | $0 |
| Domain | any registrar | ~$10–15/yr |

At a registrar the renewal price is what matters, not the first-year promotion.

Notes on the alternatives considered:

- **Fly.io or Render with a persistent volume** keep a real disk and a
  long-lived process, so SQLite works untouched while deploys and certificates
  stay someone else's problem — a reasonable middle if the sysadmin part is
  unwelcome. Avoid Render's *free* tier, which spins down after 15 minutes
  without traffic and takes about a minute to wake; the site would look broken
  to anyone arriving in a quiet stretch. Fly.io's free allowances ended in
  October 2024.
- **A registrar's shared/cPanel hosting** is the wrong platform whatever the
  database: a PHP/LiteSpeed estate where Node runs, if at all, under a
  Passenger-based selector with constrained RAM and no real control over the
  process supervisor.
- **Serverless generally** — Vercel, Lambda, App Runner, Fargate — is ruled out
  by one property rather than by price: no durable local disk.

*Prices are approximate and move; re-check before committing money. AWS bills
a public IPv4 address separately on EC2, which is the line people forget when
comparing it against Lightsail's bundled pricing.*

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
