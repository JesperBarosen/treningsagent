import type { Metadata } from "next";
import { Suspense } from "react";
import { ReviewSkeleton, ReviewViewFromUrl } from "./review-view";

export const metadata: Metadata = { title: "Your week" };

export default function ReviewPage() {
  return (
    <div className="mx-auto max-w-content">
      {/* The shell is prerendered; ?week= is read in the browser (cacheComponents
          forbids reading searchParams outside Suspense during prerendering). */}
      <Suspense fallback={<ReviewSkeleton />}>
        <ReviewViewFromUrl />
      </Suspense>
    </div>
  );
}
