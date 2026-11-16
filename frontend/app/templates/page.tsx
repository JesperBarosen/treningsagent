import type { Metadata } from "next";
import { TemplatesView } from "./templates-view";

export const metadata: Metadata = { title: "Log forms" };

export default function TemplatesPage() {
  return (
    <div className="mx-auto max-w-content">
      <TemplatesView />
    </div>
  );
}
