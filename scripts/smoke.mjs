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

/**
 * The password every account in this run uses.
 *
 * The smoke test creates throwaway accounts on a development server, so one
 * shared value is fine and keeps the checks readable. Nothing here is a
 * credential worth protecting.
 */
const PASSWORD = "smoke-test-password";

/** Create an account via the API, returning the session cookie. */
async function signUp(username, password = PASSWORD) {
  const res = await fetch(`${BASE}/api/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, signup: true }),
  });
  if (!res.ok) throw new Error(`sign-up failed for ${username}: ${res.status}`);
  const cookie = res.headers.get("set-cookie");
  if (!cookie) throw new Error("no session cookie returned");
  return cookie.split(";")[0];
}

/** Sign in to an existing account, returning the session cookie. */
async function signIn(username, password = PASSWORD) {
  const res = await fetch(`${BASE}/api/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`sign-in failed for ${username}: ${res.status}`);
  const cookie = res.headers.get("set-cookie");
  if (!cookie) throw new Error("no session cookie returned");
  return cookie.split(";")[0];
}

/** Attempt a sign-in and report the status, without throwing. */
async function trySignIn(username, password) {
  const res = await fetch(`${BASE}/api/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return { ok: res.ok, status: res.status };
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

const aliceCookie = await signUp(alice);
const bobCookie = await signUp(bob);
check("both players can create an account", Boolean(aliceCookie && bobCookie));

// --- passwords ------------------------------------------------------------
//
// The point of the whole exercise: knowing a username is no longer enough.
{
  const wrong = await trySignIn(alice, "not the right password");
  check("a wrong password is refused", !wrong.ok, `status ${wrong.status}`);

  const empty = await trySignIn(alice, "");
  check("an empty password is refused", !empty.ok, `status ${empty.status}`);

  const right = await trySignIn(alice, PASSWORD);
  check("the right password is accepted", right.ok, `status ${right.status}`);

  const ghost = await trySignIn(`nobody${suffix}`, PASSWORD);
  check("an unknown username is refused", !ghost.ok, `status ${ghost.status}`);

  // Signing up for a name that exists must fail rather than silently signing in.
  const dupe = await fetch(`${BASE}/api/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: alice, password: PASSWORD, signup: true }),
  });
  check("signing up with a taken username is refused", !dupe.ok, `status ${dupe.status}`);

  // Too short: the one content rule there is.
  const weak = await fetch(`${BASE}/api/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: `weak${suffix}`, password: "short", signup: true }),
  });
  check("a too-short password is refused at sign-up", !weak.ok, `status ${weak.status}`);

  // A sign-in with no password field at all is malformed, not a sign-in.
  const missing = await fetch(`${BASE}/api/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: alice }),
  });
  check("a request with no password is rejected", !missing.ok, `status ${missing.status}`);
}

