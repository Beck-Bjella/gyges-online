# Roadmap

Where this is going, roughly in the order it should be built. Each item says
what it needs and what it blocks, so the sequence is arguable rather than
arbitrary.

Nothing here is a commitment. It is a map, and maps get redrawn.

---

## Now: play it

Before anything else gets built, play real games. Every item below is a guess
about what matters; playing is how the guesses get corrected. Things only a
real game reveals: whether the drag feels right, whether it is obvious whose
turn it is, whether the flipped board confuses the second player, whether the
move list is readable.

Cheap fixes found this way beat expensive features built on assumption.

---

## 1. Real accounts — **DONE**

Passwords, chosen over magic links and OAuth for the reason this section
originally gave: the fewest dependencies. Magic links would have meant building
email (step 4) first, and OAuth would have tied sign-in to a Google or GitHub
account.

What was built:

- `users.password_hash`, set by `migrations/0002_add_passwords.sql`, and a real
  check in `lib/auth.ts`.
- Hashing with **scrypt** (`lib/password.ts`) rather than argon2id or bcrypt.
  Same family — slow and memory-hard — but built into Node, so there is no
  native addon to compile on the host. On a serverless deployment that
  difference matters. Cost parameters are stored inside each hash, so they can
  be raised later without invalidating anyone's password.
- Sign-up separated from sign-in. `signUp` refuses a name that exists; `signIn`
  refuses one that does not.
- Expired sessions are now purged, opportunistically on sign-in.
- Changing a password ends every *other* session.

`password_hash` is nullable only so bots can exist — the engine's accounts store
no password, and an account without one cannot be signed in to at all.

Still open, and deliberately not built: **password reset.** It needs email, so
it belongs with step 4. Until then a forgotten password means a lost account —
acceptable while the players are people you know, not acceptable once the site
is public.

---

## 2. Player profiles

A page at `/player/<username>` showing:

- Games played, won, lost, drawn
- Current games in progress
- Recent finished games, linking to the replay
- Member since

Mostly a new page over queries that already exist. `listGamesForUser` and
`leaderboard` between them nearly cover it.

Needs from step 1: nothing strictly, but a profile for an account anyone can
impersonate is not worth much.

**Soft-deleted accounts** (`users.deleted_at`) must render as a tombstone —
"this account is closed" — never a broken page. The games stay; the person
does not.

---

## 3. Game review

The single most valuable feature after accounts, and most of it already exists.

Today you can step through history with the arrow keys while viewing a game.
What is missing is that this only works for games you are in, and there is no
way to share or revisit one.

What it needs:

- A finished game should be viewable by anyone with the link, not only its
  players. The data model already supports this; the page does not expose it.
- A move-list export. The wire format (`12|18|24` per move) is already the
  natural record — a plain text or JSON export of a game is a small endpoint.
- Optionally a board image for sharing.

Once the engine exists this becomes *analysis* — the same review screen, with
the engine's opinion of each position. That is the natural home for the work
you have already done on the engine.

---

## 4. Notifications

Correspondence play does not work without them. Someone has to be told it is
their turn, or games stall for days.

Order of implementation:

1. **In-app** — a count of games awaiting your move, in the top bar. Trivial;
   the query exists.
2. **Email** — needs a transactional email provider (Resend's free tier allows
   3,000/month but caps at 100/day, which is the limit to watch).
3. **Web push** — best experience, most complexity. On iOS this only works if
   the site is installed to the home screen as a PWA, and there is no way to
   prompt for that programmatically, so expect meaningful drop-off. Email
   should stay the primary channel.

**Needs a `notifications` table**, not a direct send. A row per pending
notification with a `sent_at`, drained by a job. Sending inline from a request
means a failed email silently loses the notification, and it ties the speed of
a move to the speed of an email server.

---

## 4b. Before anything is public

Small, and none of it optional once strangers can reach the site.

- **Age gate at signup (13+).** COPPA applies to any general-audience site with
  *actual knowledge* it has under-13 users, and a free board game site is
  exactly what a 12-year-old finds. A neutral date-of-birth field and a "13+"
  line in the terms covers the ordinary case. This matters much more if chat
  ships.
- **Privacy policy and terms of service.** California's CalOPPA requires a
  posted privacy policy for sites collecting personal information from its
  residents, wherever the operator is. The terms are what actually protect you:
  "as is", no uptime guarantee, the right to reclaim usernames, and the right
  to shut down or wipe.
