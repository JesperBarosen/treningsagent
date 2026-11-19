import type { Metadata } from "next";
import { ProfileView } from "./profile-view";

export const metadata: Metadata = { title: "Training profile" };

/** The training profile editor (#137), from the You tab. */
export default function ProfilePage() {
  return (
    <div className="mx-auto max-w-content">
      <ProfileView />
    </div>
  );
}
