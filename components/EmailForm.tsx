"use client";

import { useActionState } from "react";
import { setEmailAction, type ActionState } from "@/app/actions";

const initial: ActionState = {};

/**
 * The optional email on your account.
 *
 * Says plainly that it is optional and that nothing is sent yet, because an
 * address box on a game site with no explanation reads as a mailing list.
 */
export default function EmailForm({ current }: { current: string | null }) {
  const [state, formAction, pending] = useActionState(setEmailAction, initial);

  return (
    <form action={formAction} className="account-field">
      <label htmlFor="account-email">Email — optional</label>
      <div className="row">
        <input
          id="account-email"
          type="email"
          name="email"
          defaultValue={current ?? ""}
          maxLength={254}
          placeholder="nobody@example.com"
          autoComplete="email"
        />
        <button type="submit" className="btn" disabled={pending}>
          {pending ? "…" : "Save"}
        </button>
      </div>
      <p className="hint">
        Nothing is sent to it yet. It is stored so that a note when it is your
        move, and a way back into your account if you forget your password, have
        somewhere to go once those are built. Clear the box to remove it.
      </p>
      {state.error && <p className="error">{state.error}</p>}
      {state.message && <p className="notice">{state.message}</p>}
    </form>
  );
}
