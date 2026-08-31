import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { dashboardVersion } from "@/lib/db/queries";

/**
 * The signed-in player's dashboard version — games, friendships and
 * challenges folded into one string for the polling probe.
 */
export async function GET() {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  return NextResponse.json({ v: dashboardVersion(user.id) });
}
