import type { Metadata } from "next";
import { GymsView } from "./gyms-view";

export const metadata: Metadata = { title: "Gyms" };

export default function GymsPage() {
  return (
    <div className="mx-auto max-w-content">
      <GymsView />
    </div>
  );
}
