# Gygès — Board & Piece Reference

Preserved from the desktop UI versions (macroquad / Slint / Tauri) before the
strip-down to the web project. This is the visual + data spec only. It carries
no framework, no engine, and no rules implementation.

---

## 1. Board topology

The board is a **6×6 grid** plus **two bear-off spaces**, for **38 total indices**.

```
index = row * 6 + col        (0..35)
index 36 = Player 1 bear-off (bottom)
index 37 = Player 2 bear-off (top)
```

Row 0 is Player 1's home row; row 5 is Player 2's home row.

### Index map

```
                 [37]  P2 bear-off
        30 31 32 33 34 35     row 5   (P2 home)
        24 25 26 27 28 29     row 4
        18 19 20 21 22 23     row 3
        12 13 14 15 16 17     row 2
         6  7  8  9 10 11     row 1
         0  1  2  3  4  5     row 0   (P1 home)
                 [36]  P1 bear-off
```

### Algebraic notation

```
col 0..5  ->  a..f          (char code 97 + col)
row 0..5  ->  1..6          (row + 1)
index 36  ->  "P1*"
index 37  ->  "P2*"
```

Example: index 0 = `a1`, index 35 = `f6`.

Move notation used in history panels:
- Simple move:   `d2 → d4`
- Displacement:  `f5 × e5 → e6`

---

## 2. Piece representation

A board state is a **flat array of 38 integers**.

| Value | Meaning |
|-------|---------|
| `0`   | empty square |
| `1`   | one-ring piece  (moves 1 space) |
| `2`   | two-ring piece  (moves 2 spaces) |
| `3`   | three-ring piece (moves 3 spaces) |

**Pieces are not owned by either player.** The value is the ring count, which is
also the movement distance. Ownership does not exist in this game — only the row
nearest you determines what you may move.

### Starting position

```
[ 3, 2, 1, 1, 2, 3,     <- row 0, P1 home
  0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0,
  3, 2, 1, 1, 2, 3,     <- row 5, P2 home
  0, 0 ]                <- bear-off 36, 37
```

Alternate string form used by the `gyges` Rust library
(rows from your side outward, `/`-separated):

```
321123/000000/000000/000000/000000/321123
```

### Board transforms

**Flip (rotate 180° to view from the other side):**

```
grid:      flipped[35 - i] = board[i]   for i in 0..35
bear-off:  flipped[36] = board[37]
           flipped[37] = board[36]
```

**Flip a move** (same mapping applied per index):

```
36 -> 37,   37 -> 36,   x -> 35 - x
```

**Terminal condition:** a player has won when either bear-off is occupied,
i.e. `board[36] != 0 || board[37] != 0`.

---

## 3. Move shape

A move is a **sequence of board indices**:

| Length | Kind | Meaning |
|--------|------|---------|
| 2 | simple | `[from, to]` — piece moves from `from` to an empty `to` |
| 3 | displacement | `[from, landedOn, displacedTo]` — the moving piece lands on an occupied square and the piece that was there is relocated to `displacedTo` |

Applying a move:

```
length 2:  next[to]          = board[from];  next[from] = 0
length 3:  next[landedOn]    = board[from];  next[from] = 0
           next[displacedTo] = board[landedOn]
```

Wire format used by the UGI engine protocol: indices joined by `|`,
e.g. `12|18` or `12|18|24`.

---

## 4. Rules summary (prose only — the implementation is in Rust)

An informal description, for orientation. The real implementation is the move
generator in the `gyges` Rust crate (`gyges/src/moves/movegen.rs`), which the
website reaches rather than reimplements. Do not treat the prose below as a
specification.

- The object is to move a piece to your opponent's last row (their bear-off).
- **No one owns the pieces.** You may only move a piece in **the row nearest you**
  that contains any pieces.
- A piece moves **exactly** the number of spaces equal to its ring count (1, 2, or 3),
  moving orthogonally, and may not revisit a square within a single move.
- If a piece **lands on** another piece mid-path, it may continue moving using
  *that* piece's ring count instead (chaining).
- If a piece lands on another piece at the end of its movement, it may instead
  **displace** that piece to any open square on the board.

`MoveGen::gen::<GenMoves, _>()` in the `gyges` crate is the authority: it
produces the legal move list for a player from a board state. The website calls
into it (see `ARCHITECTURE.md`) rather than reimplementing the rules, so that
move validation and the future bot always agree.

Whichever way it is reached, the **server** must be the side enforcing it.
Client-side checks are a UX affordance only — a player can edit their own
JavaScript.

---

## 5. Visual geometry

The desktop board was drawn on a **900 × 900** SVG viewBox. All values below are
in that coordinate space; scale proportionally for responsive layouts.

### Square centers

