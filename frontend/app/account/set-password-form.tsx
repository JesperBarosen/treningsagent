"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/states";
import { supabaseBrowser } from "@/lib/supabase/client";

export const MIN_PASSWORD_LENGTH = 8;

type Status = { kind: "idle" | "saving" | "saved" } | { kind: "error"; message: string };

/** Sets (or changes) the signed-in user's password, so they can sign in
 *  without an email link, e.g. from the iPhone home-screen app. */
export function SetPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== password;
  const valid = password.length >= MIN_PASSWORD_LENGTH && confirm === password;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setStatus({ kind: "saving" });
    const { error } = await supabaseBrowser().auth.updateUser({ password });
    if (!error) {
      setPassword("");
      setConfirm("");
      setStatus({ kind: "saved" });
    } else if (error.code === "same_password") {
      setStatus({ kind: "error", message: "That's already your password." });
    } else if (error.code === "weak_password") {
      setStatus({ kind: "error", message: "That password is too weak. Try a longer one." });
    } else if (error.code === "reauthentication_needed") {
      setStatus({
        kind: "error",
        message: "Sign out, sign in again with an email link, and then set your password.",
      });
    } else {
      setStatus({ kind: "error", message: "Couldn't save the password. Try again." });
    }
  }

  const field =
    "min-h-12 w-full rounded-md border border-line bg-surface px-4 text-base focus:border-accent focus:outline-none";

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <div>
        <label htmlFor="new-password" className="mb-1 block text-sm font-medium">
          New password
        </label>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (status.kind !== "saving") setStatus({ kind: "idle" });
          }}
          aria-invalid={tooShort || undefined}
          aria-describedby="password-hint"
          className={field}
        />
        <p id="password-hint" className={`mt-1 text-xs ${tooShort ? "text-danger" : "text-ink-muted"}`}>
          At least {MIN_PASSWORD_LENGTH} characters.
        </p>
      </div>
      <div>
        <label htmlFor="confirm-password" className="mb-1 block text-sm font-medium">
          Repeat password
        </label>
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          aria-invalid={mismatch || undefined}
          aria-describedby={mismatch ? "confirm-hint" : undefined}
          className={field}
        />
        {mismatch && (
          <p id="confirm-hint" className="mt-1 text-xs text-danger">
            The passwords don&apos;t match.
          </p>
        )}
      </div>

      {status.kind === "error" && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {status.message}
        </p>
      )}
      {status.kind === "saved" && (
        <p role="status" className="rounded-md bg-accent-soft px-3 py-2 text-sm">
          Password saved. You can now sign in with your email and this password.
        </p>
      )}

      <Button type="submit" className="mt-1 min-h-12 w-full" disabled={!valid || status.kind === "saving"}>
        {status.kind === "saving" ? "Saving…" : "Set password"}
      </Button>
    </form>
  );
}
