# Gygès Online

An online site for playing [Gygès](https://en.wikipedia.org/wiki/Gyges_(board_game))
asynchronously against other players — correspondence-style, in the spirit of
Board Game Arena.

## Running it locally

Requires Node.js 20 or newer (developed on 24).

```sh
npm install
npm run dev
```

Then open <http://localhost:3000>. The database is created automatically at
`.data/gyges.db` on first request — there is nothing to install or configure.

Sign in with any username to claim it. To play a full game against yourself,
open a second browser profile (or a private window) and sign in as someone else.

### Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Development server with hot reload |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm test` | Unit tests (board module and game flow) |
| `npm run smoke` | End-to-end test against a running server |
| `npm run typecheck` | TypeScript with no emit |
| `npm run db:reset` | Delete the local database and start fresh |

`npm run smoke` needs a server already running; it drives the real HTTP API as
two players would — sign in, create, join, alternate moves, resign — and checks
that the server enforces turn order and participation.

## What works today

- **Accounts** — claim a username; sessions in an httpOnly cookie.
- **Games** — create an open game with a time control, join someone else's.
- **Play** — drag pieces on an SVG board; displacement moves supported.
- **Server authority** — the server owns turn order, the move record, and game
  termination. It rejects moves from non-participants, out-of-turn moves, and
  structurally incoherent ones.
- **History** — every move is stored; step back through a game with the arrow
  keys or by clicking the move list.
- **Endings** — reaching the opponent's goal, resignation, and forfeit on time.
- **Leaderboard** — win/loss counts across finished games.

## What is deliberately missing

- **Move legality is not enforced.** The board accepts any structurally valid
  move; nothing checks the rules of Gygès. This is a documented choice — see
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Rules arrive with the engine
  service, and ranked play should wait for them.
- **No passwords.** Anyone who knows a username can sign in as them. Fine
  locally; must be replaced before the site is public.
- **No notifications.** Correspondence play needs "it's your turn" email; not
  built yet.
- **No bot.** Playing the [Gygès engine](https://github.com/Beck-Bjella/Gyges)
  is a later feature.

## How it is put together

```
app/          Next.js routes — pages and API endpoints
components/   React components, including the SVG board
lib/
  game/       board encoding, geometry, move format — pure, no I/O
  db/         schema and queries; the server-side rules of engagement
  auth.ts     sessions
tests/        unit tests
scripts/      smoke test and database reset
docs/         architecture and board reference
```

`lib/game/` imports nothing from the framework or the database, so the same code
runs in the browser and on the server. That boundary is what will let the
engine's move validation slot in later without a rewrite.

Games are stored as an **ordered list of moves**, not as board snapshots. The
current position is derived by replaying them, which is what makes replay,
history, and later re-validation straightforward.

Local development uses SQLite; the schema sticks to a subset that ports to
PostgreSQL for production.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the design and its reasoning:
  server authority, where the rules live, hosting, and costs.
- [docs/BOARD_REFERENCE.md](docs/BOARD_REFERENCE.md) — board topology, piece
  encoding, move format, notation, geometry, and colour tokens.

## History

This repository previously held desktop clients for the Gygès engine
(macroquad, Slint, Tauri). They were removed to make room for the web
application; the original macroquad app remains in git history at commit
`82db53c`.

## License

GNU General Public License v3.0. See [LICENSE](LICENSE).
