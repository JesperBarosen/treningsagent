import type { Metadata } from "next";
import { PlanView } from "./plan-view";

export const metadata: Metadata = { title: "Plan" };

/** The Plan view (#118, Q2 variant A): no tab of its own; Coach, the Dashboard
 *  and You link here. */
export default function PlanPage() {
  return (
    <div className="mx-auto max-w-content">
      <PlanView />
    </div>
  );
}
