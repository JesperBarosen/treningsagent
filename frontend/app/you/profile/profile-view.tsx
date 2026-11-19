"use client";

import { useEffect, useState } from "react";
import { ProfileForm } from "@/components/profile-form";
import { ErrorState, Skeleton } from "@/components/states";
import { ApiError, getProfile, saveProfile, type TrainingProfile } from "@/lib/api";

type Load =
  | { kind: "loading" }
  | { kind: "error"; message: string; offline: boolean }
  | { kind: "ready"; profile: TrainingProfile };

function failed(e: unknown): Load {
  const err = e instanceof ApiError ? e : new ApiError(String(e), 0);
  return { kind: "error", message: err.message, offline: err.status === null };
}

/** Edit the training profile (#137). Saving here also counts as the
 *  first-login step done, so it isn't shown again on Coach. */
export function ProfileView() {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [saved, setSaved] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    getProfile(ctrl.signal)
      .then((profile) => setLoad({ kind: "ready", profile }))
      .catch((e) => {
        if (!ctrl.signal.aborted) setLoad(failed(e));
      });
    return () => ctrl.abort();
  }, [attempt]);

  return (
    <div className="pt-4 pb-12">
      <h1 className="font-display text-xl font-semibold">Training profile</h1>
      <p className="mb-4 text-sm text-ink-muted">
        What the coach knows about you. All optional; it uses this so it asks less and plans to fit you.
      </p>
      {load.kind === "loading" && <Skeleton className="h-96" />}
      {load.kind === "error" && (
        <ErrorState offline={load.offline} message={load.message} onRetry={() => setAttempt((n) => n + 1)} />
      )}
      {load.kind === "ready" && (
        <>
          <ProfileForm
            initial={load.profile}
            onSave={async (changes) => {
              setSaved(false);
              const profile = await saveProfile({ ...changes, onboarding: "done" });
              setLoad({ kind: "ready", profile });
              setSaved(true);
            }}
          />
          {saved && (
            <p role="status" className="mt-3 text-sm text-accent">
              Saved. The coach uses it from your next message.
            </p>
          )}
        </>
      )}
    </div>
  );
}
