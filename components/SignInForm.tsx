"use client";

import { useActionState } from "react";
import { signInAction, type ActionState } from "@/app/actions";

const initial: ActionState = {};

export default function SignInForm() {
  const [state, formAction, pending] = useActionState(signInAction, initial);

  return (
    <form action={formAction} className="panel">
      <h2>Sign in</h2>
      <p className="muted" style={{ margin: "0 0 14px", lineHeight: 1.5 }}>
        Pick a name to start playing. If it is free it becomes yours.
      </p>
      <div className="row">
        <input
          type="text"
          name="username"
          placeholder="username"
          autoComplete="off"
          maxLength={24}
          required
          style={{ flex: 1, minWidth: 0 }}
        />
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "…" : "Continue"}
        </button>
      </div>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}
