import MiniBoard from "@/components/MiniBoard";
import { emptyBoard, type BoardState } from "@/lib/game/board";

export const metadata = { title: "Rules · Gygès" };

/**
 * A position built by naming the squares that hold pieces.
 *
 * Squares run from the near player's left along their home row and upward:
 * 0–5 is the nearest row, 6–11 the one above it, 37 the far goal. Every
 * diagram is drawn from the near player's side, the way the board faces
 * whoever is looking at it.
 */
function position(pieces: Record<number, number>): BoardState {
  const board = emptyBoard();
  for (const [square, rings] of Object.entries(pieces)) {
    board[Number(square)] = rings;
  }
  return board;
}

/**
 * One rule: what it says, and what it looks like.
 *
 * Paired rather than stacked, because the whole reason the diagrams are here
 * is that three of these four rules are much easier to see than to read — and
 * a diagram three paragraphs below its sentence is a diagram you have to hold
 * two things in your head to use.
 */
function Rule({
  title,
  children,
  figures,
}: {
  title: string;
  children: React.ReactNode;
  figures: React.ReactNode;
}) {
  return (
    <article className="rule">
      <div className="rule-text">
        <h2>{title}</h2>
        {children}
      </div>
      <div className="rule-figures">{figures}</div>
    </article>
  );
}

function Figure({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <figure>
      {children}
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

export default function RulesPage() {
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Rules of Gygès</h1>
          <p className="lede" style={{ marginBottom: 0 }}>
            An abstract game for two players. Nobody owns the pieces — you may
            only move a piece in the row nearest to you, whoever put it there.
          </p>
        </div>
      </header>

      <div className="rules">
        <Rule
          title="The object"
          figures={
            <Figure caption="A piece arrives in the far goal. That ends it.">
              <MiniBoard
                board={position({ 37: 1, 26: 2, 15: 3, 9: 1 })}
                lastMove="32|37"
                size={150}
              />
            </Figure>
          }
        >
          <p>
            Move a piece into your opponent&apos;s goal — the single space
            beyond their back row. The first player to do it wins, and that is
            the only way to win at the board.
          </p>
          <p className="muted">
            There is no capturing in Gygès, and no material to count. Every
            piece stays on the board all game.
          </p>
        </Rule>

        <Rule
          title="Your active line"
          figures={
            <Figure caption="Only the two marked pieces may move — the nearest row that still has any.">
              <MiniBoard
                board={position({ 1: 1, 3: 2, 8: 3, 10: 1 })}
                mark={[1, 3]}
                size={150}
              />
            </Figure>
          }
        >
          <p>
            You may move any piece in your <strong>active line</strong>: the row
            nearest you that still contains pieces. Not your pieces —{" "}
            <em>the</em> pieces. Nobody owns them, so the same piece may be
            moved by you this turn and by your opponent later.
          </p>
          <p className="muted">
            Empty your nearest row and the line falls back to the next one,
            which changes what you may touch — and what they may.
          </p>
        </Rule>

        <Rule
          title="Rings are distance"
          figures={
            <Figure caption="Two rings travels exactly two spaces.">
              <MiniBoard board={position({ 14: 2 })} lastMove="14|26" size={150} />
            </Figure>
          }
        >
          <p>
            A piece moves <strong>exactly</strong> as many spaces as it has
            rings — one, two or three. Not up to that many: exactly that many.
          </p>
          <p className="muted">
            Movement is orthogonal, it may turn corners, and it may never
            revisit a space it has already crossed during the same move.
          </p>
        </Rule>

        <Rule
          title="Landing on a piece"
          figures={
            <>
              <Figure caption="The single ring moves its one space, and finds a two-ring piece there.">
                <MiniBoard
                  board={position({ 13: 1, 19: 2 })}
                  lastMove="13|19"
                  size={150}
                />
              </Figure>
              <Figure caption="So it carries on with that piece's count — two more spaces.">
                <MiniBoard
                  board={position({ 19: 2, 13: 1 })}
                  lastMove="19|31"
                  size={150}
                />
              </Figure>
            </>
          }
        >
          <p>
            If a piece lands on another piece part-way through its move, it
            continues using <strong>that</strong> piece&apos;s ring count
            instead of its own. This can chain several times in one move.
          </p>
          <p className="muted">
            It is the rule that makes the game: a one-ring piece can cross the
            whole board if the pieces in its way are generous, and the position
            you leave behind decides what your opponent can reach.
          </p>
        </Rule>

        <Rule
          title="Displacement"
          figures={
            <Figure caption="Finishing on an occupied space: the occupant goes anywhere empty — the dashed leg.">
              <MiniBoard
                board={position({ 8: 2, 20: 1 })}
                lastMove="8|20|33"
                size={150}
              />
            </Figure>
          }
        >
          <p>
            If a piece <em>finishes</em> its movement on an occupied space, it
            may instead <strong>displace</strong> the piece standing there,
            sending it to any empty space on the board.
          </p>
          <p className="muted">
            Anywhere at all — which makes it a way of rearranging your
            opponent&apos;s half of the board as much as your own. Keeping a
            three-ring piece away from their active line is often worth more
            than advancing.
          </p>
        </Rule>
      </div>

      <div className="panel prose" style={{ marginTop: 8 }}>
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
        <p>
          Every game begins from an empty board: each player arranges their own
          back row before play starts, so the first decision of the game is the
          shape of your own line.
        </p>
      </div>
    </>
  );
}
