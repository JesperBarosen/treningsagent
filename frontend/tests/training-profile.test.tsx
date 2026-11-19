import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileUpdate, TrainingProfile } from "@/lib/api";

// The training profile (#137): the form, the first-login step, the You tab
// editor, and the coach's change that the user confirms in the chat.

vi.mock("next/navigation", () => ({
  usePathname: () => "/you",
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({ auth: { signOut: vi.fn() } }),
  accessToken: async () => "tok",
  currentUserId: async () => "user-1",
}));
const api = vi.hoisted(() => ({ getProfile: vi.fn(), saveProfile: vi.fn(), sendChat: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
  getTrainingLoad: () => Promise.reject(new Error("not under test")),
  getPause: async () => ({ active: null, recent: null }),
}));

const { ProfileForm } = await import("@/components/profile-form");
const { ProfileStep } = await import("@/components/profile-step");
const { ProfileView } = await import("@/app/you/profile/profile-view");
const { YouView } = await import("@/app/you/you-view");
const { Chat } = await import("@/app/chat");

const EMPTY: TrainingProfile = {
  longest_run_km: null, weekly_run_km: null, climbing_level: null, injuries: [], sessions_per_week: null,
  preferred_days: [], other_sports: null, goals_note: null, onboarding: null,
};
const FILLED: TrainingProfile = {
  ...EMPTY, sessions_per_week: 3, preferred_days: ["tuesday", "thursday", "saturday"], longest_run_km: 8.4,
  injuries: [{ body_part: "calf", pain: 3, note: null }], onboarding: "done",
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  api.getProfile.mockResolvedValue(EMPTY);
  api.saveProfile.mockImplementation(async (changes) => ({ ...EMPTY, ...changes }));
});

describe("the profile form", () => {
  it("saves every field the user filled in, with days in week order", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ProfileForm initial={EMPTY} onSave={onSave} />);
    await user.selectOptions(screen.getByLabelText("Sessions a week"), "3");
    for (const d of ["Sat", "Tue", "Thu"]) await user.click(screen.getByRole("button", { name: d }));
    await user.type(screen.getByLabelText("Longest recent run (km)"), "8,4");
    await user.type(screen.getByLabelText("Climbing level"), "projecting V5");
    await user.click(screen.getByRole("button", { name: /Add injury or pain/ }));
    await user.type(screen.getByLabelText("Body part"), "calf");
    await user.selectOptions(screen.getByLabelText("Pain 0–10"), "3");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({
      sessions_per_week: 3, preferred_days: ["tuesday", "thursday", "saturday"], longest_run_km: 8.4,
      weekly_run_km: null, climbing_level: "projecting V5", injuries: [{ body_part: "calf", pain: 3, note: null }],
      other_sports: null, goals_note: null,
    });
  });

  it("won't save a bad number or an injury without a body part, and blurs values in discreet mode", async () => {
    const user = userEvent.setup();
    render(<ProfileForm initial={EMPTY} onSave={vi.fn()} />);
    await user.type(screen.getByLabelText("Typical week (km)"), "lots");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.clear(screen.getByLabelText("Typical week (km)"));
    await user.click(screen.getByRole("button", { name: /Add injury or pain/ }));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Remove injury" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(screen.getByLabelText("Typical week (km)")).toHaveAttribute("data-sensitive");
    expect(screen.getByText(/never diagnoses/)).toBeInTheDocument();
  });
});

