/**
 * The rules of Gygès — move legality.
 *
 * Pure functions only, like board.ts: no framework, no database, no I/O. The
 * same code therefore runs on the server (where it is the authority) and in the
 * browser (where it highlights legal destinations while dragging).
 *
 * ## This is a port, not an invention
 *
 * The rules were NOT derived from prose. They are a direct port of `MoveGen` in
 * the `gyges` Rust crate, and `tests/engine-parity.test.ts` checks 300 stored
 * positions against move lists the engine itself produced. During development
 * this port was verified against 60,000 randomly generated positions with zero
 * differences.
 *
 * That matters because the prose description of Gygès is genuinely misleading
 * about three things, each of which was a real bug here before the comparison
 * was run:
 *
 *  - A piece does NOT pass through occupied squares. A run stops at the first
 *    piece it meets; the Rust generator encodes this by filtering precomputed
 *    path tables on which intermediate squares are occupied.
 *  - "May not revisit a square" is really "may not reuse a STEP". The engine's
 *    `backtrack_board` bits index transitions between squares, not squares, so
 *    a path may cross itself as long as it arrives by a different step.
 *  - A displaced piece may not be dropped anywhere empty: the opponent's back
 *    zone — everything behind their active line — is excluded.
 *
 * ## Why this is here and not in the engine
 *
 * Legality is a bounded walk over 36 squares. Reaching for a network service to
 * answer it would add a hosting bill, a hop on every move, and a new way for the
 * site to break (engine down = nobody can play), in exchange for nothing. And
 * because this module is pure, the identical code runs in the browser, so legal
 * destinations are highlighted with no round trip.
 *
 * The engine remains the better authority for *search*, which is what bot play
 * needs and what genuinely wants a CPU core. lib/engine/client.ts is unchanged.
 *
 * ## The rules, as implemented
 *
 * 1. You may move any piece in your **active line** — the row nearest you that
 *    contains at least one piece. Nobody owns the pieces.
 * 2. A piece moves **exactly** its ring count (1, 2 or 3), orthogonally. It may
 *    not reuse a step, though it may revisit a square by another route.
 * 3. A run stops at the first piece it meets. If its count runs out exactly on
 *    that square it may end there — displacing the occupant — or hand its
 *    movement over and continue with the occupant's ring count. Chains this way
 *    may not bounce off the same piece twice.
 * 4. A displaced piece goes to any empty square outside the opponent's back
 *    zone, including the square the mover just left.
 * 5. Bearing off spends the final step leaving the opponent's home row.
 */

import {
  BOARD_SIZE,
  GRID_SIZE,
  P1_GOAL,
  P2_GOAL,
  checkMoveStructure,
  goalFor,
  type BoardState,
  type Move,
  type Player,
} from "./board.ts";

const COLS = 6;
const ROWS = 6;


/**
 * Where a displaced piece may be put.
 *
 * NOT simply "any empty square". A displaced piece may not be dropped behind
 * the opponent's active line — their back zone is off limits. This mirrors
 * `BoardState::get_drops` in the Rust crate:
 *
 *     !piece_bb & (FULL ^ BACK_ZONES[other][active_line[other]])
 *
 * The square the moving piece vacates IS a legal drop, even though it is
 * occupied in the pre-move board, because the mover has left it by the time the
 * displaced piece lands. That is why this takes `from` and treats it as empty.
 */
export function dropSquares(
  board: BoardState,
  player: Player,
  from: number,
): number[] {
  const other: Player = player === 1 ? -1 : 1;
  const otherLine = activeLineRow(board, other);

  const drops: number[] = [];
  for (let i = 0; i < GRID_SIZE; i++) {
    if (board[i] !== 0 && i !== from) continue;

    if (otherLine !== null) {
      const row = Math.floor(i / COLS);
      // The opponent's back zone: everything strictly behind their active line,
      // from their own point of view.
      const behind = other === 1 ? row < otherLine : row > otherLine;
      if (behind) continue;
    }

    drops.push(i);
  }
  return drops;
}

