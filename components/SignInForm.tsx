"use client";

import { useActionState } from "react";
import { signInAction, type ActionState } from "@/app/actions";

const initial: ActionState = {};

/**
 * Sign in, or create an account.
 *
 * BOTH actions are always visible as real buttons, and which one you press is
 * carried to the server as `intent`. An earlier version showed one button and
 * hid the other behind a "New here?" toggle, defaulting to signing in — so a
 * newcomer's first act was to press "Sign in" for an account that did not
 * exist, and be told "Incorrect username or password", which is both wrong and
 * unhelpful. The two intentions are equally likely on a landing page, so
 * neither is hidden.
 *
 * The generic sign-in error stays generic on purpose: saying "no such user"
 * would turn this form into a way to test which usernames exist. Making
 * "Create account" impossible to miss is what removes the need to be specific.
 */
export default function SignInForm() {
  const [state, formAction, pending] = useActionState(signInAction, initial);

  return (
    <form action={formAction} className="panel">
      <h2>Play Gygès</h2>
      <p className="muted" style={{ margin: "0 0 14px", lineHeight: 1.5 }}>
        Create an account, or sign in to pick up your games.
      </p>

      <div className="field">
        <label htmlFor="username">Username</label>
        <input
          id="username"
          type="text"
          name="username"
          placeholder="username"
          autoComplete="username"
          maxLength={24}
          required
        />
      </div>

      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          name="password"
          placeholder="password"
          // "current-password" suits the sign-in case; a manager offering a
          // saved password is the more common need on a returning visit, and
          // it still offers to save a new one after account creation.
          autoComplete="current-password"
          maxLength={200}
          required
        />
        <p className="hint">
          New accounts need at least 8 characters. Length matters more than
          symbols — a short phrase beats a mangled word.
        </p>
      </div>

      {/* Which button was pressed decides the action; see signInAction. Both
          carry the same field names, so the browser sends only the one used. */}
      <div className="row">
        <button
          type="submit"
          name="intent"
          value="signup"
          className="btn btn-primary"
          disabled={pending}
          style={{ flex: 1 }}
        >
          {pending ? "…" : "Create account"}
        </button>
        <button
          type="submit"
          name="intent"
          value="signin"
          className="btn"
          disabled={pending}
          style={{ flex: 1 }}
        >
          {pending ? "…" : "Sign in"}
        </button>
      </div>

      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}
