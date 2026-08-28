"use client";

import { useActionState, useState } from "react";
import { renameAction, type ActionState } from "@/app/actions";

const initial: ActionState = {};

export default function RenameForm({ current }: { current: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(renameAction, initial);

  if (!open) {
    return (
      <button className="btn" onClick={() => setOpen(true)}>
        Change username
      </button>
    );
  }

  return (
    <form action={formAction}>
      <div className="row">
        <input
          type="text"
          name="username"
          defaultValue={current}
          maxLength={24}
          autoComplete="off"
          required
        />
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "…" : "Save"}
        </button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <p className="muted" style={{ margin: "10px 0 0", lineHeight: 1.5 }}>
        Your games, history and rating all follow you — they are tied to your
        account, not your name.
      </p>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}