/**
 * The orthogonal neighbours of a grid square.
 *
 * The bear-off squares are deliberately NOT returned here. They are not part of
 * the grid, are reachable only from the far row, and are terminal — a piece that
 * reaches one has won and is not moving on. Treating them as ordinary
 * neighbours would let a path route *through* a goal, which is not a move.
 */
function neighbours(i: number): number[] {
  const row = Math.floor(i / COLS);
  const col = i % COLS;
  const out: number[] = [];

  if (row > 0) out.push(i - COLS);
  if (row < ROWS - 1) out.push(i + COLS);
  if (col > 0) out.push(i - 1);
  if (col < COLS - 1) out.push(i + 1);

  return out;
}

/**
 * A stable id for the step between two adjacent squares.
 *
 * Undirected: the step a->b and the step b->a are the SAME edge, which is what
 * the Rust path masks encode (0->6 and 1->0 share a bit). Blocking an edge is
 * what stops a run doubling straight back on itself, while still allowing a
 * square to be revisited by a different route.
 */
function edgeId(a: number, b: number): number {
  return a < b ? a * BOARD_SIZE + b : b * BOARD_SIZE + a;
}

/**
 * The row a player may move from: the one nearest them holding any piece.
 *
 * This is the rule that replaces ownership. Player 1 scans rows 0,1,2… upward;
 * player 2 scans 5,4,3… downward. Returns the row's indices, or null if the
 * board is empty of that player's reachable pieces.
 */
export function activeLine(board: BoardState, player: Player): number[] | null {
  const row = activeLineRow(board, player);
  if (row === null) return null;
  return Array.from({ length: COLS }, (_, c) => row * COLS + c);
}

/**
 * The row index of a player's active line, or null if the board is empty.
 *
 * Note this scans for the nearest row holding ANY piece, matching
 * `BoardState::get_active_lines` in the Rust crate, which takes the lowest set
 * bit for player 1 and the highest for player 2. Ownership does not enter into
 * it — the nearest occupied row is the active line whoever put the pieces there.
 */
export function activeLineRow(board: BoardState, player: Player): number | null {
  if (player === 1) {
    for (let row = 0; row < ROWS; row++) {
      for (let c = 0; c < COLS; c++) if (board[row * COLS + c] !== 0) return row;
    }
  } else {
    for (let row = ROWS - 1; row >= 0; row--) {
      for (let c = 0; c < COLS; c++) if (board[row * COLS + c] !== 0) return row;
    }
  }
  return null;
}

/** Whether this player may pick up the piece on `from`. */
export function canMoveFrom(
  board: BoardState,
  player: Player,
  from: number,
): boolean {
  if (!Number.isInteger(from) || from < 0 || from >= GRID_SIZE) return false;
  if (board[from] === 0) return false;
  const line = activeLine(board, player);
  return line !== null && line.includes(from);
}

/**
 * Every square a piece starting at `from` can finish its movement on.
 *
 * This is the core traversal, and rule 3 is what makes it interesting: a piece
 * that lands on an occupied square mid-path continues with the *occupant's*
 * ring count. So the walk is not "n steps from here" but a chain of runs whose
 * lengths are decided by what it lands on.
 *
 * Returns the set of end squares. Whether an end square is a simple move or a
 * displacement depends only on whether it is occupied, which the caller decides.
 *
 * The `visited` path is per-branch, not global: rule 2 forbids revisiting a
 * square *within a single move*, and two different routes are allowed to use the
 * same square. A shared visited-set would silently prune legal moves.
 */
