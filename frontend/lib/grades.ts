// Grade helpers for gym colours, V and Font (#98, #99). The backend decides
// what a grade means; these only pick swatches and orders for display.

import { FONT_GRADES, GRADES, V_GRADES, type Climb, type ClimbInput, type Gym, type GymColour } from "./api";

/** A CSS colour for a grade's dot: the climb's own swatch, else the token of a
 *  "My gym" colour, else null (V and Font grades have no colour). */
export function gradeSwatch(grade: string, colour?: string | null): string | null {
  if (colour) return colour;
  return (GRADES as readonly string[]).includes(grade) ? `var(--color-grade-${grade})` : null;
}

/** An order for climbs in one session, easiest first: the colour's place in
 *  its gym, else the V or Font grade's place (after the colours). */
export function climbRank(c: Pick<Climb, "grade" | "grade_ordinal" | "grade_system">): number {
  if (c.grade_ordinal != null) return c.grade_ordinal;
  if (c.grade_system === "v") return 100 + V_GRADES.indexOf(c.grade);
  if (c.grade_system === "font") return 100 + FONT_GRADES.indexOf(c.grade) * 0.75;
  return 1 + (GRADES as readonly string[]).indexOf(c.grade);
}

/** "blue", or "blue at Klatreverket" when the gym is named. */
export function gradeWithGym(c: Pick<Climb, "grade" | "gym">): string {
  return c.gym ? `${c.grade} at ${c.gym}` : c.grade;
}

/** The colours in use, easiest first. */
export function activeColours(gym: Gym): GymColour[] {
  return gym.colours.filter((c) => !c.archived);
}

/** The gym the Log form starts with: the climb's own, else the last used, else the first. */
export function startGym(gyms: Gym[], lastGymId: number | null, climbs?: ClimbInput[]): Gym | null {
  const live = gyms.filter((g) => !g.archived);
  const wanted = climbs?.find((c) => c.gym_id != null)?.gym_id ?? lastGymId;
  return live.find((g) => g.id === wanted) ?? live[0] ?? null;
}
