import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ insert: vi.fn(), from: vi.fn(), userId: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({ from: db.from }),
  currentUserId: db.userId,
}));

const { recordEvent } = await import("@/lib/events");

/** recordEvent runs in the background: let its promise chain settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  db.from.mockReturnValue({ insert: db.insert });
  db.insert.mockResolvedValue({ error: null });
  db.userId.mockResolvedValue("user-1");
});

describe("recordEvent", () => {
  it("inserts only the event name; the database adds who and when", async () => {
    recordEvent("weekly_review_opened");
    await settle();
    expect(db.from).toHaveBeenCalledWith("ui_events");
    expect(db.insert).toHaveBeenCalledWith({ event: "weekly_review_opened" });
  });

  it("does nothing when signed out", async () => {
    db.userId.mockResolvedValue(null);
    recordEvent("weekly_review_opened");
    await settle();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("rejects names the table would reject", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const bad of ["Has spaces", "1st", "", "x".repeat(65), "free text: ran 10k"]) {
      recordEvent(bad);
    }
    await settle();
    expect(db.insert).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("never throws, even when the insert fails", async () => {
    db.insert.mockRejectedValue(new Error("offline"));
    expect(() => recordEvent("discreet_mode_on")).not.toThrow();
    await settle();
    expect(db.insert).toHaveBeenCalled();
  });
});
