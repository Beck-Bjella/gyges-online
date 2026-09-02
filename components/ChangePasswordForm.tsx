"use client";

import { useActionState, useState } from "react";
import { changePasswordAction, type ActionState } from "@/app/actions";

const initial: ActionState = {};

/**
 * Change your password.
 *
 * Behind a button rather than always open: three password boxes is the
 * heaviest thing on the account panel, and almost nobody arrives wanting to
 * use them. The current password is required — a session left open on a shared
 * machine should not be enough to take the account over.
 */
export default function ChangePasswordForm() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(changePasswordAction, initial);

  if (!open) {
    return (
      <div className="account-field">
        <span className="account-label">Password</span>
        <button className="btn" onClick={() => setOpen(true)}>
          Change password
        </button>
        {/* A change made and then collapsed still says so — closing the form
            is not a reason to take the confirmation away. */}
        {state.message && <p className="notice">{state.message}</p>}
      </div>
    );
  }

  return (
    <form action={formAction} className="account-field">
      <label htmlFor="current_password">Password</label>
      <div className="field">
        <input
          id="current_password"
          type="password"
          name="current_password"
          placeholder="Current password"
          autoComplete="current-password"
          required
        />
      </div>
      <div className="field">
        <input
          type="password"
          name="new_password"
          placeholder="New password"
          autoComplete="new-password"
          required
        />
      </div>
      <div className="field">
        <input
          type="password"
          name="confirm_password"
          placeholder="New password again"
          autoComplete="new-password"
          required
        />
      </div>
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "…" : "Change password"}
        </button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {state.error && <p className="error">{state.error}</p>}
      {state.message && <p className="notice">{state.message}</p>}
    </form>
  );
}
