"use client";

import { useEffect, useState } from "react";
import { getProfile, saveProfile, type TrainingProfile } from "@/lib/api";
import { UserIcon } from "./icons";
import { ProfileForm } from "./profile-form";

/** The optional first-login step (#137): shown on Coach until the user saves
 *  or skips it once, then never again (it stays editable in You). A failed
 *  load shows nothing: the step is a nicety, never in the way. */
export function ProfileStep() {
  const [profile, setProfile] = useState<TrainingProfile | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    getProfile(ctrl.signal)
      .then((p) => {
        setProfile(p);
        setOpen(p.onboarding === null);
      })
      .catch(() => setOpen(false));
    return () => ctrl.abort();
  }, []);

  if (!open || !profile) return null;

  async function skip() {
    setOpen(false);
    await saveProfile({ onboarding: "skipped" }).catch(() => undefined); // asked again next time if it fails
  }

  return (
    <section aria-labelledby="profile-step-title" className="mb-4 animate-rise rounded-lg border border-line bg-surface p-4">
      <div className="mb-3 flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
          <UserIcon size={18} />
        </span>
        <div className="min-w-0">
          <h2 id="profile-step-title" className="font-display text-lg font-semibold">
            Tell the coach about you
          </h2>
          <p className="text-sm text-ink-muted">
            Optional, and you can change it any time in You. The coach uses it so it asks less and plans better.
          </p>
        </div>
      </div>
      <ProfileForm
        initial={profile}
        onSave={async (changes) => {
          await saveProfile({ ...changes, onboarding: "done" });
          setOpen(false);
        }}
        extra={
          <button
            type="button"
            onClick={skip}
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full border border-control px-5 text-sm font-semibold text-ink transition hover:bg-sunken"
          >
            Skip
          </button>
        }
      />
    </section>
  );
}
