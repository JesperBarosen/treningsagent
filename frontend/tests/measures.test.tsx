import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TemplatesView } from "@/app/templates/templates-view";
import { SessionRow } from "@/components/session-card";
import { SessionForm } from "@/components/session-form";
import type { Session, Template } from "@/lib/api";
import { valueLines } from "@/lib/format";

// Number fields with several measures (#111): Hangboard = 5 kg, 10 s, 6 sets.

const BOARD: Template = {
  id: 9,
  name: "Board and bar",
  sport: "strength",
  core_fields: [],
  position: 0,
  archived: false,
  fields: [
    {
      key: "hangboard",
      label: "Hangboard",
      type: "number",
      required: true,
      measures: [
        { key: "kg", label: "kg", decimals: 1 },
        { key: "s", label: "s", decimals: 0 },
        { key: "sets", label: "sets", decimals: 0 },
      ],
    },
    // Made before measures: one unit, then a second measure. Old numbers belong to "value".
    {
      key: "hang",
      label: "Hang",
      type: "number",
      measures: [
        { key: "value", label: "kg", decimals: 1 },
        { key: "s", label: "s", decimals: 0 },
      ],
    },
    { key: "rest", label: "Rest", type: "number", unit: "s", decimals: 0 },
  ],
};

const api = vi.hoisted(() => ({ getTemplates: vi.fn(), getGyms: vi.fn(), updateTemplate: vi.fn() }));
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
  api.getTemplates.mockResolvedValue({ templates: [BOARD], starters: [] });
  api.getGyms.mockResolvedValue({ gyms: [], last_gym_id: null });
});

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("a number field with several measures in the Log form", () => {
  it("shows one small input per measure on a wrapping row and logs one value per measure", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<SessionForm onSubmit={onSubmit} />);
    fireEvent.click(await screen.findByRole("radio", { name: "Board and bar" }));
    type("Duration (min)", "40");

    const group = screen.getByRole("group", { name: /^Hangboard/ });
    const inputs = within(group).getAllByRole("textbox");
    expect(inputs.map((i) => i.getAttribute("aria-label"))).toEqual(["Hangboard, kg", "Hangboard, s", "Hangboard, sets"]);
    expect(inputs[0].closest("div")).toHaveClass("flex-wrap"); // wraps instead of overflowing at 375 px
    for (const i of inputs) expect(i).toHaveAttribute("data-sensitive"); // values blur in discreet mode
    expect(within(group).getByText("sets")).not.toHaveAttribute("data-sensitive"); // names stay

    // Required: one measure is enough, none is not.
    expect(screen.getByRole("button", { name: "Log session" })).toBeDisabled();
    expect(screen.getByText("Hangboard is required")).toBeInTheDocument();
    type("Hangboard, kg", "5");
    type("Hangboard, s", "10");
    type("Hangboard, sets", "6");
    // A plain field looks and stores as before.
    fireEvent.change(screen.getByLabelText(/^Rest \(s\)/), { target: { value: "180" } });
    fireEvent.click(screen.getByRole("button", { name: "Log session" }));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      template_id: 9,
      values: { hangboard: { kg: 5, s: 10, sets: 6 }, rest: 180 },
    });
  });

  it("leaves empty measures out and checks each measure's decimals", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<SessionForm onSubmit={onSubmit} />);
    fireEvent.click(await screen.findByRole("radio", { name: "Board and bar" }));
    type("Duration (min)", "40");
    type("Hangboard, sets", "6.5");
    expect(screen.getByText("Hangboard, sets takes whole numbers")).toBeInTheDocument();
    type("Hangboard, sets", "6");
    fireEvent.click(screen.getByRole("button", { name: "Log session" }));
    expect(onSubmit.mock.calls[0][0].values).toEqual({ hangboard: { sets: 6 } });
  });

  it("puts a long unit above its box so the number stays visible and typeable (#123)", async () => {
    const hangboard = {
      ...BOARD.fields[0],
      measures: [
        { key: "kg", label: "kg", decimals: 1 },
        { key: "s", label: "s", decimals: 0 },
        { key: "rest", label: "Rest (min)", decimals: 1 },
        { key: "sets", label: "sets", decimals: 0 },
      ],
    };
    api.getTemplates.mockResolvedValue({ templates: [{ ...BOARD, fields: [hangboard] }], starters: [] });
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<SessionForm onSubmit={onSubmit} />);
    fireEvent.click(await screen.findByRole("radio", { name: "Board and bar" }));
    type("Duration (min)", "40");

    const rest = screen.getByLabelText("Hangboard, Rest (min)") as HTMLInputElement;
    const box = rest.parentElement!;
    // The long unit is outside the box, truncated; the input keeps a minimum width.
    const unit = within(screen.getByRole("group", { name: /^Hangboard/ })).getByText("Rest (min)");
    expect(box.contains(unit)).toBe(false);
    expect(unit).toHaveClass("truncate");
    expect(rest).toHaveClass("min-w-8");
    // A short unit stays inside its box.
    const kg = screen.getByLabelText("Hangboard, kg");
    expect(kg.parentElement).toHaveTextContent("kg");
    // Decimals give the decimal keyboard, whole numbers the numeric one.
    expect(rest).toHaveAttribute("inputmode", "decimal");
    expect(screen.getByLabelText("Hangboard, sets")).toHaveAttribute("inputmode", "numeric");

    type("Hangboard, Rest (min)", "2.5");
    expect(rest).toHaveValue("2.5");
    fireEvent.click(screen.getByRole("button", { name: "Log session" }));
    expect(onSubmit.mock.calls[0][0].values).toEqual({ hangboard: { rest: 2.5 } });
  });

  it("reads an old plain number into the measure it belongs to", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const session = {
      id: 4, sport: "strength", date: "2026-11-01", duration_min: 30, effort: 6, template_id: 9,
      custom_values: { hangboard: { kg: 5 }, hang: 7.5 },
    } as Session;
    render(<SessionForm session={session} editing onSubmit={onSubmit} />);
    await waitFor(() => expect(screen.getByLabelText("Hang, kg")).toHaveValue("7.5"));
    expect(screen.getByLabelText("Hang, s")).toHaveValue("");
    type("Hang, s", "10");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSubmit.mock.calls[0][0].values).toEqual({ hangboard: { kg: 5 }, hang: { value: 7.5, s: 10 } });
  });
});

