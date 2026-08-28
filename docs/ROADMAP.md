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

## 1. Real accounts

**Blocks: everything public.** Today any username signs you in as that person.

What it needs:

- A `password_hash` column on `users`, and a real check in `lib/auth.ts`.
  Passwords are never stored — only a slow one-way hash (argon2id or bcrypt),
  so a stolen database still cannot reveal them.
- Sign-up separated from sign-in. Right now they are the same action.
- Sessions already work and do not change.

Open question: passwords, magic links (no password to store, but needs email
working first), or OAuth through Google/GitHub (no password handling at all,
but depends on those accounts). Passwords are the most work and the fewest
dependencies; magic links are the least work *if* email is already solved.

**Session hygiene to fix at the same time:** expired sessions are never purged.
The index exists; the delete does not.

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
  differences are listed at the top of `lib/db/schema.sql`.
- **Migrations are already set up** (`migrations/`, `npm run db:migrate`), which
  is the thing that makes a hosted schema change routine rather than
  frightening. Keep writing them: never edit an applied migration.
- **Use a pooled connection string.** Serverless functions each open their own
  database connection, and a traffic spike can exhaust the pool while the app
  itself is fine. Neon provides a pooled URL for exactly this; picking the
  wrong one is the most common way a small Next.js + Postgres site falls over.
- **Decide the primary-key story before migrating.** Random text ids port
  syntactically but are not free on Postgres: random keys scatter B-tree
  inserts (page splits, write amplification), and a text key makes every index
  comparison a collation-aware string compare. The mature pattern is an
  internal `uuid` v7 primary key plus a short public slug for URLs — which is
  what Lichess does with its 8-character game ids, and pychess-variants with
  its 8-character ids. Changing this after there is real data is far more
  painful than before.
- **`listGamesForUser` will be the first slow query.** `WHERE player1_id = ?
  OR player2_id = ?` cannot use one index, so Postgres bitmap-ORs two indexes
  and then sorts every match before applying LIMIT. Invisible at 50 games,
  real at 50,000. Lichess solves this with a denormalised `playerUids` array
  it can index directly; the Postgres equivalent is a generated
  `player_ids TEXT[]` column with a GIN index. Not worth doing until it hurts.

---

## 6. The engine service

The one genuinely unbuilt piece. See `ARCHITECTURE.md` for the design.

**6a. Move legality.** Add `legalmoves` and `validate` commands to the engine's
UGI interface, make them self-contained (`legalmoves <board> <player>` rather
than relying on a prior `setpos`), and add a `--rules-only` startup mode that
skips the 400 MB transposition table and the neural network — neither is used
by move generation, and skipping them is what makes a fast instance cheap.

Then the web app asks before accepting a move. `lib/engine/client.ts` already
has the shape; the slot in `submitMove` is marked.

Unlocks: ranked play against strangers, and legal-move highlighting while
dragging.

**6b. Bot play.** A search takes seconds and wants a CPU core, so it runs as a
queued job on a second engine instance, not inline with a request. The bot is a
`users` row like any other player, and — importantly — **its move goes through
the same validation as a human's.** Lichess does exactly this: the engine
returns a proposed move and the server validates it like any other.

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