- **Audit dependencies for AGPL.** Plain GPL-3.0 imposes *nothing* on a web
  service — copyleft triggers on distributing a copy, and a visitor receives
  rendered HTML, not the program. But an AGPL dependency drags the combination
  under AGPL §13, which *does* oblige you to offer source to every user. Worth
  one check before launch. (Note the reverse: shipping a desktop build would be
  distribution, and the GPL obligations would genuinely apply.)
- **Attribution.** Already in the footer: Gygès was designed by Claude Leroy and
  is published by Blue Orange, and this is an unofficial implementation. Game
  *rules* are not copyrightable, so the mechanics are safe; the name, the
  artwork and the rulebook text are where the exposure is, and all three are
  either original here or credited.

*None of this is legal advice.*

---

## 5. Deploy

Independent of the engine. The site is a real site without it.

- Vercel for the app, Neon for Postgres, NameHero for the domain only.
- The database migration is small but not purely mechanical — the known
  differences are listed at the top of `migrations/0001_initial.sql`.
- **Migrations are already set up** (`migrations/`, `npm run db:migrate`), which
  is the thing that makes a hosted schema change routine rather than
  frightening. Keep writing them: never edit an applied migration.
- **Use a pooled connection string.** Serverless functions each open their own
  database connection, and a traffic spike can exhaust the pool while the app
  itself is fine. Neon provides a pooled URL for exactly this; picking the
  wrong one is the most common way a small Next.js + Postgres site falls over.
- **Primary keys are already time-ordered.** `newId()` puts a millisecond
  timestamp in front of the random half, so inserts append to the end of the
  index rather than scattering through it — which was the page-split and
  write-amplification problem. What remains is that a TEXT key makes every index
  comparison a collation-aware string compare; a native `uuid` column would
  avoid that at the cost of rewriting every foreign key, and is not worth doing
  until it measurably hurts.
- **`listGamesForUser` will be the first slow query.** `WHERE player1_id = ?
  OR player2_id = ?` cannot use one index, so Postgres bitmap-ORs two indexes
  and then sorts every match before applying LIMIT. Invisible at 50 games,
  real at 50,000. Lichess solves this with a denormalised `playerUids` array
  it can index directly; the Postgres equivalent is a generated
  `player_ids TEXT[]` column with a GIN index. Not worth doing until it hurts.

---

## 6. The engine — **DONE**

Both halves, and neither the way this section originally planned.

**6a. Move legality.** Implemented in TypeScript (`lib/game/rules.ts`) and
called directly from `submitMove`, rather than over a bridge to the engine. It
is a port of `MoveGen`, checked against 300 stored positions the engine itself
produced (`tests/engine-parity.test.ts`) and verified against 60,000 random
positions with zero differences.

**6b. Bot play.** The engine is compiled to WebAssembly and searches **in the
player's browser** — no queued job, no second machine, no hosting bill. It keeps
its ordinary UGI interface: a Web Worker writes `setpos`/`go` to stdin and reads
`bestmove` from stdout. Four `cfg`-gated changes to the engine made this
possible; the diff is at `docs/engine-wasm.patch`.

Each strength is an ordinary `users` row, so profiles, history and the
leaderboard work on bots with no special-casing. Play is bounded by node count
rather than time, so the same bot plays the same move on every device.

And, as this section always intended: **the bot's move goes through the same
validation as a human's**. A tampered client cannot make it move out of turn or
play an illegal move.

Still worth doing:

- **A strength dial.** The engine's `randomize` option is all-or-nothing —
  perfect play or a uniformly random move. Sampling from the scored root move
  list by how much worse each move is than the best would give a genuine
  gradient, which is what makes a weak bot fun rather than merely weak. Node
  budgets are the only lever today, and they are a blunt one.
- **Varying the setup arrangement.** Bots always place the conventional
  `321123`, which makes them predictable from move zero.
- **Quantising the network.** 23 MB of the 28 MB download is weights.

---

## 7. Elo ratings

**Deliberately after move validation.** Ranking players is meaningless while
illegal moves are accepted — that is not a technical constraint, it is that the
number would not mean anything.

When it happens:

- A `rating` column on `users`, and a `ratings` history table so a player can
  see their curve.
