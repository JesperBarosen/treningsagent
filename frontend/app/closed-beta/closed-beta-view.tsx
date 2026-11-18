"use client";

import { KeyIcon, SignOutIcon } from "@/components/icons";
import { useSignOut } from "@/components/nav";
import { Button, EmptyState } from "@/components/states";
import { CLOSED_BETA } from "@/lib/limits";

export function ClosedBetaView() {
  const { busy, signOut } = useSignOut();
  return (
    <EmptyState
      icon={<KeyIcon size={26} />}
      title={CLOSED_BETA.title}
      action={
        <Button onClick={signOut} disabled={busy}>
          <SignOutIcon size={18} /> {busy ? "Signing out…" : "Sign out"}
        </Button>
      }
    >
      {CLOSED_BETA.body}
    </EmptyState>
  );
}