describe("measures in Sessions", () => {
  const session = {
    id: 1, sport: "strength", date: "2026-11-10", duration_min: 40, effort: 7, template: "Board and bar",
    fields: [
      { key: "hangboard", label: "Hangboard", type: "number", value: { kg: 5, s: 10, sets: 6 }, text: "5 kg · 10 s · 6 sets",
        measures: [{ key: "kg", label: "kg" }, { key: "s", label: "s" }, { key: "sets", label: "sets" }] },
      { key: "rest", label: "Rest", type: "number", value: 180, text: "180 s" },
    ],
  } as unknown as Session;

  it("names the field and blurs only its values", () => {
    expect(valueLines(session)).toEqual(["Hangboard 5 kg · 10 s · 6 sets", "180 s"]);
    render(<SessionRow session={session} onOpen={() => {}} />);
    expect(screen.getByText("Hangboard")).not.toHaveAttribute("data-sensitive");
    expect(screen.getByText("5 kg · 10 s · 6 sets")).toHaveAttribute("data-sensitive");
    expect(screen.getByText("180 s")).toHaveAttribute("data-sensitive");
  });
});

describe("measures in the template editor", () => {
  it("turns a one-unit field into measures with quick picks, keeping its unit for old values", async () => {
    api.updateTemplate.mockResolvedValue(BOARD);
    render(<TemplatesView />);
    fireEvent.click(await screen.findByRole("button", { name: /Board and bar/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Rest/ }));
    // One unit: one measure row, as before.
    expect(screen.getByLabelText("Measure 1 name or unit")).toHaveValue("s");
    expect(screen.getByLabelText("Measure 1 name or unit")).toBeDisabled(); // a saved unit is fixed
    const picks = within(screen.getByRole("group", { name: "Add a measure" }));
    expect(picks.getByRole("button", { name: /Seconds/ })).toBeDisabled(); // already there
    fireEvent.click(picks.getByRole("button", { name: /Sets/ }));
    fireEvent.click(picks.getByRole("button", { name: /Custom/ }));
    fireEvent.change(screen.getByLabelText("Measure 3 name or unit"), { target: { value: "rounds" } });
    fireEvent.click(screen.getByRole("button", { name: "Move rounds up" }));
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));
    await waitFor(() => expect(api.updateTemplate).toHaveBeenCalled());
    const rest = api.updateTemplate.mock.calls[0][1].fields.find((f: { key?: string }) => f.key === "rest");
    expect(rest.measures).toEqual([
      { key: "value", label: "s", decimals: 0 },
      { label: "rounds", decimals: 0 },
      { label: "sets", decimals: 0 },
    ]);
    expect(rest.unit).toBeUndefined();
  });
});
