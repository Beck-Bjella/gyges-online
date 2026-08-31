import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { answerTakeback, offerTakeback, GameError } from "@/lib/db/queries";

/**
 * The takeback conversation: the winner offers, the loser answers.
 * Body: { op: "offer" | "accept" | "decline" }.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { op?: string };
  try {
    const game =
      body.op === "offer"
        ? offerTakeback(id, user.id)
        : body.op === "accept" || body.op === "decline"
          ? answerTakeback(id, user.id, body.op === "accept")
          : null;
    if (!game) return NextResponse.json({ error: "Unknown request." }, { status: 400 });
    return NextResponse.json({ game });
  } catch (err) {
    if (err instanceof GameError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Could not do that." }, { status: 500 });
  }
}
