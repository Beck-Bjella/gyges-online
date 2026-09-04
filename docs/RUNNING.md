# Running it: your machine, your network, and the real server

Three ways this same application runs, from most local to most public — the
third being https://gyges.app, where it is live. Nothing about the code
changes between them — only where it runs and what can reach it.

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

### Production mode over the LAN

`npm run dev:lan` is the *development* server: hot reload, the Next.js dev-tools
badge in the corner, unoptimised code. To test what people will actually get:

```sh
npm run build
npm run start:lan
```

Same address, same port. The difference is that the code is compiled and
optimised, there is no dev badge, and pages render faster. This is the closest
thing to the deployed site you can run at home, and it is worth using for any
real play-testing.

The trade-off is that `npm run build` must be re-run after every code change —
there is no hot reload in production mode.

`start:lan` also turns **off** the `Secure` flag on the session cookie, via
`GYGES_INSECURE_COOKIES=1`. This is necessary and worth understanding: a Secure
cookie is only ever sent back over HTTPS, so serving a production build over a
plain `http://` LAN address means the browser accepts the session and then never
returns it. Sign-in appears to work and every page afterwards looks signed out.

A real deployment serves HTTPS and keeps the flag on. **Never set
`GYGES_INSECURE_COOKIES` in production** — it would let a session cookie travel
unencrypted.

### Phones and tablets

The site works on a phone on the same wifi: open `http://192.168.1.11:3000`
in the phone's browser.

- The layout collapses to a single column below 900px wide.
- Below 640px the board goes edge-to-edge so the pieces stay big enough to hit
  with a finger.
- Dragging works by touch. The board sets `touch-action: none`, which stops the
  browser scrolling or zooming the page while a finger is on the board.

Worth testing on a real phone rather than trusting the browser's device
emulator — finger accuracy on the smaller pieces is the thing most likely to
need adjusting, and only a real thumb will tell you.

### If they are not on your wifi

A tunnel service gives you a temporary public URL pointing at your machine:

```sh
npx localtunnel --port 3000
```

It prints a URL anyone can open. Convenient for a quick test, but it is a real
public address with no passwords behind it — use it briefly and stop it after.

---

## 3. The real server

This is https://gyges.app: a $5 Lightsail instance (Ubuntu, 512 MB plus the
2 GB swap file the setup script creates), provisioned once by
`deploy/setup.sh` and updated ever after with one command. The full runbook —
first-time setup, backups, restores, the things that bite — is
`deploy/README.md`.

### Publishing a change

```sh
# on this machine: commit and push as usual
git push

# on the server (Lightsail's browser SSH button):
bash ~/gyges-online/deploy/deploy.sh
```

The deploy pulls, rebuilds, and restarts — in that order on purpose: the old
version keeps serving until the new build has succeeded, so a broken build
never takes the site down. Database migrations apply themselves when the app
starts, and the database itself is never touched by a deploy.

### What differs from your PC

| | Your PC | gyges.app |
|---|---|---|
| Where the app runs | `npm run dev` in your terminal | `npm start` under systemd, restarted on crash or reboot |
| Who can reach it | you, or your wifi | anyone |
| Database | SQLite file in `.data/` | the same kind of file, at `/var/lib/gyges/gyges.db` |
| HTTPS | none (dev is plain http) | Caddy, with a Let's Encrypt certificate it renews itself |
| Uptime | while your terminal is open | continuous |

### What does not change

The pages, the board, the game logic, the API routes, the schema — and the
database. Deploying is not a rewrite and not a port: it is the same program,
reading the same kind of file, somewhere else. `GYGES_DB_PATH` points it at a
path on the server instead of `.data/`, and that is the whole of the
difference.

This is why the host has to be an ordinary always-on machine rather than a
serverless platform: serverless gives each request a fresh process with a blank
disk, and a database that lives in a file needs a disk that persists. See
ARCHITECTURE.md under "Hosting".

### The pieces, once deployed

```
   Browser  ── plays the bots itself: the engine is wasm, in the page
      │  gyges.app
      ▼
┌──────────────┐
│  DNS         │  a Lightsail zone: "gyges.app lives at the static IP"
└──────────────┘   (the registrar holds the name and points here)
      │
      ▼
┌─────────────────────────────────────┐
│  One Linux box (Lightsail, $5)      │
│                                     │
│   Caddy  ──▶  Next.js  ──▶  gyges.db│  accounts, games, moves
│   TLS         :3000        on disk  │
└─────────────────────────────────────┘
      │
      ▼
┌──────────────┐
│  S3          │  nightly copy of the file (cron, once configured)
└──────────────┘
```

---

## Where the engine fits

**There is no engine process to host.** Two things that were once expected to
need one are both handled without a second program:

**Move legality** is in the web app itself (`lib/game/rules.ts`). It is a
bounded walk over 36 squares rather than a search, so it costs microseconds and
belongs in the request that submits the move.

**Bot moves** are searched by the engine compiled to WebAssembly, running in the
player's own browser:

```
┌─────────────────────────┐        ┌──────────────────────────────┐
│  The web app (Node)     │        │  The player's browser        │
│                         │  HTTP  │                              │
│  • pages                │───────▶│  • the board                 │
│  • accounts, sessions   │◀───────│  • gyges_engine.wasm         │
│  • the game record      │        │      ↕ stdin/stdout (WASI)   │
│  • the rules of Gygès   │        │    in a Web Worker           │
└─────────────────────────┘        └──────────────────────────────┘
```

The worker writes UGI commands to the module's stdin and reads `bestmove` from
its stdout — the engine's real interface, unchanged from the desktop binary. The
server hands over a position, and validates whatever comes back exactly as it
validates a human's move.

### Why this is better than a service

The original plan was an always-on box running the engine behind HTTP, at
roughly $2-5/mo. Running it in the browser instead means:

- **No compute to pay for**, and no second host to keep alive.
- **No engine downtime.** There is no process that can be down.
- **It scales for free** — every player brings their own CPU.

The cost is a 28 MB download on a player's first visit, cached afterwards, and
that a slow device waits longer for a move. Because bots are bounded by node
count rather than seconds, waiting longer does not mean facing a stronger
opponent: the move is identical either way.

Note this differs from Lichess, which runs Stockfish server-side for analysis
and hands bot play to operators running their own hardware. It is available here
because this engine is small and self-contained enough to ship whole.

### Running the engine locally

Nothing to run — it is part of the page. `public/engine/gyges_engine.wasm` is
served like any other static file, so local development is one terminal.

Rebuilding it is a separate job in the engine repository, which carries the
`cfg` blocks that make it compile for the web.

---

## Debugging the live site

Everything below runs in the server's SSH session:

```sh
systemctl status gyges        # is it running
journalctl -u gyges -f        # what it is saying (Ctrl+C to stop watching)
journalctl -u caddy -n 50     # certificate trouble lives here
npm run db:migrate -- --status  # which migrations the live database has
```

Two lessons from launch night worth keeping: the browser SSH session dies
when idle, and a dying session kills whatever it was running — so keep the tab
awake during deploys, and know that `setup.sh` and `deploy.sh` are both safe
to simply run again. And when something network-ish fails silently, re-run the
failing command loudly (without its quiet flags) before theorising: the mirror
outage that stalled the first deploy was obvious the moment apt was allowed to
speak.
