import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { undoTurn, GameError } from "@/lib/db/queries";

/**
 * Give the last move back — see undoTurn for who may, and what it removes.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  try {
    const game = undoTurn(id, user.id);
    return NextResponse.json({ game });
  } catch (err) {
    if (err instanceof GameError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Could not take that back." }, { status: 500 });
  }
}
