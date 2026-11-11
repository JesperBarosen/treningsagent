import type { Metadata } from "next";
import { SessionsView } from "./sessions-view";

export const metadata: Metadata = { title: "Sessions" };

export default function SessionsPage() {
  return (
    <div className="mx-auto max-w-content">
      <SessionsView />
    </div>
  );
}
