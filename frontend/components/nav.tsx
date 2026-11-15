"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { PUBLIC_PATHS } from "@/lib/supabase/config";
import { DiscreetToggle } from "@/components/discreet-toggle";
import { ThemeToggle } from "@/components/theme-toggle";
import { supabaseBrowser } from "@/lib/supabase/client";
import { clearSavedChats } from "@/lib/chat-storage";
import { ChartIcon, ChatIcon, KeyIcon, ListIcon, PlusIcon, SignOutIcon, UserIcon } from "./icons";

const LINKS = [
  { href: "/", label: "Coach", Icon: ChatIcon },
  { href: "/log", label: "Log", Icon: PlusIcon },
  { href: "/sessions", label: "Sessions", Icon: ListIcon },
  { href: "/dashboard", label: "Dashboard", Icon: ChartIcon },
];

function Wordmark() {
  return (
    <span className="font-display text-lg font-semibold tracking-tight">
      trening<span className="text-accent">s</span>agent
    </span>
  );
}

const isPublic = (pathname: string) => PUBLIC_PATHS.includes(pathname);

/** Sign out and land on /sign-in; shared by the top bar and the You page. */
export function useSignOut() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    clearSavedChats(); // the next person on this browser must not see this chat
    await supabaseBrowser().auth.signOut();
    router.replace("/sign-in");
    router.refresh();
  }
  return { busy, signOut };
}

function SignOutButton() {
  const { busy, signOut } = useSignOut();
  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      aria-label="Sign out"
      title="Sign out"
      className="-mr-2 grid size-11 place-items-center rounded-full text-ink-muted transition hover:bg-sunken hover:text-ink disabled:opacity-40"
    >
      <SignOutIcon size={20} />
    </button>
  );
}

/** Top bar with the wordmark, the theme switch, account and sign out; from `md` it also holds the links. */
export function TopBar() {
  const pathname = usePathname();
  const signedIn = !isPublic(pathname);
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-canvas/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="rounded-sm">
          <Wordmark />
        </Link>
        <div className="flex items-center gap-2">
          {signedIn && (
            <nav aria-label="Main" className="hidden gap-1 md:flex">
              {LINKS.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  aria-current={pathname === href ? "page" : undefined}
                  className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium text-ink-muted hover:text-ink aria-[current=page]:bg-accent-soft aria-[current=page]:text-accent"
                >
                  {label}
                </Link>
              ))}
            </nav>
          )}
          {/* Discreet stays in the top bar on every width, so its pill is always visible. */}
          {signedIn && <DiscreetToggle />}
          {/* Signed in, on mobile, theme, account and sign out live on the You tab
              (N3: the top corners are hardest to reach one-handed). Signed out
              there is no You tab, so the theme switch stays here. */}
          <div className={`items-center gap-2 ${signedIn ? "hidden md:flex" : "flex"}`} data-testid="top-bar-account">
            <ThemeToggle />
            {signedIn && (
              <>
                <Link
                  href="/account"
                  aria-label="Account"
                  title="Account"
                  aria-current={pathname === "/account" ? "page" : undefined}
                  className="grid size-11 place-items-center rounded-full text-ink-muted transition hover:bg-sunken hover:text-ink aria-[current=page]:bg-accent-soft aria-[current=page]:text-accent"
                >
                  <KeyIcon size={20} />
                </Link>
                <SignOutButton />
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

/** The mobile tabs (N3): Log, the most frequent action, is a raised button in
 *  the centre, the most comfortable thumb zone (Parhi p. 208); account things
 *  move from the top corner to You. */
export const TABS = [
  { href: "/", label: "Coach", Icon: ChatIcon },
  { href: "/sessions", label: "Sessions", Icon: ListIcon },
  { href: "/log", label: "Log", Icon: PlusIcon, raised: true },
  { href: "/dashboard", label: "Dashboard", Icon: ChartIcon },
  { href: "/you", label: "You", Icon: UserIcon },
];

/** Bottom tab bar on mobile. */
export function TabBar() {
  const pathname = usePathname();
  if (isPublic(pathname)) return null;
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="mx-auto flex max-w-md">
        {TABS.map(({ href, label, Icon, raised }) => (
          <li key={href} className="flex-1">
            <Link
              href={href}
              aria-current={pathname === href ? "page" : undefined}
              className="group flex h-(--tab-bar-h) flex-col items-center justify-center gap-0.5 text-xs font-medium text-ink-muted aria-[current=page]:text-accent"
            >
              {raised ? (
                // Raised: a filled accent circle lifted half above the bar.
                <span className="-mt-6 grid size-12 place-items-center rounded-full bg-accent text-on-accent shadow-sheet ring-4 ring-surface">
                  <Icon size={22} />
                </span>
              ) : (
                <span className="grid h-7 w-12 place-items-center rounded-full group-aria-[current=page]:bg-accent-soft">
                  <Icon size={20} />
                </span>
              )}
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
