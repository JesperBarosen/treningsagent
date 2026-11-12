import type { Metadata } from "next";
import { LogView } from "./log-view";

export const metadata: Metadata = { title: "Log" };

export default function LogPage() {
  return (
    <div className="mx-auto max-w-content">
      <LogView />
    </div>
  );
}
