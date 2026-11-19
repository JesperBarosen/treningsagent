import type { Metadata } from "next";
import { ProposalPreview } from "./proposal-preview";

export const metadata: Metadata = { title: "Proposed plan" };

/** The whole proposed plan before Accept (#135): opened from the chat card's
 *  "View plan". The proposal is read in the browser (sessionStorage). */
export default function ProposalPage() {
  return (
    <div className="mx-auto max-w-content">
      <ProposalPreview />
    </div>
  );
}