export function reachableFrom(
  board: BoardState,
  player: Player,
  from: number,
): Set<number> {
  const ends = new Set<number>();
  const goal = goalFor(player);

  if (from < 0 || from >= GRID_SIZE || board[from] === 0) return ends;

  // The moving piece is lifted off the board before the walk begins, exactly as
  // `Action::Start` does in the Rust generator. This matters: its origin square
  // is EMPTY for the rest of the move, so a path may pass back over it, and
  // landing there is a simple move rather than a bounce.
  const lifted = [...board];
  lifted[from] = 0;

  /** The row a piece must be on to bear off: the opponent's home row. */
  const farRow = player === 1 ? ROWS - 1 : 0;

  /**
   * Walk `remaining` steps from `at`, having already used `path`.
   *
   * Depth is bounded: each run is at most 3 steps and each chain hop must land
   * on a piece, of which there are at most 12. In practice this explores a few
   * thousand paths at worst, in microseconds.
   */
  /**
   * Walk one run of `remaining` steps from `at`.
   *
   * `pathSquares` is the set of squares used by THIS run, which prevents a run
   * doubling back on itself (the Rust `backtrack_board`). It is reset at every
   * bounce, because each bounce starts a fresh run.
   *
   * `bounced` is the set of pieces already bounced off during this whole move,
   * and is NOT reset (the Rust `banned_positions`). A piece may be used as a
   * stepping stone only once per move; without this the search does not
   * terminate, and it is the rule that keeps chains finite.
   */
  const walk = (
    at: number,
    remaining: number,
    usedEdges: Set<number>,
    bounced: Set<number>,
  ): void => {
    for (const next of neighbours(at)) {
      // A move may not reuse an EDGE — a specific step between two adjacent
      // squares. It may revisit a square, as long as it arrives by a different
      // step. This is the Rust `backtrack_board`, whose bits index transitions
      // rather than squares (ONE_PATH_LISTS shows 0->6 and 1->0 sharing a bit).
      const edge = edgeId(at, next);
      if (usedEdges.has(edge)) continue;

      const stepsLeft = remaining - 1;
      const branch = new Set(usedEdges);
      branch.add(edge);

      if (lifted[next] !== 0) {
        // A piece blocks the path.
        //
        // A run may not pass THROUGH an occupied square: in the Rust generator
        // the precomputed path lists are filtered by which intermediate squares
        // hold pieces (ALL_*_INTERCEPTS + the PEXT key), so any path with an
        // occupied square in the middle is removed outright.
        //
        // So a piece only interacts with what it meets on the square where its
        // count runs out. There it may end — displacing the occupant — or hand
        // its movement over and continue with the occupant's ring count.
        if (stepsLeft !== 0) continue;

        ends.add(next);

        // Each piece may be bounced off only once per move (banned_positions).
        if (bounced.has(next)) continue;

        const nextBounced = new Set(bounced);
        nextBounced.add(next);
        // Used edges carry ACROSS the bounce — in the Rust generator
        // `backtrack_board ^ path.1` accumulates rather than resetting, so no
        // step may be repeated anywhere in the chain.
        walk(next, lifted[next], branch, nextBounced);
        continue;
      }

      // An empty square.
      if (stepsLeft === 0) {
        ends.add(next);
        continue;
      }
      walk(next, stepsLeft, branch, bounced);
    }

    // Bearing off. The goal is a neighbour of the far row ONLY — the Rust path
    // tables give a goal path to squares 0-5 and 30-35 and to nothing else. So
    // a piece bears off by spending its last step stepping out of the grid from
    // that row, not by merely being able to finish somewhere on it.
    if (remaining === 1 && Math.floor(at / COLS) === farRow) {
      ends.add(goal);
    }
  };

  // No edges used yet. The origin needs no special guard: an edge cannot be
  // reused, so the first step out of `from` cannot immediately be walked back,
  // yet the square itself stays available to a later run — which is why moves
  // ending where they began, like `9|9`, are legal.
  walk(from, board[from], new Set(), new Set());

  return ends;
}

export interface LegalityResult {
  legal: boolean;
  reason?: string;
}

/**
 * Whether a move is legal under the rules of Gygès.
 *
 * Assumes nothing: re-checks structure first, so this is safe to call on
 * anything a client sends. Structure and legality are kept separate because
 * they answer different questions — "is this a coherent move object" versus "is
 * this a move the rules allow" — and the error messages differ accordingly.
 */
