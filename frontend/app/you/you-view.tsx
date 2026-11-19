"use client";

import Link from "next/link";
import { ChevronIcon, KeyIcon, ListIcon, PinIcon, PlanIcon, SignOutIcon } from "@/components/icons";
import { useSignOut } from "@/components/nav";
import { BreakSection } from "@/components/break-section";
import { ThemeToggle } from "@/components/theme-toggle";

/** The You tab (N3): what used to sit in the top-right corner, now in thumb
 *  reach as full-width rows. On desktop the top bar has theme, account and sign
 *  out, and the Account page has the break section. */
export function YouView() {
  const { busy, signOut } = useSignOut();
  const row = "flex min-h-14 w-full items-center gap-4 px-5 py-3 text-left";
  return (
    <div className="pt-4 pb-12">
      <h1 className="font-display text-xl font-semibold">You</h1>
      <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-surface">
        <li className={row}>
          <span className="flex-1 font-medium">Light or dark</span>
          <ThemeToggle />
        </li>
        <li>
          {/* The Plan view has no tab of its own (Q2, variant A). */}
          <Link href="/plan" className={`${row} hover:bg-sunken`}>
            <PlanIcon size={20} />
            <span className="flex-1">
              <span className="block font-medium">Plan</span>
              <span className="block text-sm text-ink-muted">Your training plan, week by week</span>
            </span>
            <ChevronIcon size={18} />
          </Link>
        </li>
        <li>
          <Link href="/templates" className={`${row} hover:bg-sunken`}>
            <ListIcon size={20} />
            <span className="flex-1">
              <span className="block font-medium">Log forms</span>
              <span className="block text-sm text-ink-muted">Your own fields per kind of session</span>
            </span>
            <ChevronIcon size={18} />
          </Link>
        </li>
        <li>
          <Link href="/gyms" className={`${row} hover:bg-sunken`}>
            <PinIcon size={20} />
            <span className="flex-1">
              <span className="block font-medium">Gyms</span>
              <span className="block text-sm text-ink-muted">Colour circuits and their approximate grades</span>
            </span>
            <ChevronIcon size={18} />
          </Link>
        </li>
        <li>
          <Link href="/account" className={`${row} hover:bg-sunken`}>
            <KeyIcon size={20} />
            <span className="flex-1">
              <span className="block font-medium">Account</span>
              <span className="block text-sm text-ink-muted">Password, breaks, charts and coach settings</span>
            </span>
            <ChevronIcon size={18} />
          </Link>
        </li>
        <li>
          <button
            type="button"
            onClick={signOut}
            disabled={busy}
            className={`${row} text-danger hover:bg-sunken disabled:opacity-40`}
          >
            <SignOutIcon size={20} />
            <span className="flex-1 font-medium">{busy ? "Signing out…" : "Sign out"}</span>
          </button>
        </li>
      </ul>

      <BreakSection className="mt-6" />
    </div>
  );
}
