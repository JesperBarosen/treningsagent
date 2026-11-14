import type { Metadata } from "next";
import { ReviewView } from "./review-view";

export const metadata: Metadata = { title: "Your week" };

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string | string[] }>;
}) {
  const { week } = await searchParams;
  return (
    <div className="mx-auto max-w-content">
      <ReviewView week={typeof week === "string" ? week : undefined} />
    </div>
  );
}
