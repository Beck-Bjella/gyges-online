/**
 * Tests for handing a position to the engine and reading its answer back.
 *
 * The engine searches for player 1 unconditionally, so a position where player
 * 2 is to move is flipped on the way in and the move flipped back on the way
 * out. Getting that wrong would not crash anything — it would silently make the
 * bot play a mirrored, usually illegal, move, which the server would then
 * reject with a confusing message. Hence these.
 *
 * Run with: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const { boardForEngine, moveFromEngine, boardToEngineString, BOT_SETUP, botSetup } =
  await import("../lib/game/engine.ts");
const { startingBoard, emptyBoard, flipBoard, isValidSetup, P1_GOAL, P2_GOAL } =
  await import("../lib/game/board.ts");
const { checkMoveLegality, legalMoves } = await import("../lib/game/rules.ts");

test("player 1 hands the board over unchanged", () => {
  const board = startingBoard();
  assert.deepEqual(boardForEngine(board, 1), board);
});

test("player 2 hands the board over flipped", () => {
  const board = startingBoard();
  assert.deepEqual(boardForEngine(board, -1), flipBoard(board));
});

test("the engine's wire form is 38 digits", () => {
  const s = boardToEngineString(startingBoard());
  assert.equal(s.length, 38);
  assert.match(s, /^[0-9]{38}$/);
});

test("a move for player 1 comes back unchanged", () => {
  assert.deepEqual(moveFromEngine("0|13", 1), [0, 13]);
  assert.deepEqual(moveFromEngine("2|1|0", 1), [2, 1, 0]);
});

test("a move for player 2 is flipped back into board space", () => {
  // flipMove maps i -> 35 - i on the grid, so 0|13 becomes 35|22.
  assert.deepEqual(moveFromEngine("0|13", -1), [35, 22]);
  assert.deepEqual(moveFromEngine("2|1|0", -1), [33, 34, 35]);
});

test("goals survive the flip", () => {
  // The engine, playing as player 1 in flipped space, bears off into P2_GOAL.
  // Flipped back for the real player 2, that must be P1_GOAL — the space beyond
  // player 1's home row, which is what player 2 wins by reaching.
  assert.deepEqual(moveFromEngine(`24|${P2_GOAL}`, -1), [11, P1_GOAL]);
  assert.deepEqual(moveFromEngine(`24|${P2_GOAL}`, 1), [24, P2_GOAL]);
});

test("a drawn position yields no move rather than a bad one", () => {
  assert.equal(moveFromEngine("null", 1), null);
  assert.equal(moveFromEngine(null, -1), null);
  assert.equal(moveFromEngine("", 1), null);
});

test("round trip: a move legal for player 2 stays legal after flipping", () => {
  // Build a position, orient it as the engine would see it, take a move that is
  // legal *there* for player 1, flip it back, and check the server would accept
  // it for player 2. This is the whole contract in one assertion.
  const board = emptyBoard();
  board[30] = 2; // player 2's home row
  board[8] = 1;

  const oriented = boardForEngine(board, -1);

  // In engine space this is player 1 to move; find something it may legally do.
  const candidates = legalMoves(oriented, 1).filter((m) => m.length === 2);
  assert.ok(candidates.length > 0, "the flipped position has legal moves");

  for (const engineMove of candidates.slice(0, 12)) {
    const backInBoardSpace = moveFromEngine(engineMove.join("|"), -1)!;
    const verdict = checkMoveLegality(board, -1, backInBoardSpace);
    assert.ok(
      verdict.legal,
      `engine move ${engineMove.join("|")} unflipped to ` +
        `${backInBoardSpace.join("|")}, which the server refused: ${verdict.reason}`,
    );
  }
});

test("the bot's setup arrangement is a legal one", () => {
  assert.ok(isValidSetup([...BOT_SETUP]));
});

test("a bot's arrangement is always legal, and varies between games", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) {
    const arrangement = botSetup();
    assert.ok(isValidSetup(arrangement), `${arrangement.join("")} should be legal`);
    seen.add(arrangement.join(""));
  }
  // 90 distinct orderings exist; drawing the same one forty times running is
  // effectively impossible, so this catches a shuffle that does not shuffle.
  assert.ok(seen.size > 1, "a bot should not open the same way every game");
});
