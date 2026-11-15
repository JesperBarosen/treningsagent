import type { Metadata } from "next";
import { BreakSection } from "@/components/break-section";
import { AutoSaveSetting } from "./auto-save-setting";
import { ChartSettings } from "./chart-settings";
import { SetPasswordForm } from "./set-password-form";

export const metadata: Metadata = { title: "Account" };

export default function AccountPage() {
  return (
    <div className="mx-auto max-w-sm pt-4 pb-12">
      <h1 className="font-display text-xl font-semibold">Account</h1>
      <section aria-labelledby="password-title" className="mt-4 rounded-lg border border-line bg-surface p-4">
        <h2 id="password-title" className="font-semibold">
          Set password
        </h2>
        <p className="mt-1 mb-4 text-sm text-ink-muted">
          Sign in with your email and a password instead of an email link. Use this on the iPhone home-screen
          app, which can&apos;t open sign-in links.
        </p>
        <SetPasswordForm />
      </section>
      {/* Also on the You tab; here it is reachable at every width (key icon in the top bar). */}
      <BreakSection className="mt-4 rounded-lg border border-line bg-surface p-4" />
      <section aria-labelledby="chat-title" className="mt-4 rounded-lg border border-line bg-surface p-4">
        <h2 id="chat-title" className="mb-3 font-semibold">
          Coach
        </h2>
        <AutoSaveSetting />
      </section>
      <section aria-labelledby="charts-title" className="mt-4 rounded-lg border border-line bg-surface p-4">
        <h2 id="charts-title" className="mb-3 font-semibold">
          Charts and Dashboard
        </h2>
        <ChartSettings />
      </section>
    </div>
  );
}
