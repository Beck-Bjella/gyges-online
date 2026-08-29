/**
 * Tests for the pure board module.
 *
 * These cover encoding, geometry, transforms and structural checks. They do
 * NOT test the rules of Gygès — legality lives in rules.ts and is not
 * implemented here. See docs/ARCHITECTURE.md.
 *
 * Run with: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BOARD_SIZE,
  GRID_SIZE,
  P1_GOAL,
  P2_GOAL,
  PIECE_RADIUS,
  applyMove,
  boardFromString,
  boardToString,
  checkMoveStructure,
  flipBoard,
  flipMove,
  goalFor,
  idxToCenter,
  idxToNotation,
  isGameOver,
  moveFromString,
  moveToNotation,
  moveToString,
  nearestIndex,
  pieceAt,
  replay,
  startingBoard,
  winner,
} from "../lib/game/board.ts";

test("starting board has the documented shape", () => {
  const b = startingBoard();
  assert.equal(b.length, BOARD_SIZE);
  assert.deepEqual(b.slice(0, 6), [3, 2, 1, 1, 2, 3]);
  assert.deepEqual(b.slice(30, 36), [3, 2, 1, 1, 2, 3]);
  // Everything between the home rows is empty.
  assert.ok(b.slice(6, 30).every((v) => v === 0));
  assert.equal(b[P1_GOAL], 0);
  assert.equal(b[P2_GOAL], 0);
});

test("startingBoard returns a fresh array each call", () => {
  const a = startingBoard();
  a[0] = 9;
  assert.equal(startingBoard()[0], 3);
});

test("geometry matches the reference", () => {
  // Index 0 is a1: bottom-left of the grid.
  assert.deepEqual(idxToCenter(0), { cx: 280, cy: 620 });
  // Index 35 is f6: top-right.
  assert.deepEqual(idxToCenter(35), { cx: 620, cy: 280 });
  assert.deepEqual(idxToCenter(P1_GOAL), { cx: 450, cy: 722 });
  assert.deepEqual(idxToCenter(P2_GOAL), { cx: 450, cy: 178 });
  // The goals sit symmetrically about the centre.
  assert.equal(idxToCenter(P1_GOAL).cy + idxToCenter(P2_GOAL).cy, 900);
  // The grid is centred in the 900x900 space.
  assert.equal(idxToCenter(0).cx + idxToCenter(35).cx, 900);
});

test("the goals sit near the grid, not adrift near the board's points", () => {
  // The grid rows are 68 apart. A goal much further out than that reads as
  // floating off the board rather than belonging to it.
  const bottomRow = idxToCenter(0).cy;
  const topRow = idxToCenter(30).cy;
  const gapBelow = idxToCenter(P1_GOAL).cy - bottomRow;
  const gapAbove = topRow - idxToCenter(P2_GOAL).cy;

  for (const gap of [gapBelow, gapAbove]) {
    assert.ok(gap > 68, `a goal should sit clear of the grid (gap ${gap})`);
    assert.ok(gap < 150, `a goal should not float far off the grid (gap ${gap})`);
  }
  assert.equal(gapBelow, gapAbove, "the goals should be symmetric");
});

test("corner pieces clear the edge of the board", () => {
  // The board is a diamond with half-diagonal 433 centred at (450, 450), so a
  // point is inside when |x-450| + |y-450| < 433. The corner squares used to
  // sit only ~15 units clear, which read as crowded.
  const HALF_DIAGONAL = 433;
  for (const i of [0, 5, 30, 35]) {
    const { cx, cy } = idxToCenter(i);
    const distance = Math.abs(cx - 450) + Math.abs(cy - 450);
    const clearance = HALF_DIAGONAL - distance - PIECE_RADIUS;
    assert.ok(
      clearance > 40,
      `corner ${i} has only ${clearance} units of clearance`,
    );
  }
});

test("notation matches the reference", () => {
  assert.equal(idxToNotation(0), "a1");
  assert.equal(idxToNotation(5), "f1");
  assert.equal(idxToNotation(35), "f6");
  assert.equal(idxToNotation(P1_GOAL), "P1*");
  assert.equal(idxToNotation(P2_GOAL), "P2*");
  assert.equal(moveToNotation([9, 21]), "d2 → d4");
  assert.equal(moveToNotation([34, 28, 29]), "e6 × e5 → f5");
});

test("pieceAt finds a piece only within its radius", () => {
  const b = startingBoard();
  const { cx, cy } = idxToCenter(0);
  assert.equal(pieceAt(cx, cy, b), 0);
  assert.equal(pieceAt(cx + 10, cy + 10, b), 0);
  // Well outside any piece, and on an empty square.
  assert.equal(pieceAt(cx, cy - 75, b), null);
});

test("nearestIndex can be restricted to empty squares", () => {
  const b = startingBoard();
  const { cx, cy } = idxToCenter(0);
  assert.equal(nearestIndex(cx, cy, b, false), 0);
  // Index 0 is occupied at the start, so the nearest empty one differs.
  assert.notEqual(nearestIndex(cx, cy, b, true), 0);
});

test("applyMove handles a simple move", () => {
  const b = startingBoard();
  const next = applyMove(b, [0, 6]);
  assert.equal(next[0], 0);
  assert.equal(next[6], 3);
  // The original is untouched.
  assert.equal(b[0], 3);
});

test("applyMove handles a displacement", () => {
  const b = startingBoard();
  // Move the piece at 0 onto 1, displacing that piece to 6.
  const next = applyMove(b, [0, 1, 6]);
  assert.equal(next[0], 0);
  assert.equal(next[1], 3, "the moving piece takes the landing square");
  assert.equal(next[6], 2, "the displaced piece goes to its new square");
});

test("replay derives a position from a move list", () => {
  const moves = [
    [0, 6],
    [35, 29],
    [6, 12],
  ];
  const byReplay = replay(moves);
  let byHand = startingBoard();
  for (const m of moves) byHand = applyMove(byHand, m);
  assert.deepEqual(byReplay, byHand);
});

test("flipBoard is its own inverse", () => {
  const b = applyMove(startingBoard(), [0, 6]);
  assert.deepEqual(flipBoard(flipBoard(b)), b);
});

test("flipBoard swaps the goals", () => {
  const b = startingBoard();
  b[P1_GOAL] = 2;
  const f = flipBoard(b);
  assert.equal(f[P2_GOAL], 2);
  assert.equal(f[P1_GOAL], 0);
});

test("flipMove is its own inverse and maps goals", () => {
  assert.deepEqual(flipMove([0, 35]), [35, 0]);
  assert.deepEqual(flipMove([P1_GOAL]), [P2_GOAL]);
  assert.deepEqual(flipMove(flipMove([3, 17, 22])), [3, 17, 22]);
});

test("game ends when a goal is occupied", () => {
  const b = startingBoard();
  assert.equal(isGameOver(b), false);
  assert.equal(winner(b), null);

  const reachedP2Goal = startingBoard();
  reachedP2Goal[P2_GOAL] = 1;
  assert.equal(isGameOver(reachedP2Goal), true);
});

test("you win by reaching your opponent's goal, not your own", () => {
  // P2_GOAL sits beyond player 2's home row, so player 1 wins by reaching it.
  const p1Won = startingBoard();
  p1Won[P2_GOAL] = 1;
  assert.equal(winner(p1Won), 1);

  // P1_GOAL sits beyond player 1's home row, so a piece there is player 2's.
  const p2Won = startingBoard();
  p2Won[P1_GOAL] = 1;
  assert.equal(winner(p2Won), -1);

  // The goal each player is aiming at agrees with the above.
  assert.equal(goalFor(1), P2_GOAL);
  assert.equal(goalFor(-1), P1_GOAL);
});

test("board string round-trips", () => {
  const s = boardToString(startingBoard());
  assert.equal(s, "321123/000000/000000/000000/000000/321123");
  const back = boardFromString(s);
  assert.deepEqual(back.slice(0, GRID_SIZE), startingBoard().slice(0, GRID_SIZE));
});

test("board string rejects malformed input", () => {
  assert.throws(() => boardFromString("321123/000000"));
  assert.throws(() => boardFromString("32112/000000/000000/000000/000000/321123"));
  assert.throws(() => boardFromString("321129/000000/000000/000000/000000/321123"));
});

test("move string round-trips", () => {
  assert.equal(moveToString([12, 18]), "12|18");
  assert.equal(moveToString([12, 18, 24]), "12|18|24");
  assert.deepEqual(moveFromString("12|18"), [12, 18]);
  assert.deepEqual(moveFromString("12|18|24"), [12, 18, 24]);
  assert.throws(() => moveFromString("12"));
  assert.throws(() => moveFromString("12|18|24|30"));
  assert.throws(() => moveFromString("a|b"));
});

// --- structural checks ------------------------------------------------------

test("accepts a well-formed simple move", () => {
  const b = startingBoard();
  assert.equal(checkMoveStructure(b, [0, 6]).ok, true);
});

test("accepts a well-formed displacement", () => {
  const b = startingBoard();
  assert.equal(checkMoveStructure(b, [0, 1, 6]).ok, true);
});

test("rejects a move with no piece to move", () => {
  const b = startingBoard();
  const r = checkMoveStructure(b, [10, 11]);
  assert.equal(r.ok, false);
  assert.match(r.reason!, /no piece/i);
});

test("rejects a simple move onto an occupied square", () => {
  const b = startingBoard();
  const r = checkMoveStructure(b, [0, 1]);
  assert.equal(r.ok, false);
  assert.match(r.reason!, /occupied/i);
});

test("rejects a displacement onto an occupied square", () => {
  const b = startingBoard();
  // Displacing 1's piece onto 2, which is also occupied.
  const r = checkMoveStructure(b, [0, 1, 2]);
  assert.equal(r.ok, false);
  assert.match(r.reason!, /empty/i);
});

test("rejects a displacement of nothing", () => {
  const b = startingBoard();
  const r = checkMoveStructure(b, [0, 6, 12]);
  assert.equal(r.ok, false);
  assert.match(r.reason!, /nothing to displace/i);
});

test("rejects out-of-range and malformed indices", () => {
  const b = startingBoard();
  assert.equal(checkMoveStructure(b, [0, 99]).ok, false);
  assert.equal(checkMoveStructure(b, [-1, 6]).ok, false);
  assert.equal(checkMoveStructure(b, [0]).ok, false);
  assert.equal(checkMoveStructure(b, [0, 1, 2, 3]).ok, false);
});

test("rejects a move that repeats a square", () => {
  const b = startingBoard();
  const r = checkMoveStructure(b, [0, 1, 1]);
  assert.equal(r.ok, false);
  assert.match(r.reason!, /repeat/i);
});

test("rejects moving a piece out of a goal", () => {
  const b = startingBoard();
  b[P1_GOAL] = 1;
  const r = checkMoveStructure(b, [P1_GOAL, 6]);
  assert.equal(r.ok, false);
  assert.match(r.reason!, /bear-off/i);
});

test("a move into the goal is structurally fine", () => {
  const b = startingBoard();
  // Structure only cares that the target is empty; reaching it is a rules
  // question the engine will answer later.
  assert.equal(checkMoveStructure(b, [30, P2_GOAL]).ok, true);
});

// --- formatting -------------------------------------------------------------

test("think times display in the unit that suits their size", async () => {
  const { describeThinkTime } = await import("../lib/format.ts");
  assert.equal(describeThinkTime(30_000), "30s");
  assert.equal(describeThinkTime(300_000), "5m");
  assert.equal(describeThinkTime(7_200_000), "2.0h");
  assert.equal(describeThinkTime(259_200_000), "3.0d");
  assert.equal(describeThinkTime(null), "—");
});
