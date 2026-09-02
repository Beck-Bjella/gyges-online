import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { answerDraw, offerDraw, GameError } from "@/lib/db/queries";

/**
 * The draw conversation: either player offers, the other answers.
 * Body: { op: "offer" | "accept" | "decline" }.
 *
 * "decline" also withdraws your own offer — clearing the offer is one
 * operation whichever side asks for it.
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
        ? offerDraw(id, user.id)
        : body.op === "accept" || body.op === "decline"
          ? answerDraw(id, user.id, body.op === "accept")
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
