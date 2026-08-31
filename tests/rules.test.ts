/**
 * Tests for move legality.
 *
 * Positions here are built by hand and kept sparse, so each expectation can be
 * checked against the rules by reading the board rather than by trusting the
 * implementation that produced it.
 *
 * Index layout — row = floor(i / 6), col = i % 6, row 0 is player 1's home:
 *
 *    30 31 32 33 34 35   <- row 5, player 2's home
 *    24 25 26 27 28 29
 *    18 19 20 21 22 23
 *    12 13 14 15 16 17
 *     6  7  8  9 10 11
 *     0  1  2  3  4  5   <- row 0, player 1's home
 *
 * Run with: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const {
  activeLine,
  canMoveFrom,
  dropSquares,
  reachableFrom,
  checkMoveLegality,
  legalMoves,
  hasLegalMove,
} = await import("../lib/game/rules.ts");

const { emptyBoard, startingBoard, applyMove, P1_GOAL, P2_GOAL, BOARD_SIZE } = await import(
  "../lib/game/board.ts"
);

/** A board with only the given pieces on it: {index: rings}. */
function boardWith(pieces: Record<number, number>) {
  const b = emptyBoard();
  for (const [i, v] of Object.entries(pieces)) b[Number(i)] = v;
  return b;
}

const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);

// --- the active line -------------------------------------------------------

