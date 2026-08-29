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

Create an account with a username and a password. To play a full game against
yourself, open a second browser profile (or a private window) and create a
second account.

### Playing with someone else on your wifi

```sh
npm run dev:lan
```

Then find your address with `ipconfig` (look for **IPv4 Address**, e.g.
`192.168.1.11`) and, once, allow the port through the firewall from an
**Administrator** PowerShell:

```powershell
New-NetFirewallRule -DisplayName "Gyges Dev Server" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow -Profile Private
```

The other person opens `http://192.168.1.11:3000`. Your computer is the server;
your machine must stay awake. Full details, plus how this maps to real hosting,
are in [docs/RUNNING.md](docs/RUNNING.md).

### Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Development server with hot reload |
| `npm run dev:lan` | Same, but reachable by other machines on your network |
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

- **Accounts** — username and password, hashed with scrypt; sessions in an
  httpOnly cookie.
- **Move legality** — the server enforces the rules of Gygès and rejects
  anything they do not allow. The browser marks legal destinations while you
  drag, from the same shared module.
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

- **No notifications.** Correspondence play needs "it's your turn" email; not
  built yet.
- **No bot.** Playing the [Gygès engine](https://github.com/Beck-Bjella/Gyges)
  is a later feature. Unlike move legality, a search genuinely needs a CPU core
  and a persistent process, so it belongs on its own machine — see
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- **No ratings.** The leaderboard counts wins. Glicko-2 is planned; see
  [docs/ROADMAP.md](docs/ROADMAP.md).

## How it is put together

```
app/          Next.js routes — pages and API endpoints
components/   React components, including the SVG board
lib/
  game/       pure, no I/O
    board.ts    encoding, geometry, move format
    rules.ts    move legality — the rules of Gygès
  db/         schema and queries; the server-side rules of engagement
  auth.ts     sessions and sign-in
  password.ts scrypt hashing
tests/        unit tests
scripts/      smoke test and database reset
docs/         architecture and board reference
```

`lib/game/` imports nothing from the framework or the database, so the same code
runs in the browser and on the server. That boundary is what lets one
implementation of the rules serve as both the server's authority and the
browser's move highlighting, with no duplication and no network round trip.

Games are stored as an **ordered list of moves**, not as board snapshots. The
current position is derived by replaying them, which is what makes replay,
history, and later re-validation straightforward.

Local development uses SQLite; the schema sticks to a subset that ports to
PostgreSQL for production.

## Documentation

- [docs/RUNNING.md](docs/RUNNING.md) — running it locally, over your network,
  and on a real server; and where the engine process fits in.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the design and its reasoning:
  server authority, where the rules live, hosting, and costs.
- [docs/BOARD_REFERENCE.md](docs/BOARD_REFERENCE.md) — board topology, piece
  encoding, move format, notation, geometry, and colour tokens.

## History

This repository was once **GygesUI**, a set of desktop clients for the Gygès
engine (macroquad, Slint, Tauri). It is now the website, and was renamed to
match. Those clients were removed to make room for it; the original macroquad
app remains in git history at commit `82db53c`.

The engine itself lives in its own project,
[Beck-Bjella/Gyges](https://github.com/Beck-Bjella/Gyges), and is not part of
this repository.

## License

GNU General Public License v3.0. See [LICENSE](LICENSE).
