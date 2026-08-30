/**
 * Board encoding and geometry for Gygès.
 *
 * Pure functions only — no framework imports, no database, no I/O. This module
 * runs unchanged in the browser and on the server. See docs/BOARD_REFERENCE.md
 * for the full specification these values come from.
 *
 * It deliberately contains no rules: this module is about how a board is
 * encoded and drawn, not about what a legal move is. Legality lives next door
 * in rules.ts.
 */

/** A board is 38 slots: a 6x6 grid (0..35) plus two bear-off spaces. */
export type BoardState = number[];

/**
 * A move is a sequence of board indices.
 *  - length 2: [from, to]                     simple move
 *  - length 3: [from, landedOn, displacedTo]  displacement
 */
export type Move = number[];

/** Player 1 moves up the board; Player 2 moves down. */
export type Player = 1 | -1;

export const BOARD_SIZE = 38;
export const GRID_SIZE = 36;

/**
 * The bear-off spaces.
 *
 * Naming follows the board's geography, not ownership: P1_GOAL is the space
 * beyond player 1's home row (the bottom of the board). A player wins by
 * reaching the space beyond their OPPONENT's home row, so a piece landing on
 * P1_GOAL means player 2 has won. Use goalFor() rather than reasoning about
 * these constants directly.
 */
export const P1_GOAL = 36;
export const P2_GOAL = 37;

/**
 * The pieces each player places during setup: two each of the one-, two- and
 * three-ring pieces, arranged in whatever order the player chooses.
 *
 * A game does not begin from a fixed position. The board starts empty; player 1
 * arranges these six on their home row, then player 2 does the same. Only then
 * does normal play begin. The arrangement is a real decision and part of the
 * record.
 */
export const SETUP_PIECES: readonly number[] = [3, 2, 1, 1, 2, 3];

/** The board before either player has placed anything. */
export function emptyBoard(): BoardState {
  return new Array<number>(BOARD_SIZE).fill(0);
}

/**
 * A player's home row, where they place their six pieces.
 * Player 1 uses indices 0..5; player 2 uses 30..35.
 */
export function homeRow(player: Player): number[] {
  return player === 1 ? [0, 1, 2, 3, 4, 5] : [30, 31, 32, 33, 34, 35];
}

/**
 * Whether an arrangement is a legal setup: exactly the six standard pieces,
 * in some order.
 */
export function isValidSetup(arrangement: number[]): boolean {
  if (arrangement.length !== 6) return false;
  const sorted = [...arrangement].sort();
  const expected = [...SETUP_PIECES].sort();
  return sorted.every((v, i) => v === expected[i]);
}

/** Place a player's arrangement onto their home row. */
export function applySetup(
  board: BoardState,
  player: Player,
  arrangement: number[],
): BoardState {
  const next = [...board];
  const row = homeRow(player);
  row.forEach((idx, i) => {
    next[idx] = arrangement[i];
  });
  return next;
}


/**
 * The position both players' setups produce — the standard opening, when both
 * choose the conventional order. Kept because tests and the engine's board
 * string both reference it.
 */
export const STARTING_BOARD: BoardState = [
  3, 2, 1, 1, 2, 3,
  0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0,
  3, 2, 1, 1, 2, 3,
  0, 0,
];

export function startingBoard(): BoardState {
  return [...STARTING_BOARD];
}

// ---------------------------------------------------------------------------
// Geometry — a 900x900 coordinate space, scaled by the renderer.
// ---------------------------------------------------------------------------

export const VIEWBOX = 900;
/**
 * Grid spacing and the piece size.
 *
 * The grid is pulled in from the original 75/262.5 so the corner squares are
 * not crowded against the edge of the diamond: at pitch 75 a corner piece had
 * only ~15 units of clearance, against ~86 for the bear-off spaces. At pitch 68
 * with a larger diamond that becomes ~61, and the pieces themselves are bigger.
 */
export const GRID_PITCH = 68;
export const GRID_ORIGIN = 280;
export const PIECE_RADIUS = 32;

/**
 * Bear-off centres.
 *
 * Set about one and a half grid rows beyond the nearest row (102 units, against
 * a 68-unit pitch), so they read as part of the board rather than floating off
 * near its points. They previously sat 193 units out — nearly three rows of
 * empty space — which made the board look sparse at top and bottom.
 */
