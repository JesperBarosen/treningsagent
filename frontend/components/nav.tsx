"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChartIcon, ChatIcon, ListIcon } from "./icons";

const LINKS = [
  { href: "/", label: "Coach", Icon: ChatIcon },
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

/** Top bar with the wordmark; from `md` it also holds the links. */
export function TopBar() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-canvas/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="rounded-sm">
          <Wordmark />
        </Link>
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
      </div>
    </header>
  );
}

/** Bottom tab bar on mobile. */
export function TabBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="mx-auto flex max-w-md">
        {LINKS.map(({ href, label, Icon }) => (
          <li key={href} className="flex-1">
            <Link
              href={href}
              aria-current={pathname === href ? "page" : undefined}
              className="group flex h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium text-ink-muted aria-[current=page]:text-accent"
            >
              <span className="grid h-7 w-12 place-items-center rounded-full group-aria-[current=page]:bg-accent-soft">
                <Icon size={20} />
              </span>
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
