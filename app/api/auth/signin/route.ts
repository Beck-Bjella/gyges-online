import { NextResponse } from "next/server";
import { signIn } from "@/lib/auth";

/**
 * Sign in, creating the account if the name is free.
 *
 * The web pages use the server action in app/actions.ts; this route exists for
 * programmatic clients and the smoke test. Both share lib/auth.
 */
export async function POST(req: Request) {
  let username: string;
  try {
    const body = (await req.json()) as { username?: unknown };
    if (typeof body.username !== "string") throw new Error("bad username");
    username = body.username;
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  try {
    const user = await signIn(username);
    return NextResponse.json({ user });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not sign in." },
      { status: 400 },
    );
  }
}