```
index 36 (P1 bear-off):  cx = 450, cy = 750
index 37 (P2 bear-off):  cx = 450, cy = 150

grid (i in 0..35):
  col = i % 6
  row = 5 - floor(i / 6)          <- row 0 renders at the BOTTOM
  cx  = 262.5 + col * 75
  cy  = 262.5 + row * 75
```

Grid pitch is **75 units**. The grid spans 262.5 → 637.5 on both axes.

### Shapes

| Element | Geometry |
|---------|----------|
| Board diamond (outer) | `M 450 32 L 868 450 L 450 868 L 32 450 Z` |
| Board diamond (inner rule line) | `M 450 52 L 848 450 L 450 848 L 52 450 Z` |
| Grid spot | circle, `r = 28` |
| Bear-off spot | circle, `r = 32` |
| Piece body | circle, `r = 30` |
| Piece ring 1 (always) | circle, `r = 25`, stroke only, width 2.5 |
| Piece ring 2 (if kind ≥ 2) | circle, `r = 18`, stroke only, width 2.5 |
| Piece ring 3 (if kind = 3) | circle, `r = 11`, stroke only, width 2.5 |
| Snap-target highlight | circle, `r = 34`, stroke only |
| Hit radius for picking up a piece | 30 |

The board is a **diamond** (square rotated 45°) with the 6×6 grid upright inside it.

### Color tokens

```css
--bg-deepest:       #0a0807;
--bg-darkest:       #110d0a;
--bg-dark:          #18120e;
--bg-panel:         #1f1812;
--bg-panel-hover:   #2a2118;
--bg-panel-active:  #1a3329;

--border-subtle:    #322619;
--border-strong:    #4a3a26;

--text-primary:     #ede4cb;
--text-secondary:   #a09373;
--text-dim:         #6b5e4a;

--board-light:      #6e5a40;
--board-dark:       #423526;
--board-edge:       #2c2218;
--gridspot-light:   #3e3122;
--gridspot-dark:    #2c2218;
--bear-off-light:   #2c2218;
--bear-off-dark:    #1a1410;

--piece-light:      #f4ead0;
--piece-mid:        #d4c498;
--piece-dark:       #8a7550;
--piece-ring:       #1a1108;

--accent-mint:      #6ee7b7;   /* P1 / engine best move / success */
--accent-amber:     #f0a875;   /* P2 */
--accent-blue:      #88a9ff;   /* secondary arrows */
```

Typography: `Inter` (sans), `JetBrains Mono` (mono/numeric).

### Gradients & filters

```
board-gradient    linear, top -> bottom:  --board-light -> --board-dark
piece-gradient    radial at (0.4, 0.35) r 0.7:
                    0%    --piece-light
                    55%   --piece-mid
                    100%  --piece-dark
gridspot-gradient radial center r 0.5:    --gridspot-light -> --gridspot-dark
bearoff-gradient  radial center r 0.5:    --bear-off-light -> --bear-off-dark

board-shadow  feDropShadow dy=14  stdDeviation=22  #000 @ 0.7
piece-shadow  feDropShadow dy=4   stdDeviation=6   #000 @ 0.6
```

Piece movement was tweened at roughly **220 ms** with a cubic-bezier ease.

### Board edge / stroke details

```
board outer stroke:  var(--board-edge), width 2
inner rule line:     rgba(184, 154, 112, 0.18), width 1
spot stroke:         rgba(20, 12, 5, 0.5), width 1
piece body stroke:   #3a2818, width 1
page background:     radial-gradient(ellipse at center, #14100c 0%, var(--bg-deepest) 100%)
```

---

## 6. Interaction model (from the desktop versions)

Preserved as a description of intended feel, not as a requirement.

- Drag a piece with the pointer; drop on an empty square to move.
- Drop on an occupied square to displace — the displaced piece then follows the
  cursor, and a second click places it.
- Pointer Events with `setPointerCapture`, so dragging survives leaving the board.
- Nearest-square snapping while dragging, with a pulsing target ring.
- `←` / `→` step through history; `↑` jumps to the latest position.

**Note:** the desktop UIs performed *no move validation at all* — that was a
deliberate affordance for engine testing. The online version must do the
opposite: the server validates every move and is the sole authority.

---

## 7. Engine protocol (UGI) — for the future "play the engine" feature

The engine (`gyges_engine`, separate project) is a subprocess speaking a
UCI-like line protocol over stdin/stdout. Recorded here so the integration does
not have to be re-derived.

Commands sent to the engine:

```
setoption maxTime <seconds>
setoption maxPly <n>
setoption startPly <n>
setoption increment <n>
setpos <board string> <side>
go
quit
```

Lines received from the engine:

```
info ply <n> score <f> nodes <n> nps <f> abf <f> beta_cuts <n> time <s> bestmove <a|b|c>
bestmove <a|b|c>
```

Any other line is ignored. Note: the `gyges` crate documents itself as
**x86_64 only**, so it will not compile to WebAssembly or ARM without work.