// A Secure cookie is only returned over HTTPS. Setting it while serving plain
// http means the browser accepts the session and never sends it back, so every
// page looks signed out. This caught exactly that bug.
{
  const res = await fetch(`${BASE}/api/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: `cookie${suffix}`,
      password: PASSWORD,
      signup: true,
    }),
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
  const page = await fetch(`${BASE}/dashboard`, { headers: { Cookie: aliceCookie } });
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
check("joining begins setup", joined.body?.game?.status === "setup");

// --- setup: each player arranges their home row before play ---------------

const STANDARD = [3, 2, 1, 1, 2, 3];

// A complete legal game, verified against lib/game/rules.ts (which is itself
// verified against the Rust engine's move generator). Moves here must be LEGAL,
// not merely well-formed: the server enforces the rules of Gygès.
//
//   P1 0|18   the three-ring piece on 0 travels exactly three squares
//   P2 30|19  likewise for player 2
//   P1 2|1|0  a displacement: land on 1, push its occupant to the vacated 0
//   P2 31|36  into player 1's goal, which player 2 wins by reaching
const P1_FIRST = [0, 18];
const P2_FIRST = [30, 19];
const P1_DISPLACE = [2, 1, 0];
const P2_WINNING = [31, 36];

const earlyMove = await api(`/api/games/${gameId}/move`, {
  method: "POST",
  cookie: aliceCookie,
  body: { move: P1_FIRST },
});
check(
  "no moves are accepted before both players have placed",
  earlyMove.status === 400,
  `status ${earlyMove.status}`,
);

const outOfTurnSetup = await api(`/api/games/${gameId}/setup`, {
  method: "POST",
  cookie: bobCookie,
  body: { arrangement: STANDARD },
});
check(
  "player 2 cannot place first",
  outOfTurnSetup.status === 409,
  `status ${outOfTurnSetup.status}`,
);

const badSetup = await api(`/api/games/${gameId}/setup`, {
  method: "POST",
  cookie: aliceCookie,
  body: { arrangement: [3, 3, 3, 3, 3, 3] },
});
check(
  "an arrangement must use each piece once",
  badSetup.status === 400,
  `status ${badSetup.status}`,
);

// The version probe is what drives auto-refresh. It must change during setup,
// not only during play: waiting for an opponent to place their pieces is
// exactly when the page needs to update itself.
const versionBefore = await api(`/api/games/${gameId}/version`);
check(
  "the version probe works during setup",
  versionBefore.status === 200 && versionBefore.body?.status === "setup",
  `status ${versionBefore.status}`,
);

const setup1 = await api(`/api/games/${gameId}/setup`, {
  method: "POST",
  cookie: aliceCookie,
  body: { arrangement: STANDARD },
});
check("player 1 can place", setup1.status === 200, `status ${setup1.status}`);
check("still in setup after one placement", setup1.body?.game?.status === "setup");

const versionAfterP1 = await api(`/api/games/${gameId}/version`);
check(
  "placing pieces changes the version probe",
  versionAfterP1.body?.ply !== versionBefore.body?.ply,
  `ply ${versionBefore.body?.ply} -> ${versionAfterP1.body?.ply}`,
);

const setup2 = await api(`/api/games/${gameId}/setup`, {
  method: "POST",
  cookie: bobCookie,
  body: { arrangement: STANDARD },
});
check("player 2 can place", setup2.status === 200, `status ${setup2.status}`);
check("play begins once both have placed", setup2.body?.game?.status === "active");
check("player 1 moves first", setup2.body?.game?.turn === 1);

const versionAfterP2 = await api(`/api/games/${gameId}/version`);
check(
  "finishing setup changes the probe's status",
  versionAfterP2.body?.status === "active" &&
    versionAfterP1.body?.status === "setup",
  `${versionAfterP1.body?.status} -> ${versionAfterP2.body?.status}`,
);

// --- turn order ------------------------------------------------------------

const wrongTurn = await api(`/api/games/${gameId}/move`, {
  method: "POST",
  cookie: bobCookie,
  body: { move: P2_FIRST },
});
check(
  "player 2 cannot move first",
  wrongTurn.status === 409,
  `status ${wrongTurn.status}`,
);

const stranger = await api(`/api/games/${gameId}/move`, {
  method: "POST",
  cookie: undefined,
  body: { move: P1_FIRST },
});
check(
  "a signed-out visitor cannot move",
  stranger.status === 401,
  `status ${stranger.status}`,
);

const firstMove = await api(`/api/games/${gameId}/move`, {
  method: "POST",
  cookie: aliceCookie,
  body: { move: P1_FIRST },
});
check("player 1 can move", firstMove.status === 200, `status ${firstMove.status}`);
check("the move advances the ply", firstMove.body?.game?.ply === 3);
check("the turn passes to player 2", firstMove.body?.game?.turn === -1);

const twice = await api(`/api/games/${gameId}/move`, {
  method: "POST",
  cookie: aliceCookie,
  body: { move: [1, 13] },
});
check(
  "player 1 cannot move twice in a row",
  twice.status === 409,
  `status ${twice.status}`,
);

const secondMove = await api(`/api/games/${gameId}/move`, {
  method: "POST",
  cookie: bobCookie,
  body: { move: P2_FIRST },
});
check("player 2 can reply", secondMove.status === 200, `status ${secondMove.status}`);
check("the ply advances again", secondMove.body?.game?.ply === 4);

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
  body: { move: P1_DISPLACE },
});
check(
  "a displacement is accepted",
  displace.status === 200,
  `status ${displace.status} ${displace.body?.error ?? ""}`,
);

// Player 2 moves into player 1's goal — the space beyond player 1's home row,
// which is what player 2 wins by reaching — ending the game.
const winning = await api(`/api/games/${gameId}/move`, {
  method: "POST",
  cookie: bobCookie,
  body: { move: P2_WINNING },
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

// --- playing the engine ----------------------------------------------------
//
// The search itself runs in the browser, so what is checked here is the part
// the server owns: that a bot game can be created, that the engine's home row
// is placed, that only a participant may drive it, and — the property that
// matters most — that a move claimed to be the engine's is validated exactly
// like a human's.
{
  const bots = await api("/api/bots");
  const bot = bots.body?.bots?.[0];
  check("the engine's accounts are listed", Boolean(bot), JSON.stringify(bots.body));

  if (bot) {
    const made = await api("/api/games", {
      method: "POST",
      cookie: aliceCookie,
      body: { moveSeconds: 3600, botId: bot.id },
    });
    check("a game against the engine can be created", made.status === 201, `status ${made.status}`);
    const botGameId = made.body?.game?.id;
    check("it starts in setup with both seats filled", made.body?.game?.status === "setup");

    // A stranger must not be able to drive someone else's engine.
    const outsiderDrive = await api(`/api/games/${botGameId}/bot-move`, {
      method: "POST",
      cookie: bobCookie,
    });
    check(
      "a non-participant cannot drive the engine",
      outsiderDrive.status === 403,
      `status ${outsiderDrive.status}`,
    );

    // It is the human's turn first, so the engine has nothing to do yet.
    const tooEarly = await api(`/api/games/${botGameId}/bot-move`, {
      method: "POST",
      cookie: aliceCookie,
    });
    check(
      "the engine will not act out of turn",
      tooEarly.status === 409,
      `status ${tooEarly.status}`,
    );

    await api(`/api/games/${botGameId}/setup`, {
      method: "POST",
      cookie: aliceCookie,
      body: { arrangement: STANDARD },
    });

    const placed = await api(`/api/games/${botGameId}/bot-move`, {
      method: "POST",
      cookie: aliceCookie,
    });
    check("the engine places its home row", placed.status === 200, `status ${placed.status}`);
    check("play begins once both have placed", placed.body?.game?.status === "active");

    // Now the human moves, so it becomes the engine's turn.
    await api(`/api/games/${botGameId}/move`, {
      method: "POST",
      cookie: aliceCookie,
      body: { move: P1_FIRST },
    });

    const plan = await api(`/api/games/${botGameId}/bot-move`, {
      method: "POST",
      cookie: aliceCookie,
    });
    check("the server says what the engine should search", plan.status === 200 && !plan.body?.done);
    check(
      "the position is handed over as 38 digits",
      typeof plan.body?.board === "string" && /^[0-9]{38}$/.test(plan.body.board),
    );
    check(
      "the engine's node budget travels with it",
      typeof plan.body?.options?.maxNodes === "number",
      JSON.stringify(plan.body?.options),
    );

    // The security property: the browser runs the engine, so it could claim
    // anything. An illegal move must be refused exactly as a human's would be.
    const cheat = await api(`/api/games/${botGameId}/bot-move`, {
      method: "POST",
      cookie: aliceCookie,
      body: { move: "0|37" },
    });
    check(
      "an illegal move attributed to the engine is refused",
      cheat.status === 400,
      `status ${cheat.status} ${cheat.body?.error ?? ""}`,
    );
  }
}

// --- pages render ----------------------------------------------------------

for (const [name, path] of [
  ["home", "/"],
  ["games", "/games"],
  ["dashboard", "/dashboard"],
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

// Signed out, the front page is the pitch; signed in, it redirects to the
// dashboard rather than showing a second, worse version of it.
{
  const anon = await fetch(`${BASE}/`, { redirect: "manual" });
  check("the landing page renders for a visitor", anon.status === 200);

  const signedIn = await fetch(`${BASE}/`, {
    headers: { Cookie: aliceCookie },
    redirect: "manual",
  });
  check(
    "a signed-in visitor is sent to the dashboard",
    signedIn.status === 307 || signedIn.status === 302,
    `status ${signedIn.status}`,
  );

  const noDash = await fetch(`${BASE}/dashboard`, { redirect: "manual" });
  check(
    "the dashboard is not reachable signed out",
    noDash.status === 307 || noDash.status === 302,
    `status ${noDash.status}`,
  );

  const anonGames = await fetch(`${BASE}/games`);
  check(
    "the games lobby is public",
    anonGames.status === 200,
    `status ${anonGames.status}`,
  );
}

// A finished game must be readable by someone who was not in it.
const outsider = await signUp(`nosy${suffix}`);
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
await api(`/api/games/${gameB}/setup`, {
  method: "POST",
  cookie: aliceCookie,
  body: { arrangement: STANDARD },
});
await api(`/api/games/${gameB}/setup`, {
  method: "POST",
  cookie: bobCookie,
  body: { arrangement: STANDARD },
});
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
