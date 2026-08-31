import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { claimTimeout, GameError } from "@/lib/db/queries";

/** Claim the win from an opponent whose clock ran out. Never automatic. */
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
    const game = claimTimeout(id, user.id);
    return NextResponse.json({ game });
  } catch (err) {
    if (err instanceof GameError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Could not claim." }, { status: 500 });
  }
}
