"use client";

import { signOutAction } from "@/app/actions";

export default function SignOutButton() {
  return (
    <form action={signOutAction}>
      <button type="submit" className="btn">
        Sign out
      </button>
    </form>
  );
}
