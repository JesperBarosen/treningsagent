import type { ReactNode } from "react";
import { API_URL } from "@/lib/api";
import { OfflineIcon, RefreshIcon } from "./icons";

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-md bg-sunken ${className}`} />;
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex animate-rise flex-col items-center px-6 py-12 text-center">
      <div className="mb-4 grid size-14 place-items-center rounded-full bg-sunken text-ink-muted">
        {icon}
      </div>
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      {children && <div className="mt-1 max-w-xs text-sm text-ink-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** For a failed load. `offline` (status null) means the backend wasn't reachable. */
export function ErrorState({
  offline,
  message,
  onRetry,
}: {
  offline: boolean;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div role="alert">
      <EmptyState
        icon={<OfflineIcon size={26} />}
        title={offline ? "Can't reach the backend" : "Something went wrong"}
        action={
          <Button onClick={onRetry}>
            <RefreshIcon size={18} /> Try again
          </Button>
        }
      >
        {offline ? <OfflineHint /> : message}
      </EmptyState>
    </div>
  );
}

/** What to do when the backend can't be reached. The API hint is for
 *  developers only; people using the app get plain advice. */
export function OfflineHint() {
  if (process.env.NODE_ENV !== "development") return <>Check your connection and try again.</>;
  return (
    <>
      Is the API running at <code className="font-medium whitespace-nowrap text-ink">{API_URL}</code>? Start
      it with <code className="font-medium whitespace-nowrap text-ink">uv run uvicorn api:app</code>.
    </>
  );
}

/** Grows a control's hit area 4 px above and below without changing how it
 *  looks, so a 36 px pill inside a padded group is a 44 px target (DESIGN.md:
 *  every tap target at least 44x44). Needs no `overflow-hidden` on the control. */
export const HIT_AREA_Y = "relative before:absolute before:inset-x-0 before:-inset-y-1";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" }) {
  const look =
    variant === "primary"
      ? "bg-accent text-on-accent hover:opacity-90"
      : "text-ink hover:bg-sunken";
  return (
    <button
      type="button"
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition disabled:opacity-40 ${look} ${className}`}
      {...props}
    />
  );
}
