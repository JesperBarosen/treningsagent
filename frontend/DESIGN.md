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

Light and dark follow the system setting (`prefers-color-scheme`) unless the
user picks Light or Dark with the theme switch in the top bar (System / Light /
Dark, `components/theme-toggle.tsx`). An explicit choice is saved in
localStorage and set as `data-theme` on `<html>` by an inline script before the
first paint (`lib/theme.ts`), and it also sets the browser's `theme-color`.
The dark tokens appear twice in `globals.css`, for `data-theme="dark"` and for
a dark OS; a test keeps the two in step. Contrast is
checked against the background each token sits on (WCAG AA: 4.5:1 for body
text, 3:1 for large text and UI outlines).

| Token | Tailwind | Light | Dark | Use |
| --- | --- | --- | --- | --- |
| `--canvas` | `bg-canvas` | `#F5F4EF` chalk | `#0E1214` night slate | page background |
| `--surface` | `bg-surface` | `#FFFFFF` | `#161B1E` | cards, input, sheets |
| `--sunken` | `bg-sunken` | `#ECEAE3` | `#1E2529` | user bubbles, chips, skeletons |
| `--line` | `border-line` | `#D9D6CC` | `#2C3439` | hairlines, card borders |
| `--ink` | `text-ink` | `#15191B` | `#ECEEEC` | primary text (16:1 / 16:1) |
| `--ink-muted` | `text-ink-muted` | `#5A6166` | `#9AA3A7` | secondary text (5.7:1 / 7.3:1) |
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
| green | `--grade-green` | `#2E9E5B` | none |
| blue | `--grade-blue` | `#2F6FD6` | none |
| purple | `--grade-purple` | `#7C4DC4` | none |
| red | `--grade-red` | `#D63A3A` | none |
| black | `--grade-black` | `#1A1A1A` | `--grade-ring` (visible in dark) |
| white | `--grade-white` | `#FFFFFF` | `--grade-ring` (visible in light) |

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
| caption | `text-xs` | 12 / 16 | labels, week headings, metadata |
| small | `text-sm` | 14 / 20 | secondary text, chips |
| body | `text-base` | 16 / 24 | chat messages, inputs (16px stops iOS zoom) |
| lead | `text-lg` | 18 / 26 | card titles |
| title | `text-xl` | 22 / 28 | page titles |
| display | `text-2xl` | 28 / 34 | big stats |

Weights: 400 body, 500 labels, 600 headings. Week headings are uppercase
caption with 0.06em tracking.

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

Flat by default; separation comes from `--line` borders. One shadow,
`shadow-sheet`, for the bottom sheet and the fixed chat composer.

## Interaction and accessibility

- Every tap target is at least 44x44px (`min-h-11`).
- Focus: `focus-visible` ring, 2px `--focus` with 2px offset in the canvas
  colour. Never remove an outline without replacing it.
- Motion: short fades and slides (150-200ms); all disabled under
  `prefers-reduced-motion`.
- Icons that carry meaning have labels; decorative ones are `aria-hidden`.
- Live regions: new chat replies are announced (`aria-live="polite"`).

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
| TrendChip | `app/dashboard/dashboard-view.tsx` | the backend's trend word; accent-soft only for "improving" |
