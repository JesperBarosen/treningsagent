# treningsagent design

Calm, sporty, clean. The look borrows from a climbing gym and a trail at dawn:
chalk-white paper, slate ink, a single spruce-green accent, and the gym's
colour grades as the only loud colours. Nothing here is borrowed from another
training app; there are no orange gradients and no heat maps.

All tokens live in `app/globals.css` (`:root` variables, mapped into Tailwind
with `@theme`). The default Tailwind palette is switched off
(`--color-*: initial`), so components can only use these tokens: a class like
`bg-blue-500` does not exist here. Never put a hex value in a component.

## Colour

Light and dark follow the system setting (`prefers-color-scheme`) until the
user taps the theme switch in the top bar (`components/theme-toggle.tsx`). It
toggles Light and Dark only: a moon in light mode, a sun in dark mode, with the
icon picked by CSS so it is right on the first paint. An explicit choice is saved in
localStorage and set as `data-theme` on `<html>` by an inline script before the
first paint (`lib/theme.ts`), and it also sets the browser's `theme-color`.
The dark tokens appear twice in `globals.css`, for `data-theme="dark"` and for
a dark OS; a test keeps the two in step. Contrast is
checked against the background each token sits on (WCAG AA: 4.5:1 for body
text, 3:1 for large text and UI outlines).

With the system's Increase Contrast setting (`prefers-contrast: more`),
`--line` and `--control` become `#5A6166` light / `#9AA3A7` dark (5.2:1 or more on
every background; Apple HIG asks for a higher-contrast scheme, WCAG 1.4.11),
and `--ink-muted` takes the ink colour. The block comes after the dark tokens;
`tests/contrast-more.test.ts` measures it.

