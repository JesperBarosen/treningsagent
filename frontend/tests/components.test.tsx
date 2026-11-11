import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ClimbChips } from "@/components/grade";
import type { Climb } from "@/lib/api";
import { Markdown } from "@/lib/markdown";

const climb = (grade: Climb["grade"], ordinal: number, sent: boolean, attempts?: number): Climb => ({
  grade, grade_ordinal: ordinal, sent, attempts, style: "boulder",
});

describe("ClimbChips", () => {
  it("labels outcome for screen readers, hardest first", () => {
    render(
      <ClimbChips
        climbs={[climb("blue", 3, true, 1), climb("red", 5, false), climb("purple", 4, true, 3)]}
      />,
    );
    expect(screen.getAllByRole("img").map((el) => el.getAttribute("aria-label"))).toEqual([
      "red boulder, not sent",
      "purple boulder, sent, 3 attempts",
      "blue boulder, flashed",
    ]);
  });

  it("collapses extra climbs into a +n chip", () => {
    render(<ClimbChips climbs={[1, 2, 3].map(() => climb("green", 2, true))} max={2} />);
    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(screen.getByText("+1 more")).toBeInTheDocument();
  });
});

describe("Markdown", () => {
  it("renders bold and lists without raw HTML", () => {
    const { container } = render(
      <Markdown text={"**Running: improving.**\n- faster\n- longer\n<b>no</b>"} />,
    );
    expect(screen.getByText("Running: improving.").tagName).toBe("STRONG");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("b")).toBeNull();
  });
});
