import type { SVGProps } from "react";
import type { Sport } from "@/lib/api";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 20, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

/** A winding route with start and finish: running. */
export const RunIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="5" cy="18.5" r="2" />
    <path d="M7 18.5h7.5a3.5 3.5 0 0 0 0-7h-5a3.5 3.5 0 0 1 0-7H17" />
    <path d="m15 2 2.5 2.5L15 7" />
  </Icon>
);

/** A carabiner: climbing. */
export const ClimbIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9.5 3.5h3.2a4.3 4.3 0 0 1 4.2 5.2l-2.2 10.1a2.9 2.9 0 0 1-2.8 2.2h-2a3.6 3.6 0 0 1-3.5-4.3L8.3 4.5a1.2 1.2 0 0 1 1.2-1Z" />
    <path d="m14.3 7.2-1.6 7.3" />
  </Icon>
);

export const ChatIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 12.5a7.5 7.5 0 0 1-11 6.6L4 20l1-4.4A7.5 7.5 0 1 1 20 12.5Z" />
  </Icon>
);

export const ListIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="4" width="17" height="16" rx="3" />
    <path d="M3.5 9h17M8 13h8M8 16.5h5" />
  </Icon>
);

export const SendIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Icon>
);

export const BoltIcon = (p: IconProps) => (
  <Icon {...p} strokeWidth={0} fill="currentColor">
    <path d="M13.2 2 5 13.4h5.6L9.8 22 18 10.6h-5.6L13.2 2Z" />
  </Icon>
);

export const CheckIcon = (p: IconProps) => (
  <Icon {...p} strokeWidth={2.4}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);

export const RefreshIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
  </Icon>
);

export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const ChevronIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m9 6 6 6-6 6" />
  </Icon>
);

export const OfflineIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2 8.5a15 15 0 0 1 4.2-2.7M22 8.5A15 15 0 0 0 10.3 5M5.5 12a10 10 0 0 1 3.3-2M18.5 12a10 10 0 0 0-3-1.8M9 15.5a4.5 4.5 0 0 1 6 0" />
    <circle cx="12" cy="19" r="0.6" fill="currentColor" />
    <path d="m3 3 18 18" />
  </Icon>
);

/** Three columns of rising height: the dashboard. */
export const ChartIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 20h16" />
    <path d="M7 16v-4M12 16V8M17 16V5" strokeWidth={2.4} />
  </Icon>
);

/** The sport's icon on its soft sport colour. */
export function SportBadge({ sport, size = "md" }: { sport: Sport; size?: "sm" | "md" }) {
  const box = size === "sm" ? "size-8" : "size-10";
  const Glyph = sport === "running" ? RunIcon : ClimbIcon;
  const colours =
    sport === "running" ? "bg-accent-soft text-accent" : "bg-climb-soft text-climb";
  return (
    <span className={`${box} ${colours} grid shrink-0 place-items-center rounded-full`}>
      <Glyph size={size === "sm" ? 16 : 20} />
    </span>
  );
}

/** An envelope: the sign-in email. */
export const MailIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="m4 7 8 6 8-6" />
  </Icon>
);

/** A key: the account page, where a password is set. */
export const KeyIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="15" r="4" />
    <path d="m11 12 9-9M16 7l3 3M18 5l2 2" />
  </Icon>
);

/** An arrow leaving a door: sign out. */
export const SignOutIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 4h3.5A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5H14" />
    <path d="M10 8l-4 4 4 4M6 12h10" />
  </Icon>
);
