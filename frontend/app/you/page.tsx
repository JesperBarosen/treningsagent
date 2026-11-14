import type { Metadata } from "next";
import { YouView } from "./you-view";

export const metadata: Metadata = { title: "You" };

export default function YouPage() {
  return (
    <div className="mx-auto max-w-content">
      <YouView />
    </div>
  );
}
