import type { Metadata } from "next";
import { Suspense } from "react";
import { SignInForm, SignInFormFromUrl } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-3.5rem)] max-w-sm flex-col justify-center py-12">
      {/* The form is prerendered; ?error=link (a failed magic link) is read in the browser. */}
      <Suspense fallback={<SignInForm />}>
        <SignInFormFromUrl />
      </Suspense>
    </div>
  );
}
