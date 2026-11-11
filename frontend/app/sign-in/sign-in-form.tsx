"use client";

import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { MailIcon } from "@/components/icons";
import { Button } from "@/components/states";
import { supabaseBrowser } from "@/lib/supabase/client";

type Status = { kind: "idle" | "sending" } | { kind: "sent"; email: string } | { kind: "error"; message: string };

export function SignInFormFromUrl() {
  return <SignInForm linkFailed={useSearchParams().get("error") === "link"} />;
}

export function SignInForm({ linkFailed = false }: { linkFailed?: boolean }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>(
    linkFailed
      ? { kind: "error", message: "That sign-in link has expired or was already used. Request a new one." }
      : { kind: "idle" },
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const address = email.trim();
    if (!address) return;
    setStatus({ kind: "sending" });
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email: address,
      // Invite only: never create an account here (sign-ups are also off in Supabase).
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/auth/confirm` },
    });
    if (error?.status === 429) {
      setStatus({ kind: "error", message: "Too many sign-in emails. Wait a few minutes and try again." });
    } else if (error && error.status !== 400 && error.status !== 422) {
      setStatus({ kind: "error", message: "Couldn't send the link. Try again." });
    } else {
      // Unknown addresses get the same answer, so the form doesn't reveal who is invited.
      setStatus({ kind: "sent", email: address });
    }
  }

  if (status.kind === "sent") {
    return (
      <div className="animate-rise text-center" role="status">
        <div className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-accent-soft text-accent">
          <MailIcon size={26} />
        </div>
        <h1 className="font-display text-xl font-semibold">Check your email</h1>
        <p className="mt-2 text-sm text-ink-muted">
          If <span className="font-medium text-ink">{status.email}</span> has access, a sign-in link is on its
          way. Open it on this device.
        </p>
        <Button variant="ghost" className="mt-6" onClick={() => setStatus({ kind: "idle" })}>
          Use another email
        </Button>
      </div>
    );
  }

  return (
    <div className="animate-rise">
      <h1 className="font-display text-xl font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-ink-muted">
        We&apos;ll email you a link. treningsagent is invite only.
      </p>
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-3">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={status.kind === "error" || undefined}
          aria-describedby={status.kind === "error" ? "sign-in-error" : undefined}
          className="min-h-12 rounded-md border border-line bg-surface px-4 text-base placeholder:text-ink-muted focus:border-accent focus:outline-none"
          placeholder="you@example.com"
        />
        {status.kind === "error" && (
          <p id="sign-in-error" role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            {status.message}
          </p>
        )}
        <Button type="submit" className="mt-1 min-h-12 w-full" disabled={status.kind === "sending"}>
          {status.kind === "sending" ? "Sending…" : "Email me a sign-in link"}
        </Button>
      </form>
    </div>
  );
}