export const P1_GOAL_CENTER = { cx: 450, cy: 722 };
export const P2_GOAL_CENTER = { cx: 450, cy: 178 };

export interface Point {
  cx: number;
  cy: number;
}

/** Centre point of a board index, in the 900x900 coordinate space. */
export function idxToCenter(i: number): Point {
  if (i === P1_GOAL) return { ...P1_GOAL_CENTER };
  if (i === P2_GOAL) return { ...P2_GOAL_CENTER };
  const col = i % 6;
  const row = 5 - Math.floor(i / 6); // row 0 renders at the bottom
  return {
    cx: GRID_ORIGIN + col * GRID_PITCH,
    cy: GRID_ORIGIN + row * GRID_PITCH,
  };
}

/** The index whose centre is nearest a point, optionally restricted to empty squares. */
export function nearestIndex(
  x: number,
  y: number,
  board: BoardState,
  onlyEmpty = false,
): number | null {
  let bestIdx: number | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < BOARD_SIZE; i++) {
    if (onlyEmpty && board[i] !== 0) continue;
    const { cx, cy } = idxToCenter(i);
    const d2 = (cx - x) ** 2 + (cy - y) ** 2;
    if (d2 < bestDist) {
      bestDist = d2;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/** The occupied index under a point, if the point is within a piece's radius. */
export function pieceAt(x: number, y: number, board: BoardState): number | null {
  for (let i = 0; i < BOARD_SIZE; i++) {
    if (board[i] === 0) continue;
    const { cx, cy } = idxToCenter(i);
    if ((cx - x) ** 2 + (cy - y) ** 2 <= PIECE_RADIUS ** 2) return i;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Board operations
// ---------------------------------------------------------------------------

/** Apply a move, returning a new board. Does not check legality. */
export function applyMove(board: BoardState, mv: Move): BoardState {
  const next = [...board];
  if (mv.length === 2) {
    const [from, to] = mv;
    // Read the piece out before clearing, because a move may end where it began
    // — a piece can loop back to its own square, which is legal and leaves the
    // board unchanged. Writing the destination first and then blanking the
    // origin deletes the piece outright in that case.
    const moving = next[from];
    next[from] = 0;
    next[to] = moving;
  } else if (mv.length === 3) {
    const [from, landedOn, displacedTo] = mv;
    const moving = next[from];
    const displaced = next[landedOn];
    next[from] = 0;
    next[landedOn] = moving;
    next[displacedTo] = displaced;
  }
  return next;
}

/** Replay a move list from the starting position. */
export function replay(moves: Move[], from: BoardState = STARTING_BOARD): BoardState {
  return moves.reduce<BoardState>((b, mv) => applyMove(b, mv), [...from]);
}

/** Rotate the board 180 degrees, to view it from the other side. */
export function flipBoard(board: BoardState): BoardState {
  const flipped = new Array<number>(BOARD_SIZE).fill(0);
  for (let i = 0; i < GRID_SIZE; i++) {
    if (board[i] !== 0) flipped[GRID_SIZE - 1 - i] = board[i];
  }
  flipped[P1_GOAL] = board[P2_GOAL];
  flipped[P2_GOAL] = board[P1_GOAL];
  return flipped;
}

/** Apply the same 180-degree mapping to a move's indices. */
export function flipMove(mv: Move): Move {
  return mv.map((i) => {
    if (i === P1_GOAL) return P2_GOAL;
    if (i === P2_GOAL) return P1_GOAL;
    return GRID_SIZE - 1 - i;
  });
}

/** A game is over once either bear-off space is occupied. */
export function isGameOver(board: BoardState): boolean {
  return board[P1_GOAL] !== 0 || board[P2_GOAL] !== 0;
}

/**
 * Which player won, or null if the game is unfinished.
 *
 * A player wins by reaching the space beyond their opponent's home row, so a
 * piece on P1_GOAL (below player 1's home row) means player 2 got there.
 */
export function winner(board: BoardState): Player | null {
  if (board[P1_GOAL] !== 0) return -1;
  if (board[P2_GOAL] !== 0) return 1;
  return null;
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

/**
 * The row-major string form used by the gyges Rust library, e.g.
 * "321123/000000/000000/000000/000000/321123". Bear-off spaces are not
 * represented, so this is only meaningful for unfinished positions.
 */
export function boardToString(board: BoardState): string {
  const rows: string[] = [];
  for (let r = 0; r < 6; r++) {
    rows.push(board.slice(r * 6, r * 6 + 6).join(""));
  }
  return rows.join("/");
}

export function boardFromString(s: string): BoardState {
  const board = new Array<number>(BOARD_SIZE).fill(0);
  const rows = s.split("/");
  if (rows.length !== 6) throw new Error(`expected 6 rows, got ${rows.length}`);
  rows.forEach((row, r) => {
    if (row.length !== 6) throw new Error(`row ${r} has length ${row.length}`);
    for (let c = 0; c < 6; c++) {
      const v = Number(row[c]);
      if (!Number.isInteger(v) || v < 0 || v > 3) {
        throw new Error(`bad piece value ${row[c]} at row ${r}, col ${c}`);
      }
      board[r * 6 + c] = v;
    }
  });
  return board;
}

/** Wire format for a single move: indices joined by "|", as UGI uses. */
export function moveToString(mv: Move): string {
  return mv.join("|");
}

export function moveFromString(s: string): Move {
  const parts = s.split("|").map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isInteger(n))) {
    throw new Error(`malformed move: ${s}`);
  }
  return parts;
}

// ---------------------------------------------------------------------------
// Notation
// ---------------------------------------------------------------------------

export function idxToNotation(i: number): string {
  if (i === P1_GOAL) return "P1*";
  if (i === P2_GOAL) return "P2*";
  const col = i % 6;
  const row = Math.floor(i / 6) + 1;
  return `${String.fromCharCode(97 + col)}${row}`;
}

export function moveToNotation(mv: Move): string {
  if (mv.length === 2) {
    return `${idxToNotation(mv[0])} → ${idxToNotation(mv[1])}`;
  }
  if (mv.length === 3) {
    return `${idxToNotation(mv[0])} × ${idxToNotation(mv[1])} → ${idxToNotation(mv[2])}`;
  }
  return "—";
}

// ---------------------------------------------------------------------------
// Structural validation
//
// NOT rules validation. This only checks that a move is well-formed and
// internally consistent with the board — indices in range, a piece to move,
// the right shape for its length. Whether the move is *legal* under the rules
// of Gygès is decided by rules.ts, not here.
// ---------------------------------------------------------------------------

export interface StructuralCheck {
  ok: boolean;
  reason?: string;
}

export function checkMoveStructure(board: BoardState, mv: Move): StructuralCheck {
  if (mv.length !== 2 && mv.length !== 3) {
    return { ok: false, reason: "a move must have 2 or 3 indices" };
  }
  for (const i of mv) {
    if (!Number.isInteger(i) || i < 0 || i >= BOARD_SIZE) {
      return { ok: false, reason: `index ${i} is out of range` };
    }
  }
  const [from] = mv;
  if (from >= GRID_SIZE) {
    return { ok: false, reason: "cannot move a piece out of a bear-off space" };
  }
  if (board[from] === 0) {
    return { ok: false, reason: "no piece on the starting square" };
  }
  if (new Set(mv).size !== mv.length) {
    return { ok: false, reason: "a move cannot repeat a square" };
  }

  if (mv.length === 2) {
    const [, to] = mv;
    if (board[to] !== 0) {
      return { ok: false, reason: "destination is occupied; a displacement needs 3 indices" };
    }
  } else {
    const [, landedOn, displacedTo] = mv;
    if (landedOn >= GRID_SIZE) {
      return { ok: false, reason: "cannot displace a piece in a bear-off space" };
    }
    if (board[landedOn] === 0) {
      return { ok: false, reason: "nothing to displace on that square" };
    }
    if (board[displacedTo] !== 0) {
      return { ok: false, reason: "the displaced piece needs an empty square" };
    }
  }
  return { ok: true };
}

/** The bear-off space a player is trying to reach in order to win. */
export function goalFor(player: Player): number {
  return player === 1 ? P2_GOAL : P1_GOAL;
}