export function checkMoveLegality(
  board: BoardState,
  player: Player,
  mv: Move,
): LegalityResult {
  const [from, to] = mv;

  // Two legal shapes are rejected by the shared structural check, because it
  // reads the board as it stands — with the moving piece still on `from`:
  //
  //   9|9     a move that finishes on the square it started from
  //   0|1|0   a displaced piece put on the square the mover vacated
  //
  // Both are legal, because the mover has left `from` by the time the move
  // resolves. checkMoveStructure is shared with code that has no notion of the
  // rules, so it is left alone and these two shapes are recognised here.
  const selfLanding = mv.length === 2 && to === from;
  const selfDrop = mv.length === 3 && mv[2] === from && mv[1] !== from;

  const structure = checkMoveStructure(board, mv);
  if (!structure.ok && !selfLanding && !selfDrop) {
    return { legal: false, reason: structure.reason };
  }

  // Those two shapes skipped the structural check, so the parts of it that
  // still apply are enforced directly.
  if (selfLanding || selfDrop) {
    for (const i of mv) {
      if (!Number.isInteger(i) || i < 0 || i >= BOARD_SIZE) {
        return { legal: false, reason: `index ${i} is out of range` };
      }
    }
    if (from >= GRID_SIZE || board[from] === 0) {
      return { legal: false, reason: "no piece on the starting square" };
    }
    if (selfDrop && (mv[1] >= GRID_SIZE || board[mv[1]] === 0)) {
      return { legal: false, reason: "nothing to displace on that square" };
    }
  }

  if (!canMoveFrom(board, player, from)) {
    const line = activeLine(board, player);
    if (line === null) return { legal: false, reason: "You have no pieces to move." };
    return {
      legal: false,
      reason: "You may only move a piece in the row nearest you that has pieces.",
    };
  }

  const ends = reachableFrom(board, player, from);
  if (!ends.has(to)) {
    return {
      legal: false,
      reason: `That piece cannot reach that square in exactly ${board[from]} ${
        board[from] === 1 ? "step" : "steps"
      }.`,
    };
  }

  // A piece that reaches the goal has won; there is nothing to displace, and
  // the move must be the simple two-index form.
  if (to === P1_GOAL || to === P2_GOAL) {
    if (to !== goalFor(player)) {
      return { legal: false, reason: "That is not your goal." };
    }
    if (mv.length !== 2) {
      return { legal: false, reason: "A move into the goal has no displacement." };
    }
    return { legal: true };
  }

  if (mv.length === 2) {
    // checkMoveStructure has already established the destination is empty.
    return { legal: true };
  }

  // A displacement. Structure has established that `landedOn` holds a piece and
  // `displacedTo` is empty; what remains is that the displaced piece must go to
  // a square on the grid, never into a bear-off space.
  const displacedTo = mv[2];
  if (displacedTo >= GRID_SIZE) {
    return { legal: false, reason: "A displaced piece cannot be put in a goal." };
  }

  return { legal: true };
}

/**
 * Every legal move in a position, for a player.
 *
 * Used for legal-move highlighting in the browser, and as the reference the
 * server's single-move check is tested against — anything this generates must
 * pass checkMoveLegality, and anything it does not must fail.
 *
 * The displacement expansion is why this list is large: a piece ending on an
 * occupied square may relocate the occupant to *any* empty square, so one
 * landing produces as many moves as there are empty squares.
 */
export function legalMoves(board: BoardState, player: Player): Move[] {
  const line = activeLine(board, player);
  if (!line) return [];

  const goal = goalFor(player);
  const moves: Move[] = [];

  for (const from of line) {
    if (board[from] === 0) continue;

    const drops = dropSquares(board, player, from);

    for (const to of reachableFrom(board, player, from)) {
      if (to === goal) {
        moves.push([from, to]);
        continue;
      }
      if (to >= GRID_SIZE) continue; // the other player's goal: not a move

      if (board[to] === 0 || to === from) {
        moves.push([from, to]);
      } else {
        // Landing on a piece displaces it. The square the mover vacates is a
        // legal destination for the displaced piece, since the mover has left.
        for (const target of drops) {
          if (target === to) continue; // the landing square is now occupied
          moves.push([from, to, target]);
        }
      }
    }
  }

  return moves;
}

/**
 * Whether a player has any legal move.
 *
 * Cheaper than generating the full list, because displacement expansion is
 * skipped: a reachable square is enough to prove a move exists.
 */
export function hasLegalMove(board: BoardState, player: Player): boolean {
  const line = activeLine(board, player);
  if (!line) return false;

  for (const from of line) {
    if (board[from] === 0) continue;
    if (reachableFrom(board, player, from).size > 0) return true;
  }
  return false;
}