- Rating changes are computed at game end, inside the same transaction that
  finishes the game, so a rating can never drift from its result.
- **Glicko-2 over plain Elo.** Elo has no notion of confidence, so a new player
  and a veteran with the same number are treated identically. Glicko-2 tracks a
  rating deviation alongside the rating and moves new players faster. It is
  what Lichess uses, and correspondence play — where games are sparse and slow
  — is exactly the case where rating uncertainty matters most.
- Provisional ratings should be shown as such (a `?` suffix) until the
  deviation is low enough.

The current leaderboard (win counts) stays until then. It is honest about being
a tally rather than a ranking.

---

## Smaller things worth doing

Roughly in value order, none of them large:

- **An explore board.** Move a staged move is already halfway there: the board
  can show a position that is not the game's real one. Explore would let a
  player go further — move any piece, try a line out, then throw it away — with
  nothing sent to the server. Since the position is already derived from the
  move list, an exploration is just a local branch that is never submitted, and
  the engine could give an opinion on it for free. The confirm-before-send flow
  was built with this in mind.
- **Draw offers.** The schema already permits `result = 0` with reason
  `'draw'`, but there is no way to offer or accept one. Needs a
  `draw_offered_by` column.
- **Rematch.** A `parent_game_id` on `games`, and a button.
- **Vacation / time bank.** The most-requested correspondence feature on every
  site that has one, because a game spanning weeks *will* catch someone
  travelling. Without it, real games are lost to a timeout nobody wanted.
- **Direct challenges.** Right now games are open to anyone; challenging a
  specific player is a natural want.
- **Move times.** `moves.created_at` exists, so "took 4 hours" is derivable and
  just needs showing.
- **`updated_at` via trigger** rather than set by hand in five places. Miss one
  and the game list sorts wrong.
- **Game list pagination.** Currently capped at 100 with no way to see past it.

---

## Chat

Asked about specifically, so here is the honest cost.

**The building is easy — half a day.** A `messages` table (game id, user id,
text, timestamp), an endpoint to post one, a panel beside the board, and the
existing 5-second poll already picks up new messages for free. Technically it
is the simplest feature left on this list.

**What is not easy is everything after that.** Chat is the one feature whose
cost is mostly not engineering:

- **Moderation.** The moment strangers can type at each other, someone will
  send abuse, and it lands on you to deal with. That means a report button,
  somewhere for reports to go, and a person — you — reading them.
- **Children.** COPPA risk rises sharply with free-text fields, because chat is
  how a child announces they are a child. A game site with chat and no age gate
  is a meaningfully different legal proposition from one without.
- **It never stops.** Unlike a feature that ships and is done, moderation is
  ongoing work for as long as the site is up.

Sequencing that makes it tractable:

1. **Not before real accounts.** Anonymous chat is unmoderatable — banning is
   meaningless when anyone can be anyone.
2. **Between opponents only, at first.** Two people already in a game together
   is a far smaller surface than a public room, and it is the version that
   actually improves correspondence play ("good game", "sorry, travelling").
3. **Canned messages are worth considering first.** A fixed list — "good game",
   "good luck", "thanks", "well played" — gets most of the social value with
   none of the moderation burden. Several correspondence sites do exactly this,
   and it is an afternoon's work.
4. **Free-text later**, with a report button and the ability to mute a player,
   built at the same time rather than after.

**Recommendation:** canned messages soon, free-text between opponents after
accounts exist, and no public chat room. The engineering is the easy part; be
deliberate about signing up for the rest.

---

## Explicitly not doing

- **Live realtime games with a clock.** This is the expensive one — persistent
  connections, clock synchronisation, an always-on server. Correspondence was
  chosen precisely to avoid it, and it is what keeps hosting near free.
- **Public chat rooms.** Per-game chat between opponents is on the list above;
  a lobby-wide room is a moderation commitment with little upside here.
- **Mobile apps.** The site works on a phone browser.

---

## Dependency order

```
play it
   │
   ▼
accounts ──────► profiles
   │                │
   │                ▼
   │           game review ─────────────┐
   │                                    │
   ├──► notifications                   │
   │                                    ▼
   └──► deploy ──► engine: legality ──► elo ratings
                        │
                        └──► engine: bot play
```

The only hard ordering: accounts before anything public, and move validation
before ratings. Everything else can move.