test("the active line is the nearest row with pieces", () => {
  const board = startingBoard();
  assert.deepEqual(activeLine(board, 1), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(activeLine(board, -1), [30, 31, 32, 33, 34, 35]);
});

test("an empty home row pushes the active line further out", () => {
  // Player 1's home row is empty; their nearest pieces are on row 2.
  const board = boardWith({ 12: 1, 15: 2, 30: 3 });
  assert.deepEqual(activeLine(board, 1), [12, 13, 14, 15, 16, 17]);
});

test("both players can be forced onto the same active line", () => {
  // The only pieces on the board are on row 3, so it is nearest for both.
  const board = boardWith({ 19: 1, 21: 2 });
  assert.deepEqual(activeLine(board, 1), [18, 19, 20, 21, 22, 23]);
  assert.deepEqual(activeLine(board, -1), [18, 19, 20, 21, 22, 23]);
});

test("an empty board has no active line", () => {
  assert.equal(activeLine(emptyBoard(), 1), null);
  assert.equal(hasLegalMove(emptyBoard(), 1), false);
});

test("nobody owns the pieces: either player may move one on a shared line", () => {
  const board = boardWith({ 19: 1 });
  assert.ok(canMoveFrom(board, 1, 19), "player 1 may move it");
  assert.ok(canMoveFrom(board, -1, 19), "player 2 may move the same piece");
});

test("a piece outside the active line cannot be moved", () => {
  const board = startingBoard();
  // Row 1 is empty in the starting position, but row 3 is not player 1's line.
  assert.ok(!canMoveFrom(board, 1, 30), "player 1 cannot move player 2's row");
  assert.ok(!canMoveFrom(board, -1, 0), "player 2 cannot move player 1's row");
});

test("an empty square cannot be moved from", () => {
  const board = startingBoard();
  assert.ok(!canMoveFrom(board, 1, 10));
});

// --- basic movement --------------------------------------------------------

test("a one-ring piece moves exactly one square", () => {
  // A lone 1 in the middle of an empty board.
  const board = boardWith({ 14: 1 });
  assert.deepEqual(sorted(reachableFrom(board, 1, 14)), [8, 13, 15, 20]);
});

test("a one-ring piece in a corner has two destinations", () => {
  const board = boardWith({ 0: 1 });
  assert.deepEqual(sorted(reachableFrom(board, 1, 0)), [1, 6]);
});

test("a two-ring piece moves exactly two squares, not one", () => {
  // 14 is row 2, col 2, on an otherwise empty board.
  const board = boardWith({ 14: 2 });
  const ends = reachableFrom(board, 1, 14);

  // Two orthogonal steps: the four squares two away in a straight line
  // (2, 26, 12, 16) plus the four diagonals reached by turning a corner
  // (7, 9, 19, 21).
  assert.deepEqual(sorted(ends), [2, 7, 9, 12, 16, 19, 21, 26]);

  assert.ok(!ends.has(14), "it may not return to where it started");
  assert.ok(!ends.has(8), "one step is not two steps");
  assert.ok(!ends.has(13), "one step is not two steps");
});

test("a three-ring piece moves exactly three", () => {
  const board = boardWith({ 14: 3 });
  const ends = reachableFrom(board, 1, 14);

  assert.ok(ends.has(17), "three steps along a row");
  assert.ok(ends.has(32), "three steps up a column");

  // 16 is two steps away, so three steps can never end there — parity, not
  // distance, is what rules a square out. 15 is one step away and IS reachable
  // (14 -> 8 -> 9 -> 15), which is the same parity argument in the other
  // direction.
  assert.ok(!ends.has(16), "two steps away is unreachable in exactly three");
  assert.ok(ends.has(15), "one step away is reachable in three, by going round");

  // On an empty board every reachable grid square must be an odd number of
  // steps away: three orthogonal steps cannot change parity.
  for (const e of ends) {
    if (e >= 36) continue;
    const dist = Math.abs(Math.floor(e / 6) - 2) + Math.abs((e % 6) - 2);
    assert.equal(dist % 2, 1, `square ${e} has wrong parity for a 3-move`);
  }
});

test("a move may not revisit a square within itself", () => {
  // A 2-piece cannot step out and back to where it started.
  const board = boardWith({ 14: 2 });
  assert.ok(!reachableFrom(board, 1, 14).has(14));
});

// --- the chain / bounce rule ----------------------------------------------

test("a piece may not pass through an occupied square", () => {
  // A 2-piece at 14 with a 1-piece directly above at 20. The piece cannot use
  // 20 as a stepping stone on the way to 26: a run stops at the first piece it
  // meets, so paths THROUGH an occupant do not exist.
  const board = boardWith({ 14: 2, 20: 1 });
  const ends = reachableFrom(board, 1, 14);

  assert.deepEqual(sorted(ends), [2, 7, 9, 12, 16, 19, 21]);
  assert.ok(!ends.has(20), "20 is one step away; a 2-move cannot stop there");
  assert.ok(!ends.has(26), "and it cannot pass through 20 to reach 26");
});

test("a piece whose count is exactly spent may displace or chain onward", () => {
  // A 1-piece at 14, with a 1-piece directly above it at 20. The single step
  // is spent on arriving at 20, so the rules offer both options:
  //   - stop there, displacing the occupant, or
  //   - continue using the occupant's own ring count.
  const board = boardWith({ 14: 1, 20: 1 });
  const ends = reachableFrom(board, 1, 14);

  assert.deepEqual(sorted(ends), [8, 13, 15, 19, 20, 21, 26]);
  assert.ok(ends.has(20), "it may end on the piece, which is a displacement");
  assert.ok(ends.has(19), "or chain onward using that piece's count");
  assert.ok(ends.has(26), "or chain onward up the column");
});

test("a chain can pass through several pieces", () => {
  // 1-piece at 14 steps onto a 1 at 20, which steps onto a 1 at 26.
  const board = boardWith({ 14: 1, 20: 1, 26: 1 });
  const ends = reachableFrom(board, 1, 14);

  // 14 -> 20 (occupied, take its 1) -> 26 (occupied, take its 1) -> 25/27/32.
  assert.ok(ends.has(32), "chained twice, up the column");
  assert.ok(ends.has(25));
  assert.ok(ends.has(27));
});

test("a piece may end on an occupied square (a displacement)", () => {
  // 1-piece at 14; a piece sits one step away at 15. Ending there is legal —
  // it becomes a displacement.
  const board = boardWith({ 14: 1, 15: 2 });
  assert.ok(reachableFrom(board, 1, 14).has(15));
});

// --- the goal --------------------------------------------------------------

test("bearing off spends the last step leaving the far row", () => {
  // A one-ring piece at 24 reaches row 5 — and stops there. Its count is spent
  // arriving, so it has no step left to leave the board with.
  const near = boardWith({ 24: 1 });
  const nearEnds = reachableFrom(near, 1, 24);
  assert.ok(nearEnds.has(30), "it can reach the far row");
  assert.ok(!nearEnds.has(P2_GOAL), "but cannot continue into the goal");

  // A two-ring piece at the same square can: 24 -> 30, then out.
  const far = boardWith({ 24: 2 });
  assert.ok(reachableFrom(far, 1, 24).has(P2_GOAL), "two steps reach the goal");
});

test("a player cannot bear off into their own goal", () => {
  // Player 2 moving down: a two-ring piece at 6 goes 6 -> row 0 -> out.
  const board = boardWith({ 6: 2 });
  const ends = reachableFrom(board, -1, 6);
  assert.ok(ends.has(P1_GOAL), "player 2 scores in P1_GOAL");
  assert.ok(!ends.has(P2_GOAL), "player 2 does not score in their own goal");
});

test("a move into the goal is legal and takes the two-index form", () => {
  const board = boardWith({ 24: 2 });
  const scoring = checkMoveLegality(board, 1, [24, P2_GOAL]);
  assert.ok(scoring.legal, scoring.reason);

  // A one-ring piece on the same square cannot reach it.
  const short = boardWith({ 24: 1 });
  assert.ok(!checkMoveLegality(short, 1, [24, P2_GOAL]).legal);
});

test("a piece cannot be displaced into a goal", () => {
  const board = boardWith({ 14: 1, 15: 2 });
  const verdict = checkMoveLegality(board, 1, [14, 15, P2_GOAL]);
  assert.ok(!verdict.legal, "displacing into a goal must be refused");
});

// --- checkMoveLegality -----------------------------------------------------

test("a legal simple move is accepted", () => {
  const board = startingBoard();
  // The 3 at index 0 moves three squares: 0 -> 6 -> 12 -> 13.
  const verdict = checkMoveLegality(board, 1, [0, 13]);
  assert.ok(verdict.legal, verdict.reason);
});

test("a move of the wrong distance is refused with a reason", () => {
  const board = boardWith({ 14: 2 });
  const verdict = checkMoveLegality(board, 1, [14, 8]);
  assert.ok(!verdict.legal);
  assert.match(verdict.reason ?? "", /exactly 2 steps/);
});

test("moving an opponent's row is refused", () => {
  const board = startingBoard();
  const verdict = checkMoveLegality(board, 1, [30, 24]);
  assert.ok(!verdict.legal);
  assert.match(verdict.reason ?? "", /nearest you/);
});

test("structural problems are still caught", () => {
  const board = startingBoard();
  assert.ok(!checkMoveLegality(board, 1, [10, 11]).legal, "empty start square");
  assert.ok(!checkMoveLegality(board, 1, [0]).legal, "too few indices");
  assert.ok(!checkMoveLegality(board, 1, [0, 999]).legal, "out of range");
  assert.ok(!checkMoveLegality(board, 1, [0, 0]).legal, "repeated square");
});

// --- generation agrees with checking --------------------------------------

test("every generated move passes the check, on many positions", () => {
  const positions = [
    startingBoard(),
    boardWith({ 14: 2, 20: 1, 26: 3 }),
    boardWith({ 0: 1, 1: 2, 2: 3, 30: 3, 31: 2, 32: 1 }),
    boardWith({ 19: 1, 21: 2 }),
    boardWith({ 24: 1, 30: 2, 31: 1 }),
  ];

  for (const board of positions) {
    for (const player of [1, -1] as const) {
      const generated = legalMoves(board, player);
      for (const mv of generated) {
        const verdict = checkMoveLegality(board, player, mv);
        assert.ok(
          verdict.legal,
          `generated ${JSON.stringify(mv)} but the check refused it: ${verdict.reason}`,
        );
      }
    }
  }
});

test("moves the generator omits are refused by the check", () => {
  // The exhaustive converse: for a simple position, every possible two-index
  // move that was NOT generated must be rejected.
  const board = boardWith({ 14: 2, 20: 1 });
  const player = 1 as const;

  const generated = new Set(legalMoves(board, player).map((m) => m.join("|")));

  for (let from = 0; from < 36; from++) {
    for (let to = 0; to < BOARD_SIZE; to++) {
      if (from === to) continue;
      const key = `${from}|${to}`;
      if (generated.has(key)) continue;
      // Not generated, and a two-index move: it must be illegal.
      const verdict = checkMoveLegality(board, player, [from, to]);
      assert.ok(
        !verdict.legal,
        `[${from},${to}] was not generated but the check allowed it`,
      );
    }
  }
});

test("the starting position offers a sensible number of moves", () => {
  const moves = legalMoves(startingBoard(), 1);
  assert.ok(moves.length > 0, "there are moves in the opening");
  // Every move must start from the home row.
  for (const mv of moves) {
    assert.ok(mv[0] >= 0 && mv[0] <= 5, `move starts at ${mv[0]}, outside the home row`);
  }
  assert.ok(hasLegalMove(startingBoard(), 1));
  assert.ok(hasLegalMove(startingBoard(), -1));
});

test("generation never produces a move into the wrong goal", () => {
  const board = boardWith({ 24: 1, 6: 1 });
  for (const mv of legalMoves(board, 1)) {
    assert.notEqual(mv[1], P1_GOAL, "player 1 must not move into their own goal");
    assert.notEqual(mv[2], P1_GOAL, "and must not displace into it");
    assert.notEqual(mv[2], P2_GOAL, "nor displace into the far goal");
  }
});

// --- where a displaced piece may go --------------------------------------
//
// This now drives the board's drop markers as well as move generation, so a
// mistake here shows up as the UI offering a square the server then refuses.

test("a displaced piece may take the square the mover vacated", () => {
  // The mover leaves `from`, so by the time the displaced piece lands it is
  // empty — even though the pre-move board still shows a piece there.
  const board = boardWith({ 14: 1, 15: 2, 30: 1 });
  assert.ok(dropSquares(board, 1, 14).includes(14));
});

test("a displaced piece may not go on an occupied square", () => {
  const board = boardWith({ 14: 1, 15: 2, 30: 1 });
  const drops = dropSquares(board, 1, 14);
  assert.ok(!drops.includes(15), "15 holds the piece being displaced");
  assert.ok(!drops.includes(30), "30 holds another piece");
});

test("a displaced piece may not be dropped behind the opponent's line", () => {
  // Player 2's nearest pieces are on row 3, so rows 4 and 5 are their back zone.
  const board = boardWith({ 0: 1, 1: 2, 18: 1, 19: 1 });
  const drops = dropSquares(board, 1, 0);

  assert.ok(drops.length > 0, "there is still somewhere to put it");
  for (const i of drops) {
    assert.ok(
      Math.floor(i / 6) <= 3,
      `${i} is behind player 2's active line and should not be offered`,
    );
  }
});

test("every drop the board offers is one the rules accept", () => {
  // The contract the UI relies on: anything marked is a move the server takes.
  const board = boardWith({ 14: 1, 15: 2, 30: 3, 31: 1 });
  for (const target of dropSquares(board, 1, 14)) {
    if (target === 15) continue; // the landing square itself
    const verdict = checkMoveLegality(board, 1, [14, 15, target]);
    assert.ok(verdict.legal, `drop on ${target} refused: ${verdict.reason}`);
  }
});

test("a move that loops back to its own square leaves the board unchanged", () => {
  // Legal in Gyges: a piece may travel its full count and end where it began.
  // applyMove used to write the destination and then blank the origin, which
  // deleted the piece when the two were the same square.
  const board = "00213000010010320032010000203000000000".split("").map(Number);
  assert.ok(
    legalMoves(board, 1).some((m) => m.length === 2 && m[0] === m[1]),
    "expected this position to offer a move ending on its own square",
  );
  const after = applyMove(board, [3, 3]);
  assert.deepEqual(after, board);
  assert.equal(
    after.filter((sq) => sq !== 0).length,
    board.filter((sq) => sq !== 0).length,
    "no piece may be lost",
  );
});
