import { NextResponse } from "next/server";
import { signIn, signUp } from "@/lib/auth";

/**
 * Sign in, or create an account when `signup: true` is sent.
 *
 * The web pages use the server action in app/actions.ts; this route exists for
 * programmatic clients and the smoke test. Both share lib/auth.
 */
export async function POST(req: Request) {
  let username: string;
  let password: string;
  let signup = false;
  try {
    const body = (await req.json()) as {
      username?: unknown;
      password?: unknown;
      signup?: unknown;
    };
    if (typeof body.username !== "string") throw new Error("bad username");
    if (typeof body.password !== "string") throw new Error("bad password");
    username = body.username;
    password = body.password;
    signup = body.signup === true;
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  try {
    const user = signup
      ? await signUp(username, password)
      : await signIn(username, password);
    return NextResponse.json({ user });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not sign in." },
      { status: 400 },
    );
  }
}
