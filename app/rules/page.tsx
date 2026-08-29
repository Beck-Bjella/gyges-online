export const metadata = { title: "Rules · Gygès" };

export default function RulesPage() {
  return (
    <>
      <h1>Rules of Gygès</h1>
      <p className="lede">
        Gygès is an abstract game for two players. Nobody owns the pieces — you
        may only move a piece in the row nearest to you.
      </p>

      <div className="panel" style={{ lineHeight: 1.7, maxWidth: "68ch" }}>
        <h2>Object</h2>
        <p style={{ marginTop: 0 }}>
          Move a piece into your opponent&apos;s goal, the space beyond their
          back row.
        </p>

        <h2>Moving</h2>
        <ul style={{ paddingLeft: 20 }}>
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