| Token | Tailwind | Light | Dark | Use |
| --- | --- | --- | --- | --- |
| `--canvas` | `bg-canvas` | `#F5F4EF` chalk | `#121618` night slate | page background |
| `--surface` | `bg-surface` | `#FFFFFF` | `#191F22` | cards, inputs |
| `--elevated` | `bg-elevated` | `#FFFFFF` | `#222A2E` | sheets, dialogs, chart tooltips, the chat composer: one step above the page, since dark mode cannot use shadows for depth |
| `--sunken` | `bg-sunken` | `#ECEAE3` | `#222A2E` | user bubbles, chips, skeletons |
| `--line` | `border-line` | `#D9D6CC` | `#30393E` | decorative hairlines, card borders, dividers (1.45:1, never a control's only edge) |
| `--control` | `border-control` | `#8A857A` | `#6B767C` | edges of text fields, chips, segmented toggles and outlined buttons (≥ 3:1 on surface, canvas and sunken, WCAG 1.4.11) |
| `--ink` | `text-ink` | `#15191B` | `#E8EBE9` | primary text (16:1 light; 15.2:1 on dark canvas, 12.2:1 on elevated) |
| `--ink-muted` | `text-ink-muted` | `#474E53` | `#B0B8BC` | secondary text, at least 7:1 on canvas, surface and sunken in both themes (Apple's aim for small text; `tests/token-contrast.test.ts`) |
| `--accent` | `bg-accent`, `text-accent` | `#0F6B5C` spruce | `#4FD1B5` | primary actions, focus, running |
| `--on-accent` | `text-on-accent` | `#FFFFFF` | `#062621` | text on accent (6.4:1 / 8.5:1) |
| `--accent-soft` | `bg-accent-soft` | `#DCEFEA` | `#13312C` | selected states, logged-session card |
| `--climb` | `text-climb` | `#9A5A17` ochre | `#E5A15A` | climbing (sport colour) |
| `--climb-soft` | `bg-climb-soft` | `#F6E8D6` | `#33271A` | climbing icon backgrounds |
| `--danger` | `text-danger` | `#B42318` | `#F97066` | errors |
| `--danger-soft` | `bg-danger-soft` | `#FDECEA` | `#3A1C1A` | error banners |
| `--focus` | `ring-focus` | = accent | = accent | 2px focus ring, 2px offset |

Two sport colours, spruce for running and ochre for climbing, are used for
icons and chart series. Neither is a gym grade colour, so a sport can never
be mistaken for a grade.

### Chart colours

Chart series use their own steps of the sport colours. `--accent` and
`--climb` failed the chart palette checks (the light spruce reads too grey,
and both dark values are too light for the dark band), so the series are
re-stepped. Both pairs pass every check in the dataviz validator: lightness
band, chroma floor, colour-blind separation (ΔE 11.5 light / 11.0 dark),
normal-vision separation and 3:1 contrast with the surface.

| Token | Tailwind | Light | Dark | Use |
| --- | --- | --- | --- | --- |
| `--chart-run` | `bg-chart-run` | `#008571` | `#21A589` | running series |
| `--chart-climb` | `bg-chart-climb` | `#A85F12` | `#C98030` | climbing series |
| `--chart-strength` | `bg-chart-strength` | `#4A5BB5` | `#7083E0` | strength series (#100) |
| `--chart-other` | `bg-chart-other` | `#4A463F` | `#CFC9BD` | other training series, a warm neutral (#100) |

The order is fixed: running, climbing, strength, other. A filter that hides a sport
never repaints the others. The third colour passes the same checks with the
other two in both themes (worst protan/deutan ΔE 11.5 light / 11.0 dark, worst
normal 18.9 / 19.6; `tests/sport-colours.test.ts`). Two limits:

- It is ΔE 6.9 from grade blue in light mode, so sports and grades never share
  a chart. If they ever must, the strength series takes a 45° hatch texture.
- Under simulated tritanopia it is close to running (ΔE 7.5 light / 5.7 dark),
  so a chart with all three keeps its legend and gaps between segments.

People can switch charts to a **colour-blind friendly** palette on the Account
page (`lib/chart-prefs.ts`, saved per device and set as
`data-chart-palette="cvd"` on `<html>` before the first paint; design-visual
V-L1). Only the chart tokens change; sport icons keep spruce and ochre.

| Token | Light | Dark |
| --- | --- | --- |
| `--chart-run` | `#0046EE` blue | `#6446FF` |
| `--chart-climb` | `#E5753C` orange | `#F25A00` |
| `--chart-strength` | `#96285A` plum | `#A85E9C` |
| `--chart-other` | `#36332E` near-black | `#CFC9BD` |

Other is a neutral in both palettes: next to the three hues it stays apart by
lightness, which colour-blind viewers see most reliably. Every pair with it
passes the same checks (`tests/sport-colours.test.ts` checks all four in the
standard palette).

Every pair passes for protan, deutan **and tritan** (worst ΔE 22.3 light / 15.7
dark, against 7.5 / 5.7 for the standard palette), with 15+ for normal vision
and 3:1 on the surface (`tests/chart-prefs.test.tsx`). The same page sets the
Dashboard on a phone to "Summary first" (default) or "Everything open".

Chart rules: bars at most 24px wide with a rounded 4px top and a square
baseline, a 2px surface gap between stacked segments, 2px lines, dots of at
least 8px with a 2px surface ring, and solid hairline gridlines in `--line`.
Text in charts uses the text tokens, never a series colour. A chart with two
or more series has a legend. A single series has none, because the title
names it. Every chart has a tooltip and a "Show the numbers" table. Grade
charts use the grade colours for their dots and always print the grade name.

### Grade colours

The gym's grades, easiest to hardest, are part of the identity. They are the
same in both themes (they are physical holds), shown as a dot inside a chip,
always next to the grade's name, so colour is never the only signal.

| Grade | Token | Hex | Dot ring |
| --- | --- | --- | --- |
| yellow | `--grade-yellow` | `#F2C230` | `--grade-ring` |
| green | `--grade-green` | `#3FAE5F` | none |
| blue | `--grade-blue` | `#2F6FD6` | none |
| purple | `--grade-purple` | `#9440B8` | none |
| red | `--grade-red` | `#C0302F` | none |
| black | `--grade-black` | `#1A1A1A` | `--grade-ring` (visible in dark) |
| white | `--grade-white` | `#FFFFFF` | `--grade-ring` (visible in light) |

Green, purple and red are re-stepped from the gym's paint for the screen
(`docs/design-visual.md` V-S3): green↔red is ΔE 12.3 under simulated
deuteranopia (was 4.7) and blue↔purple ΔE 16.8 for normal vision (was 11.9,
OKLab ×100). Blue↔purple is still close for deutans, so the name stays the
signal. `tests/grade-colours.test.ts` checks these.

`--grade-ring` is `#857F72` in light (3.9:1 on white) and `#6B767C` in dark (3.7:1 on black): every dot gets a
1px ring in that colour, which keeps white visible on white and black on
night slate without changing the hold's colour.

Climb outcome is shown on the chip, not by colour:

- **flash** (sent, 1 attempt): solid chip with a bolt icon.
- **sent**: solid chip with a check icon.
- **tried** (not sent): dashed outline, muted text, no icon.

Each chip has an `aria-label` such as "blue boulder, flashed".

## Type

Two families from Google Fonts via `next/font`:

- **Space Grotesk** (`font-display`): headings, numbers, the wordmark. Its
  squared shapes read as sporty without shouting.
- **Inter** (`font-sans`): everything else.

All numbers use `tabular-nums` so stats line up.

| Step | Tailwind | Size / line | Use |
| --- | --- | --- | --- |
| caption | `text-xs` | 12 / 16 | chart ticks, chips, legends, table headers, footnotes |
| meta | `text-meta` | 13 / 18 | captions that carry information: dates, weekly totals and headings, trend lines, stat labels, form hints |
| small | `text-sm` | 14 / 20 | secondary text, chips |
| body | `text-base` | 16 / 24 | chat messages, inputs (16px stops iOS zoom) |
| lead | `text-lg` | 18 / 26 | card titles |
| title | `text-xl` | 22 / 28 | page titles |
| display | `text-2xl` | 28 / 34 | big stats |

Weights: 400 body, 500 labels, 600 headings. Week headings are sentence-case
meta at 600. Small characters lose the most legibility, especially light on
dark (Piepenbrock et al. 2013/2014), so information never goes below 13 px.

## Spacing

Tailwind's 4px scale, used in a small set: 1 (4), 2 (8), 3 (12), 4 (16),
6 (24), 8 (32), 12 (48). Page gutter is 16px on mobile, 24px from `sm`.
Content is capped at 42rem (`max-w-content`) so chat lines stay readable on
desktop.

## Radius

| Token | Tailwind | Value | Use |
| --- | --- | --- | --- |
| `--radius-sm` | `rounded-sm` | 8px | chips' inner parts, small buttons |
| `--radius-md` | `rounded-md` | 12px | inputs, list rows |
| `--radius-lg` | `rounded-lg` | 18px | cards, chat bubbles, sheets |
| `--radius-full` | `rounded-full` | pill | chips, quick replies, icon buttons |

## Elevation

Flat by default; separation comes from `--line` borders. Dark mode lifts
its greys off near-black (canvas `#121618`) so layers read by lightness:
canvas, then surface, then elevated (Apple's base and elevated backgrounds,
Material 3 tonal elevation; design-visual V-M1). One shadow,
`shadow-sheet`, for the bottom sheet and the fixed chat composer.

## Interaction and accessibility

- Every tap target is at least 44x44px (`min-h-11`).
- Focus: `focus-visible` ring, 2px `--focus` with 2px offset in the canvas
  colour. Never remove an outline without replacing it.
- Motion: short fades and slides (150-200ms); all disabled under
  `prefers-reduced-motion`.
- Icons that carry meaning have labels; decorative ones are `aria-hidden`.
- Live regions: new chat replies are announced (`aria-live="polite"`).
- Discreet mode (eye button in the top bar, `lib/discreet.ts`): spread
  `{...SENSITIVE}` on any element that shows personal numbers or notes, and
  `{...REVEAL_UNIT}` on a row or card that one tap should reveal as a whole.
  Blurred content reveals on the first tap; the next tap acts as usual. It is
  visual only, so screen readers still read everything.

## Components

| Component | File | Notes |
| --- | --- | --- |
| AppShell / NavBar | `components/nav.tsx` | bottom tab bar on mobile, top bar from `md`; current page marked with `aria-current` |
| GradeDot | `components/grade.tsx` | ringed dot in a grade colour |
| ClimbChip | `components/grade.tsx` | grade dot + name + outcome icon (flash/sent/tried) |
| SportIcon | `components/icons.tsx` | running shoe / carabiner on its soft sport colour |
| SessionCard | `components/session-card.tsx` | compact row: sport, date, key stats, climbs |
| LoggedSessionCard | `components/session-card.tsx` | in-chat confirmation, "Run · 10 km · 50 min · effort 6" |
| MessageBubble | `app/chat.tsx` | user (sunken, right) and agent (plain, left) |
| QuickReplies | `app/chat.tsx` | horizontally scrolling pill buttons |
| Composer | `app/chat.tsx` | auto-growing textarea + send button, fixed to the bottom |
| SessionSheet | `app/sessions/session-sheet.tsx` | details as a bottom sheet (mobile) / dialog (desktop), with Edit and a two-tap Delete |
| SessionForm | `components/session-form.tsx` | the Log tab and the sheet's edit mode: sport first (radio cards), then date, duration, distance with live pace (runs), effort slider, climbs (style toggle, grade chips to add, tap a row to cycle not sent / sent / flash, +/- attempts) and notes; today's date is read only after mount |
| App icon | `scripts/icon.svg` | white peak and dawn sun on spruce, full bleed with the art inside the maskable safe zone; `node scripts/make-icons.mjs` renders the PNGs, and `app/manifest.ts` uses the canvas colour |
| States | `components/states.tsx` | Skeleton, EmptyState, ErrorState (with retry) |
| Dashboard charts | `app/dashboard/charts.tsx` | weekly load (stacked columns), pace per band (line), hardest send / flash (grade dots on a grade axis) |
| TrendChip | `app/dashboard/dashboard-view.tsx` | the backend's trend word; accent-soft only for "improving". Without a word yet it says what's missing (`trendGap` in `lib/dashboard.ts`: "No runs in the 4 weeks before to compare with", "Trend after 3 recent runs · 1 so far", "Too early for a trend") and may wrap |
| Dashboard summary | `app/dashboard/dashboard-view.tsx` | phones only: three headline numbers (sessions, load, ratio) and one sentence from the backend's ratio zone and trend words (`lib/dashboard.ts`); below 768 px each chart card starts as a row with its trend chip and opens in place, from `md` the grid shows everything (design-visual V-M3) |