describe("the first-login step", () => {
  it("shows until saved, and saving marks it done", async () => {
    const user = userEvent.setup();
    render(<ProfileStep />);
    expect(await screen.findByRole("heading", { name: "Tell the coach about you" })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Sessions a week"), "2");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(api.saveProfile).toHaveBeenCalledWith(expect.objectContaining({ sessions_per_week: 2, onboarding: "done" }));
    expect(screen.queryByRole("heading", { name: "Tell the coach about you" })).toBeNull();
  });

  it("can be skipped, and is then not shown again", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<ProfileStep />);
    await user.click(await screen.findByRole("button", { name: "Skip" }));
    expect(api.saveProfile).toHaveBeenCalledWith({ onboarding: "skipped" });
    expect(screen.queryByRole("heading", { name: "Tell the coach about you" })).toBeNull();
    unmount();
    api.getProfile.mockResolvedValue({ ...EMPTY, onboarding: "skipped" });
    render(<ProfileStep />);
    await Promise.resolve();
    expect(screen.queryByRole("heading", { name: "Tell the coach about you" })).toBeNull();
  });

  it("stays out of the way when the profile can't be loaded", async () => {
    api.getProfile.mockRejectedValue(new Error("offline"));
    const { container } = render(<ProfileStep />);
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
  });
});

describe("the You tab", () => {
  it("links to the profile editor, which loads and saves it", async () => {
    render(<YouView />);
    expect(screen.getByRole("link", { name: /Training profile/ })).toHaveAttribute("href", "/you/profile");

    api.getProfile.mockResolvedValue(FILLED);
    const user = userEvent.setup();
    render(<ProfileView />);
    expect(await screen.findByLabelText("Sessions a week")).toHaveValue("3");
    expect(screen.getByRole("button", { name: "Tue" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Body part")).toHaveValue("calf");
    await user.selectOptions(screen.getByLabelText("Sessions a week"), "4");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(api.saveProfile).toHaveBeenCalledWith(expect.objectContaining({ sessions_per_week: 4, onboarding: "done" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Saved");
  });
});

describe("a profile change the coach proposes", () => {
  const UPDATE: ProfileUpdate = {
    profile_update: true, stored: false,
    changes: { sessions_per_week: 2, injuries: [{ body_part: "knee", pain: 4, note: null }] },
    before: { sessions_per_week: 3, injuries: [] },
  };

  async function chatWithUpdate() {
    api.getProfile.mockResolvedValue(FILLED); // no first-login step in the way
    api.sendChat.mockResolvedValue({
      reply: "Ready to save.", history: [{ role: "user", content: "x" }, { role: "assistant", content: [] }],
      conversation_id: "c1", logged_sessions: [], profile_updates: [UPDATE],
    });
    const user = userEvent.setup();
    render(<Chat />);
    await user.type(await screen.findByLabelText("Message"), "Only twice a week now, and my knee hurts{Enter}");
    return { user, card: await screen.findByRole("region", { name: "Profile change" }) };
  }

  it("shows what changes and stores nothing until Save", async () => {
    const { user, card } = await chatWithUpdate();
    expect(within(card).getByText("Profile change · not saved yet")).toBeInTheDocument();
    expect(card).toHaveTextContent("Sessions a week: 3 → 2");
    expect(card).toHaveTextContent("Injuries or pain: – → knee, pain 4/10");
    expect(api.saveProfile).not.toHaveBeenCalled();
    await user.click(within(card).getByRole("button", { name: "Save" }));
    expect(api.saveProfile).toHaveBeenCalledWith(UPDATE.changes);
    expect(await within(card).findByText("Profile updated")).toBeInTheDocument();
    api.sendChat.mockResolvedValue({ reply: "ok", history: [], conversation_id: "c1", logged_sessions: [] });
    await user.type(screen.getByLabelText("Message"), "Thanks{Enter}");
    expect(JSON.stringify(api.sendChat.mock.calls.at(-1)![1])).toContain(
      "[User saved the profile change: Sessions a week: 2; Injuries or pain: knee, pain 4/10.]",
    );
  });

  it("dismisses without storing anything", async () => {
    const { user, card } = await chatWithUpdate();
    await user.click(within(card).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("region", { name: "Profile change" })).toBeNull();
    expect(api.saveProfile).not.toHaveBeenCalled();
    api.sendChat.mockResolvedValue({ reply: "ok", history: [], conversation_id: "c1", logged_sessions: [] });
    await user.type(screen.getByLabelText("Message"), "OK{Enter}");
    expect(JSON.stringify(api.sendChat.mock.calls.at(-1)![1])).toContain("[User dismissed the profile change:");
  });
});
