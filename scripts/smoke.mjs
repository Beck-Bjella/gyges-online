/**
 * End-to-end smoke test against a running dev server.
 *
 * Drives the real HTTP API the way two players would: sign in, create a game,
 * join it, alternate moves, and check that the server enforces turn order and
 * participation. Run with the dev server up:
 *
 *   npm run dev
 *   node scripts/smoke.mjs
 */

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

let failures = 0;

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Sign in via the server action endpoint, returning the session cookie. */
async function signIn(username) {
  const res = await fetch(`${BASE}/api/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
  if (!res.ok) throw new Error(`sign-in failed for ${username}: ${res.status}`);
  const cookie = res.headers.get("set-cookie");
  if (!cookie) throw new Error("no session cookie returned");
  return cookie.split(";")[0];
}

async function api(path, { method = "GET", cookie, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON response, e.g. an HTML error page */
  }
  return { status: res.status, body: json, text };
}

const suffix = Math.floor(Math.random() * 1e6);
const alice = `alice${suffix}`;
const bob = `bob${suffix}`;

console.log("\nGygès smoke test\n");

const aliceCookie = await signIn(alice);
const bobCookie = await signIn(bob);
check("both players can sign in", Boolean(aliceCookie && bobCookie));

// A Secure cookie is only returned over HTTPS. Setting it while serving plain
// http means the browser accepts the session and never sends it back, so every
// page looks signed out. This caught exactly that bug.
{
  const res = await fetch(`${BASE}/api/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: `cookie${suffix}` }),
  });
  const header = res.headers.get("set-cookie") ?? "";
  const isHttps = BASE.startsWith("https://");
  check(
    "the session cookie is usable over this protocol",
    isHttps || !/;\s*Secure/i.test(header),
    "cookie is marked Secure but the site is served over http",
  );
  check("the session cookie is httpOnly", /;\s*HttpOnly/i.test(header));
}

// The session must survive an ordinary page navigation.
{
  const page = await fetch(`${BASE}/`, { headers: { Cookie: aliceCookie } });
  const html = await page.text();
  check(
    "the session persists across pages",
    html.includes(alice),
    "the home page does not show the signed-in user",
  );
  const board = await fetch(`${BASE}/leaderboard`, {
    headers: { Cookie: aliceCookie },
  });
  check(
    "the session persists on another page",
    (await board.text()).includes(alice),
    "the leaderboard does not show the signed-in user",
  );
}

// --- creating and joining --------------------------------------------------

const created = await api("/api/games", {
  method: "POST",
  cookie: aliceCookie,
  body: { moveSeconds: 3600 },
});
check("a game can be created", created.status === 201, `status ${created.status}`);
const gameId = created.body?.game?.id;
check("the new game has an id", Boolean(gameId));

const selfJoin = await api(`/api/games/${gameId}/join`, {
  method: "POST",
  cookie: aliceCookie,
});
check(
  "the creator cannot join their own game",
  selfJoin.status === 400,
  `status ${selfJoin.status}`,
);

const joined = await api(`/api/games/${gameId}/join`, {
  method: "POST",
  cookie: bobCookie,
});
check("a second player can join", joined.status === 200, `status ${joined.status}`);
check("joining starts the game", joined.body?.game?.status === "active");

// --- turn order ------------------------------------------------------------

const wrongTurn = await api(`/api/games/${gameId}/move`, {
  method: "POST",
  cookie: bobCookie,
  body: { move: [35, 29] },
});
check(
  "player 2 cannot move first",
  wrongTurn.status === 409,
  `status ${wrongTurn.status}`,
);

const stranger = await api(`/api/games/${gameId}/move`, {
  method: "POST",
  cookie: undefined,
  body: { move: [0, 6] },
});
check(
  "a signed-out visitor cannot move",
  stranger.status === 401,
  `status ${stranger.status}`,
);

const firstMove = await api(`/api/games/${gameId}/move`, {
  method: "POST",
  cookie: aliceCookie,
  body: { move: [0, 6] },
});
check("player 1 can move", firstMove.status === 200, `status ${firstMove.status}`);
check("the move advances the ply", firstMove.body?.game?.ply === 1);
check("the turn passes to player 2", firstMove.body?.game?.turn === -1);

const twice = await api(`/api/games/${gameId}/move`, {
  method: "POST",
  cookie: aliceCookie,
  body: { move: [1, 7] },
});
check(
  "player 1 cannot move twice in a row",
  twice.status === 409,
  `status ${twice.status}`,
);

