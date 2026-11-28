import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TemplatesView } from "@/app/templates/templates-view";
import { SessionRow } from "@/components/session-card";
import { SessionForm } from "@/components/session-form";
import { setsTotal } from "@/components/template-fields";
import type { Session, Template } from "@/lib/api";

// Templates in the Log form, Sessions and the editor (#101).

const FINGERBOARD: Template = {
  id: 7,
  name: "Fingerboard",
  sport: "other",
  core_fields: [],
  position: 0,
  archived: false,
  fields: [
    {
      key: "protocol",
      label: "Protocol",
      type: "select",
      options: [
        { value: "max_hangs", label: "Max hangs" },
        { value: "repeaters", label: "Repeaters" },
      ],
    },
    {
      key: "hangs",
      label: "Hangs",
      type: "sets",
      required: true,
      reps_unit: "s",
      load_unit: "kg",
      load_signed: true,
      extras: [{ key: "edge_mm", label: "Edge", unit: "mm", min: 4, max: 60 }],
    },
    { key: "pain", label: "Any finger pain?", type: "boolean" },
  ],
};

const api = vi.hoisted(() => ({
  getTemplates: vi.fn(),
  getGyms: vi.fn(),
  addStarters: vi.fn(),
  createTemplate: vi.fn(),
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  api.getTemplates.mockResolvedValue({ templates: [FINGERBOARD], starters: [] });
  api.getGyms.mockResolvedValue({ gyms: [], last_gym_id: null });
});

const click = (role: string, name: string | RegExp) => fireEvent.click(screen.getByRole(role, { name }));

describe("Log form with a template", () => {
  it("offers the template next to the sports and logs its values", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<SessionForm onSubmit={onSubmit} />);
    click("radio", await screen.findByText("Fingerboard").then(() => "Fingerboard"));
    fireEvent.change(screen.getByLabelText("Duration (min)"), { target: { value: "40" } });

    // Hangs is required: Save waits for it, and says why.
    expect(screen.getByRole("button", { name: "Log session" })).toBeDisabled();
    expect(screen.getByText("Hangs is required")).toBeInTheDocument();

    click("button", "Add hangs");
    const group = within(screen.getByRole("group", { name: "Hangs, group 1" }));
    fireEvent.change(group.getByLabelText("Sets"), { target: { value: "6" } });
    fireEvent.change(group.getByLabelText("Edge"), { target: { value: "20" } });
    fireEvent.click(group.getByRole("button", { name: "More added load" }));
    fireEvent.click(group.getByRole("button", { name: "More added load" }));
    click("radio", "Max hangs");
    expect(screen.getByText("6 sets · 60 s in total")).toBeInTheDocument();

    click("button", "Log session");
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        sport: "other",
        duration_min: 40,
        template_id: 7,
        values: { protocol: "max_hangs", hangs: [{ sets: 6, reps: 10, edge_mm: 20, load: 5 }] },
      }),
    );
  });

  it("edits a templated session in its own form, and can go back to the built-in one", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const session = {
      id: 3, sport: "other", date: "2026-11-10", duration_min: 40, effort: 7, template_id: 7,
      custom_values: { hangs: [{ sets: 6, reps: 10 }], pain: false },
    } as Session;
    const { unmount } = render(<SessionForm session={session} editing onSubmit={onSubmit} />);
    await waitFor(() => expect(screen.getByRole("radio", { name: "Fingerboard" })).toHaveAttribute("aria-checked", "true"));
    expect(screen.getByRole("radio", { name: "No" })).toHaveAttribute("aria-checked", "true");
    click("button", "Save changes");
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ template_id: 7, values: { hangs: [{ sets: 6, reps: 10 }], pain: false } });
    unmount(); // a saved form stays busy until its parent closes it

    render(<SessionForm session={session} editing onSubmit={onSubmit} />);
    await waitFor(() => expect(screen.getByRole("radio", { name: "Fingerboard" })).toHaveAttribute("aria-checked", "true"));
    click("radio", "Other");
    click("button", "Save changes");
    expect(onSubmit.mock.calls[1][0].template_id).toBeNull();
    expect(onSubmit.mock.calls[1][0].values).toBeUndefined();
  });

  it("sums sets", () => {
    expect(setsTotal([{ sets: 6, reps: 10 }, { sets: 3, reps: 7 }], { reps_unit: "s" })).toBe("9 sets · 81 s in total");
    expect(setsTotal([{ sets: 3, reps: 8 }], { reps_unit: "reps" })).toBe("3 sets · 24 reps");
  });
});

describe("Sessions show template values", () => {
  it("titles the row with the template and keeps its values for the details sheet", () => {
    const s = {
      id: 1, sport: "other", date: "2026-11-10", duration_min: 40, effort: 7, template: "Fingerboard",
      fields: [{ key: "hangs", label: "Hangs", type: "sets", value: [], text: "6 × 10 s · 20 mm · +10 kg" }],
    } as unknown as Session;
    render(<SessionRow session={s} onOpen={() => {}} />);
    expect(screen.getByText("Fingerboard")).toBeInTheDocument();
    expect(screen.queryByText("6 × 10 s · 20 mm · +10 kg")).toBeNull();
  });
});

describe("Log forms page", () => {
  it("offers starters on first use", async () => {
    api.getTemplates.mockResolvedValue({ templates: [], starters: [{ name: "Fingerboard", sport: "other" }, { name: "Strength", sport: "strength" }] });
    api.addStarters.mockResolvedValue([]);
    render(<TemplatesView />);
    fireEvent.click(await screen.findByRole("button", { name: "Strength" }));
    click("button", "Add 1");
    await waitFor(() => expect(api.addStarters).toHaveBeenCalledWith(["Strength"]));
  });

  it("lists built-in forms and templates by sport, and builds a new template", async () => {
    api.createTemplate.mockResolvedValue(FINGERBOARD);
    render(<TemplatesView />);
    expect(await screen.findByRole("button", { name: /Fingerboard/ })).toBeInTheDocument();
    expect(screen.getAllByText("Built-in")).toHaveLength(4);

    click("button", "New template");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Yoga" } });
    click("button", "Add field");
    // Climbs is only for climbing templates.
    expect(screen.getByRole("button", { name: /^Climbs/ })).toBeDisabled();
    click("button", /^Number/);
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Poses" } });
    click("button", "Save template");
    await waitFor(() =>
      expect(api.createTemplate).toHaveBeenCalledWith({
        name: "Yoga",
        sport: "other",
        core_fields: [],
        fields: [{ label: "Poses", type: "number", required: false, decimals: 1 }],
      }),
    );
  });
});
