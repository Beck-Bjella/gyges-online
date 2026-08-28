# Running it: your machine, your network, and a real server

Three ways this same application can run, from most local to most public.
Nothing about the code changes between them — only where it runs and what can
reach it.

---

## 1. Just you

```sh
npm run dev
```

Open <http://localhost:3000>. `localhost` means *this machine only* — nothing
else on your network, and certainly nothing on the internet, can reach it.

---

## 2. You and someone else on the same wifi

This is how to play a real game against another person on your home network
before anything is deployed.

```sh
npm run dev:lan
```

The only difference is `--hostname 0.0.0.0`, which means "accept connections
from anywhere on the network" instead of only from this machine.

### Find your address

```sh
ipconfig
```

Look for **IPv4 Address** under your Wi-Fi or Ethernet adapter — something like
`192.168.1.11`. That is your machine's name on the local network.

### Open the firewall (once, as Administrator)

Windows blocks incoming connections by default, so the other computer will not
be able to connect until you allow the port. Open **PowerShell as
Administrator** (right-click → Run as administrator) and run:

```powershell
New-NetFirewallRule -DisplayName "Gyges Dev Server" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow -Profile Private
```

`-Profile Private` limits this to networks Windows considers private (your home
wifi), not public ones. To remove it later:

```powershell
Remove-NetFirewallRule -DisplayName "Gyges Dev Server"
```

### The other person visits

On the other computer, in a browser:

```
http://192.168.1.11:3000
```

(substituting whatever `ipconfig` reported). They sign in with their own name
and you play a real game — two people, two computers, one shared database.

### What is happening

```
Your PC                                  Their PC
┌──────────────────────────┐
│  node (Next.js)          │             ┌─────────────┐
│    port 3000  ───────────┼── wifi ─────┤  browser    │
│    .data/gyges.db        │             └─────────────┘
└──────────────────────────┘
```

Your computer is the server. Theirs is just a browser. The database is still
the single file on your machine, and both of you are reading and writing it
through the same Node process.

### Caveats

- **Your machine must stay on and awake.** Close the terminal or sleep the
  laptop and the site disappears for both of you.
- **Same network only.** This does not work from a coffee shop or their house
  unless you set up a tunnel (see below).
- **Still no passwords.** Anyone on your wifi can sign in as anyone. Fine for
  family; not fine in public.

### If they are not on your wifi

A tunnel service gives you a temporary public URL pointing at your machine:

```sh
npx localtunnel --port 3000
```

It prints a URL anyone can open. Convenient for a quick test, but it is a real
public address with no passwords behind it — use it briefly and stop it after.

---

## 3. A real server

The difference between "running on your PC" and "hosted" is smaller than it
sounds. The same Node application runs; it just runs on a rented computer that
is always on, with a domain name pointing at it.

### What changes

| | Your PC now | Hosted later |
|---|---|---|
| Where the app runs | `npm run dev` in your terminal | Vercel, always on |
| Who can reach it | you, or your wifi | anyone, via your domain |
| Database | SQLite file in `.data/` | Neon Postgres, over the network |
| Uptime | while your terminal is open | continuous |
| Address | `localhost:3000` | `yourdomain.com` |

### What does not change

The pages, the board, the game logic, the API routes, the schema. Deploying is
not a rewrite — it is the same program, somewhere else.

The one real code change is the database connection. Locally the app opens a
file; hosted, it connects to Postgres over the network. That is why
`lib/db/schema.sql` is deliberately restricted to SQL both understand: the
tables, columns, and constraints port as-is, and only `lib/db/index.ts` and the
query calls need adapting.

### The pieces, once deployed

```
   Browser
      │  yourdomain.com
      ▼
┌──────────────┐
│  DNS         │  NameHero: "that name lives at Vercel"
└──────────────┘
      │
      ▼
┌──────────────┐        ┌──────────────┐
│  Vercel      │───────▶│  Neon        │  accounts, games, moves
│  the app     │        │  Postgres    │
└──────────────┘        └──────────────┘
      │
      ▼
┌──────────────┐
│  Engine      │  legality now, bot moves later
│  service     │
└──────────────┘
```

---

## Where the engine process fits

This is the part that has no equivalent in what runs today, because it has not
been built yet.

**Today** there is exactly one program: the Node process. It serves pages,
handles moves, and reads the database. Nothing checks whether a move is legal.

**Once the engine is connected** there are two programs:

```
┌─────────────────────────┐        ┌──────────────────────────┐
│  The web app (Node)     │        │  The engine service      │
│                         │        │                          │
│  • pages                │  HTTP  │  • a thin bridge         │
│  • accounts, sessions   │───────▶│      ↕ stdin/stdout      │
│  • the game record      │◀───────│  • gyges_engine.exe      │
│  • talks to the database│        │                          │
└─────────────────────────┘        └──────────────────────────┘
```

The web app does not contain the rules. When a move arrives it asks the engine
service "is this legal?", and only writes the move if the answer is yes. Later,
for a bot game, it asks "what move should you play?" and records the reply.

The engine service is a small program you write that:

1. Starts `gyges_engine.exe` as a child process, exactly as the old desktop UIs
   did.
2. Exposes HTTP endpoints (`/legal-moves`, `/validate`, `/bot-move`).
3. Translates an HTTP request into UGI text on the engine's stdin, reads the
   reply from its stdout, and returns it as JSON.

That is the whole job — a translator between HTTP and the text protocol the
engine already speaks.

### Why it is separate

Not because of the languages. Because the two jobs have opposite shapes:

| | The web app | The engine |
|---|---|---|
| A request takes | milliseconds | seconds, for a bot search |
| Wants | many concurrent requests | a whole CPU core to itself |
| Can run serverless | yes | no — needs threads and time |

Vercel functions are bounded and short-lived, which suits pages and move
submissions and does not suit a multi-second search. So the engine needs an
ordinary always-on host (Railway or Fly, roughly $2-5/mo) while the web app
stays on Vercel.

This is the same split Lichess uses: `scalachess` for rules, Stockfish
elsewhere entirely. See `ARCHITECTURE.md`.

### Running the engine locally

When it exists, local development will mean two terminals:

```sh
# terminal 1
npm run dev

# terminal 2
cd ../engine-service && cargo run
```

The web app reaches it at `GYGES_ENGINE_URL` (see `.env.example`). Same shape as
production, just both processes on your machine instead of two rented ones.

---

## Order of work

1. **Now** — play over the LAN, find what feels wrong.
2. **Real accounts** — passwords or magic links. Required before anyone outside
   your home can reach it.
3. **Deploy** — Vercel plus Neon, swap SQLite for Postgres, point the domain.
4. **Engine service** — move legality first, bot play after.

Steps 2 and 3 are independent of step 4. The site is a real site without the
engine; it just does not enforce the rules yet.