const secondMove = await api(`/api/games/${gameId}/move`, {
  method: "POST",
  cookie: bobCookie,
  body: { move: [35, 29] },
});
check("player 2 can reply", secondMove.status === 200, `status ${secondMove.status}`);
check("the ply advances again", secondMove.body?.game?.ply === 2);

// --- structural rejection --------------------------------------------------

const noPiece = await api(`/api/games/${gameId}/move`, {
  method: "POST",
  cookie: aliceCookie,
  body: { move: [20, 21] },
});
check(
  "a move from an empty square is rejected",
  noPiece.status === 400,
  `status ${noPiece.status}`,
);

const onOccupied = await api(`/api/games/${gameId}/move`, {
  method: "POST",
  cookie: aliceCookie,
  body: { move: [1, 2] },
});
check(
  "a simple move onto an occupied square is rejected",
  onOccupied.status === 400,
  `status ${onOccupied.status}`,
);

const garbage = await api(`/api/games/${gameId}/move`, {
  method: "POST",
  cookie: aliceCookie,
  body: { move: "not a move" },
});
check(
  "a malformed move is rejected",
  garbage.status === 400,
  `status ${garbage.status}`,
);

// --- displacement and winning ----------------------------------------------

const displace = await api(`/api/games/${gameId}/move`, {
  method: "POST",
  cookie: aliceCookie,
  body: { move: [1, 2, 12] },
});
check(
  "a displacement is accepted",
  displace.status === 200,
  `status ${displace.status} ${displace.body?.error ?? ""}`,
);

// Player 2 moves a back-row piece into player 1's goal, ending the game.
const winning = await api(`/api/games/${gameId}/move`, {
  method: "POST",
  cookie: bobCookie,
  body: { move: [30, 36] },
});
check("a move into the goal is accepted", winning.status === 200);
check("the game is finished", winning.body?.game?.status === "finished");
check("player 2 is recorded as the winner", winning.body?.game?.result === -1);
check("the reason is recorded", winning.body?.game?.result_reason === "goal");

const afterEnd = await api(`/api/games/${gameId}/move`, {
  method: "POST",
  cookie: aliceCookie,
  body: { move: [2, 8] },
});
check(
  "no moves are accepted after the game ends",
  afterEnd.status === 400,
  `status ${afterEnd.status}`,
);

// --- pages render ----------------------------------------------------------

for (const [name, path] of [
  ["home", "/"],
  ["leaderboard", "/leaderboard"],
  ["rules", "/rules"],
  ["game", `/game/${gameId}`],
  ["player profile", `/player/${alice}`],
]) {
  const res = await fetch(`${BASE}${path}`, { headers: { Cookie: aliceCookie } });
  check(`the ${name} page renders`, res.status === 200, `status ${res.status}`);
}

const missing = await fetch(`${BASE}/game/does-not-exist`);
check(
  "an unknown game returns 404",
  missing.status === 404,
  `status ${missing.status}`,
);

const noPlayer = await fetch(`${BASE}/player/nobody-by-that-name`);
check(
  "an unknown player returns 404",
  noPlayer.status === 404,
  `status ${noPlayer.status}`,
);

// A finished game must be readable by someone who was not in it.
const outsider = await signIn(`nosy${suffix}`);
const spectate = await fetch(`${BASE}/game/${gameId}`, {
  headers: { Cookie: outsider },
});
check(
  "a non-participant can view a finished game",
  spectate.status === 200,
  `status ${spectate.status}`,
);

const profileHtml = await fetch(`${BASE}/player/${alice}`).then((r) => r.text());
check(
  "the profile shows the player's record",
  profileHtml.includes(alice),
  "username missing from the page",
);

// --- resignation -----------------------------------------------------------

const second = await api("/api/games", {
  method: "POST",
  cookie: aliceCookie,
  body: { moveSeconds: 3600 },
});
const gameB = second.body?.game?.id;
await api(`/api/games/${gameB}/join`, { method: "POST", cookie: bobCookie });
const resigned = await api(`/api/games/${gameB}/resign`, {
  method: "POST",
  cookie: aliceCookie,
});
check("a player can resign", resigned.status === 200, `status ${resigned.status}`);
check("resigning awards the opponent the win", resigned.body?.game?.result === -1);
check(
  "the resignation is recorded",
  resigned.body?.game?.result_reason === "resign",
);

console.log(
  failures === 0
    ? "\nAll smoke checks passed.\n"
    : `\n${failures} smoke check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
