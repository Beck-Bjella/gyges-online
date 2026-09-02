import MiniBoard from "@/components/MiniBoard";
import { emptyBoard, type BoardState } from "@/lib/game/board";

export const metadata = { title: "Rules · Gygès" };

/**
 * A position built by naming the squares that hold pieces.
 *
 * Squares run from the near player's left along their home row and upward:
 * 0–5 is the nearest row, 6–11 the one above it. Every diagram below is drawn
 * from the near player's side, the way the board faces whoever is looking at
 * it.
 */
function position(pieces: Record<number, number>): BoardState {
  const board = emptyBoard();
  for (const [square, rings] of Object.entries(pieces)) {
    board[Number(square)] = rings;
  }
  return board;
}

export default function RulesPage() {
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Rules of Gygès</h1>
          <p className="lede" style={{ marginBottom: 0 }}>
            Gygès is an abstract game for two players. Nobody owns the pieces —
            you may only move a piece in the row nearest to you.
          </p>
        </div>
      </header>

      <div className="panel prose">
        <h2>Object</h2>
        <p>
          Move a piece into your opponent&apos;s goal, the space beyond their
          back row.
        </p>

        <h2>Moving</h2>
        <ul>
          <li>
            You may move any piece in your <strong>active line</strong> — the row
            nearest you that still contains pieces.
          </li>
          <li>
            A piece moves <strong>exactly</strong> as many spaces as it has
            rings: one, two, or three. Movement is orthogonal, and a move may not
            revisit a space.
          </li>
          <li>
            If a piece lands on another piece part-way, it continues using{" "}
            <strong>that</strong> piece&apos;s ring count instead. This can chain
            several times.
          </li>
          <li>
            If a piece finishes its movement on an occupied space, it may
            instead <strong>displace</strong> that piece to any empty space on
            the board.
          </li>
        </ul>

        {/*
          Those four sentences are the whole game, and three of them are hard
          to hold from words — particularly the chain, where a piece finishes
          its move under a ring count that was never its own. You are the near
          player in every diagram.
        */}
        <div className="figures">
          <figure>
            <MiniBoard
              board={position({ 1: 1, 3: 2, 8: 3, 10: 1 })}
              mark={[1, 3]}
              size={148}
            />
            <figcaption>
              <strong>The active line.</strong> The nearest row still holding
              pieces is the only one you may move from — the two marked here.
              The pieces behind them are not yours to move yet.
            </figcaption>
          </figure>

          <figure>
            <MiniBoard board={position({ 14: 2 })} lastMove="14|26" size={148} />
            <figcaption>
              <strong>Rings are distance.</strong> Two rings travels exactly two
              spaces — never one, never three. Orthogonally, and never back over
              its own path.
            </figcaption>
          </figure>

          <figure>
            <MiniBoard
              board={position({ 13: 1, 19: 2 })}
              lastMove="13|19"
              size={148}
            />
            <figcaption>
              <strong>Landing on a piece, 1 of 2.</strong> The single ring moves
              its one space, and finds the two-ring piece standing there.
            </figcaption>
          </figure>

          <figure>
            <MiniBoard
              board={position({ 19: 2, 13: 1 })}
              lastMove="19|31"
              size={148}
            />
            <figcaption>
              <strong>Landing on a piece, 2 of 2.</strong> It carries on with{" "}
              <em>that</em> piece&apos;s count — two more spaces — and chains
              again if it lands on another.
            </figcaption>
          </figure>

          <figure>
            <MiniBoard
              board={position({ 8: 2, 20: 1 })}
              lastMove="8|20|33"
              size={148}
            />
            <figcaption>
              <strong>Displacement.</strong> A piece that <em>finishes</em> on an
              occupied space may send the occupant to any empty space on the
              board — the dashed leg. A way to move your opponent&apos;s
              position as well as your own.
            </figcaption>
          </figure>
        </div>

        <h2>On this site</h2>
        <p>
          The rules above are <strong>enforced</strong>. The server checks every
          move and rejects anything the rules do not allow, so you cannot make
          an illegal move by accident — and neither can your opponent.
        </p>
        <p>
          While you drag a piece, the squares it can legally reach are marked.
          That is a convenience; the server checks the move again when you let
          go, and it is the server that decides.
        </p>
      </div>
    </>
  );
}
