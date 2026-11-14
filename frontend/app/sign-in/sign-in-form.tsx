"use client";

import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { MailIcon } from "@/components/icons";
import { Button, HIT_AREA_Y } from "@/components/states";
import { supabaseBrowser } from "@/lib/supabase/client";

type Method = "link" | "password";
type Status = { kind: "idle" | "sending" } | { kind: "sent"; email: string } | { kind: "error"; message: string };

const METHODS: { value: Method; label: string }[] = [
  { value: "link", label: "Email link" },
  { value: "password", label: "Password" },
];

export function SignInFormFromUrl() {
  return <SignInForm linkFailed={useSearchParams().get("error") === "link"} />;
}

export function SignInForm({ linkFailed = false }: { linkFailed?: boolean }) {
  const [method, setMethod] = useState<Method>("link");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>(
    linkFailed
      ? { kind: "error", message: "That sign-in link didn't work. It may have expired or been used, or been opened in another browser. Request a new one here, or sign in with your password." }
      : { kind: "idle" },
  );

  async function sendLink(address: string) {
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email: address,
      // Invite only: never create an account here (sign-ups are also off in Supabase).
      // The link lands on /auth/confirm (http://localhost:3000/auth/confirm in dev),
      // which must be in Supabase's redirect URL allow list.
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

  async function signInWithPassword(address: string) {
    // Signs in only an existing (invited) user; this never creates an account.
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email: address, password });
    if (!error) {
      // A full page load, so the proxy sees the new session cookie.
      window.location.replace(`${window.location.origin}/`);
      return;
    }
    setPassword("");
    if (error.status === 429) {
      setStatus({ kind: "error", message: "Too many attempts. Wait a few minutes and try again." });
    } else if (error.status === 400) {
      // Same message for an unknown address and a wrong password.
      setStatus({ kind: "error", message: "Wrong email or password. No password yet? Use an email link, then set one under Account." });
    } else {
      setStatus({ kind: "error", message: "Couldn't sign in. Try again." });
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const address = email.trim();
    if (!address || (method === "password" && !password)) return;
    setStatus({ kind: "sending" });
    await (method === "link" ? sendLink(address) : signInWithPassword(address));
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
          way. Open it in this browser.
        </p>
        <Button variant="ghost" className="mt-6" onClick={() => setStatus({ kind: "idle" })}>
          Use another email
        </Button>
      </div>
    );
  }

  const field =
    "min-h-12 rounded-md border border-line bg-surface px-4 text-base placeholder:text-ink-muted focus:border-accent focus:outline-none";
  const errorProps =
    status.kind === "error" ? { "aria-invalid": true, "aria-describedby": "sign-in-error" } : {};

  return (
    <div className="animate-rise">
      <h1 className="font-display text-xl font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-ink-muted">
        {method === "link" ? "We'll email you a link." : "Use the password you set under Account."} treningsagent
        is invite only.
      </p>

      <div
        role="radiogroup"
        aria-label="Sign-in method"
        className="mt-6 grid grid-cols-2 rounded-full border border-line bg-surface p-1"
      >
        {METHODS.map((m) => (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={method === m.value}
            onClick={() => {
              setMethod(m.value);
              if (status.kind === "error") setStatus({ kind: "idle" });
            }}
            className={`min-h-10 rounded-full text-sm font-medium text-ink-muted aria-checked:bg-accent-soft aria-checked:text-accent ${HIT_AREA_Y}`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-3">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete={method === "password" ? "username" : "email"}
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          {...errorProps}
          className={field}
          placeholder="you@example.com"
        />
        {method === "password" && (
          <>
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              {...errorProps}
              className={field}
            />
          </>
        )}
        {status.kind === "error" && (
          <p id="sign-in-error" role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            {status.message}
          </p>
        )}
        <Button type="submit" className="mt-1 min-h-12 w-full" disabled={status.kind === "sending"}>
          {method === "link"
            ? status.kind === "sending"
              ? "Sending…"
              : "Email me a sign-in link"
            : status.kind === "sending"
              ? "Signing in…"
              : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
