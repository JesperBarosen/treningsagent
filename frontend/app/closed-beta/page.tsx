import type { Metadata } from "next";
import { ClosedBetaView } from "./closed-beta-view";

export const metadata: Metadata = { title: "Closed beta" };

/** Where an uninvited account lands (#130): the API answers 403 closed_beta
 *  to everything, so lib/api.ts sends the user here. */
export default function ClosedBetaPage() {
  return (
    <div className="mx-auto max-w-content">
      <ClosedBetaView />
    </div>
  );
}
