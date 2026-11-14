# Design proposals, round 2

Nine new proposals that build on [design-research.md](design-research.md),
written against the same four papers [Li 2010; Epstein 2015; Parhi 2006;
Consolvo 2009]. Principles P1–P20 are defined there, and full references are in
its section 5. One new principle is added here:

- **P21. Relate facets of life** [Li 2010]. Let people connect training to the
  rest of their life, such as sleep, soreness or stress, because uni-faceted
  systems limit what people can learn about themselves (Li pp. 563–564).

None of these repeats the 13 proposals in design-research.md section 4. Where
one builds on an earlier proposal, it says so. **Finding** marks what a paper
says; **Interpretation** marks my reading of it.

Each proposal has a before/after mockup at 375 px in `docs/design-mockups/`.
They are self-contained HTML using the DESIGN.md tokens; open them directly in
a browser.

**Measurement.** Several signals below need events we do not record today, such
as "review opened", "draft confirmed" or "suggestion accepted". Others can be
read from the existing `sessions` and `model_calls` tables. A small,
privacy-respecting `ui_events` table (user id, event name, timestamp, no
content) would cover the rest. That is a prerequisite noted where it applies.

---

## N1. A weekly review screen

[Mockup](design-mockups/04-weekly-review.html)

**Problem.** Reflection in the app is either momentary (the Logged card, "This
week so far") or analytical (Dashboard charts over 8 weeks). Nothing invites the
person to look back at a finished week as a whole: what they did, how it
compared, and what they want next. Li et al. describe long-term reflection as
where trends and patterns show up (p. 562). Epstein et al. found that people
review at very different rhythms, with weekly a common one for finances
(p. 738). **Interpretation:** a weekly rhythm suits training plans, which are
usually weekly.

**Proposal.**
- On Monday, or when the person first opens the app after a week ends, the Coach
  page shows a "Your week" card. It leads to a one-screen review:
  - sessions per sport and load against the week before
  - the hardest send and best pace of the week, as words and not only charts
  - one sentence from the coach, generated from the same backend numbers
  - a single free-text "Note for next week"
- Past reviews are listed under Sessions.
- The review starts fresh each week. **Finding:** UbiFit's weekly reset meant
  "even if she had a bad week, she can start over fresh in the coming week"
  (Consolvo p. 411).

**Principles.** P3 [Li 2010], P13, P17, P19 [Consolvo 2009], P6 [Epstein 2015].

**Effort.** M. The numbers already exist (`/training-load`, `/progression`).
Needs a review route, a stored note per week, and the Coach card.

**Risks and trade-offs.**
- A weekly prompt can feel like homework. Keep it skippable, never as a
  notification, and quiet after one dismissal.
- A coach sentence that over-claims would undercut the honest trend wording.
  It must reuse the backend's trend words.

**How we'd know it works.**
- Share of active weeks where the review is opened (needs `ui_events`). Target:
  at least 40% after a month.
- Sessions logged in the week after a review is opened, against weeks without
  one, from the `sessions` table.

## N2. Outcome goals with visible progress

[Mockup](design-mockups/05-goal-progress.html)

**Problem.** Proposal 11 in design-research.md adds an optional *weekly* goal,
such as three sessions. Climbers and runners usually also have *outcome* goals:
"send a red by March", "10 km under 50 minutes". The app tracks exactly the
data those goals depend on (grades, pace per distance band) but never relates it
to anything the person wants.

**Proposal.**
- An "Add a goal" flow with two templates:
  - climbing grade: send or flash a grade by a date
  - running pace: a distance band, a target pace and a date
- Each goal is a card showing progress abstractly: grade steps reached, or a
  pace bar from the starting baseline to the target. The numbers sit underneath.
- Goals can be edited, paused or deleted at any time.
- Reaching one gets a quiet mark. Missing the date only asks "Keep it, move the
  date, or let it go?".

**Principles.** P13, P17, P18, P19 [Consolvo 2009], P8 [Epstein 2015].
**Finding:** goal-setting theory says the goal "should be set by the individual
or participatively with the help of an expert (rather than being assigned to her
with no rationale)" (Consolvo p. 406).

**Effort.** L. Needs a goals table with RLS, progress computed from the
existing progression code, cards on Dashboard and Coach, and agent tools so
"set a goal to send red" works in chat.

**Risks and trade-offs.**
- An unreachable goal turns progress into a reminder of failure. Offer a
  realistic default from recent data, and never show red or "failed".
- Two goal kinds (proposal 11 and this) could confuse. Present both under one
  "Goals" heading.

**How we'd know it works.**
- Share of users with at least one active goal after 4 weeks.
- Goal edits as well as completions. Editing shows the person is steering;
  abandonment without edits is the warning sign.
- Session frequency for users with goals, against their own pre-goal baseline.

## N3. A thumb-first home and navigation

[Mockup](design-mockups/06-thumb-first-navigation.html)

**Problem.** At 375 px the four tabs (Coach, Log, Sessions, Dashboard) sit in
easy reach, but three things are awkward:
- Theme, Account and Sign out sit in the top-right corner, the hardest area to
  reach one-handed. **Finding:** the top corners were rated least comfortable
  (Parhi p. 208). **Interpretation:** today's phones are much taller than the
  8.9 cm PDA in that study, which makes this worse.
- Logging, the most frequent action, is a tab like any other.
- The Coach page opens with the conversation, not with the quickest way to log.

**Proposal.**
- Make **Log** a raised centre action in the tab bar, the most comfortable zone
  in Parhi's ratings (p. 208).
- Move Theme, Account and Sign out into a fifth tab, **You**.
- On Coach, put two thumb-sized shortcuts just above the composer: "Repeat last"
  and "Log a session", so the most common entries are one tap from the
  bottom of the screen.
- At 1280 px nothing moves: the top bar keeps the links, and "You" becomes a
  menu at the right.

**Principles.** P10, P11 [Parhi 2006], P1 [Li 2010].

**Effort.** M. Nav, a new `/you` route and the Coach shortcuts. No backend.

**Risks and trade-offs.**
- Five tabs leaves 75 px per tab at 375 px, still above 44 px but tighter.
- A raised centre button is a strong visual. It must stay on-palette (the accent
  token) and not shout.
- Moving Sign out one level deeper is slightly slower, which is fine for a rare
  action.

**How we'd know it works.**
- Median time and number of taps from app open to a saved session. Needs
  `ui_events` with timestamps only.
- Share of sessions logged through the form against the chat, before and after.
- No increase in "wrong tab" taps, i.e. a tab tap followed by another within 2
  seconds.

## N4. The chat fills in the Log form for you to confirm

[Mockup](design-mockups/07-chat-prefills-form.html)

**Problem.** The agent calls `log_session` directly. If it misreads "flashed two
blues", the wrong session is already saved, and proposal 3 in
design-research.md only helps afterwards. **Finding:** automation gains speed
but costs accuracy and control (Li p. 563). Behaviour-change trackers were
bothered by inaccurate records (Epstein p. 737). Editing was considered
essential (Consolvo p. 413).

**Proposal.**
- When the agent understands a session, it returns a **draft** instead of
  saving it.
- The chat shows the draft as a compact card with **Save** and **Review**.
  - Save stores it in one tap, the same speed as today.
  - Review opens the Log form already filled in, including climbs, to adjust
    and save.
- A setting, "Save chat sessions without asking", restores today's behaviour
  for people who trust it.

**Principles.** P5 [Li 2010], P18 [Consolvo 2009], P9 [Epstein 2015].

**Effort.** L. Needs a new agent tool (`draft_session`) and eval cases, a draft
card, the Log form accepting a prefill, and a setting.

**Risks and trade-offs.**
- Always asking adds a tap to every chat log, which works against P1. The
  one-tap Save and the opt-out keep that cost small.
- Drafts that are never saved leave gaps. Keep the draft in the chat until it is
  saved or dismissed.

**How we'd know it works.**
- Edit rate on saved sessions within 24 hours of logging via chat. This should
  fall, because corrections move into the draft.
- Share of drafts opened in Review; a high share means parsing needs work.
- Drafts dismissed without saving: an abandonment signal.

## N5. Pause tracking on purpose

[Mockup](design-mockups/08-pause-tracking.html)

**Problem.** Proposal 8 in design-research.md reacts *after* a gap by detecting
14 quiet days. But people often know in advance: an injury, a holiday, exam
weeks. **Finding:** Epstein et al. name *suspending* as its own kind of lapse
and note that "Suspending tracking differs from suspending the activity that is
being tracked." (p. 739). Consolvo et al. point out that illness and injury
legitimately interrupt activity (p. 409). Today an injury break still drags the
acute:chronic ratio and trends down as if training had simply dropped.

**Proposal.**
- "Take a break" in the You or Account area, with an optional reason (injury,
  illness, holiday, other) and an optional end date.
- During a pause:
  - The Dashboard shows a calm banner.
  - Trends and the ratio exclude the paused days and say so.
  - The coach knows about the pause.
- Ending a pause asks one question: "Pick up where you left off" (show history)
  or "Start fresh" (hide the old baseline for 4 weeks). **Finding:** whether old
  data helps or demotivates someone resuming is an open question (Epstein
  p. 740), so the person chooses.

**Principles.** P6, P9 [Epstein 2015], P17 [Consolvo 2009].

**Effort.** M. A `pauses` table with RLS, changes to the trend and ratio
calculations, the banner, and agent context.

**Risks and trade-offs.**
- Excluding days changes the numbers people may compare with other apps. Label
  it clearly.
- Pauses could hide a real decline the person would want to see. The choice
  stays theirs, and history is never deleted.

**How we'd know it works.**
- Share of pauses that end with sessions logged within 7 days of the end date
  (resumption).
- Return rate after gaps of 14 or more days for users who paused, against those
  who just stopped.

## N6. Context tags on a session

[Mockup](design-mockups/09-context-tags.html)

**Problem.** A run or climb is logged without the things that often explain it:
poor sleep, sore fingers, heat, stress. **Finding:** participants wanted to see
associations between facets of their lives, while most systems were
uni-faceted (Li pp. 563–564). Li's case study also shows the cost: imposing
types of information without asking unnecessarily burdened users (p. 565).

**Proposal.**
- An optional row of tap-to-toggle tags on the Log form and in the chat draft
  (N4): Slept badly, Sore, Tired, Felt strong, Hot, Stressed. They are off by
  default and never required.
- The weekly review (N1) and the coach can then say things like "Your three
  slowest runs this month all had 'Slept badly'". These are counts and
  co-occurrence, never a claimed cause.

**Principles.** P21 [Li 2010], P9 [Epstein 2015], P20 [Consolvo 2009].

**Effort.** L. A schema change (a tags column with an allowed set), the form,
the chat parsing, and careful wording in analysis.

**Risks and trade-offs.**
- More to fill in works against P1. Tags must stay optional and one tap each.
- Co-occurrence can read as causation. Wording must say "often together", and
  only after enough sessions.

**How we'd know it works.**
- Share of sessions with at least one tag after 4 weeks. Below about 15%, tags
  aren't worth the space.
- Whether insights that mention tags are followed by more review opens (N1).

## N7. Discreet mode

[Mockup](design-mockups/10-discreet-mode.html)

**Problem.** Load numbers, injury notes and the coach's comments are personal,
and phones are used in front of others. **Finding:** the Public strategy asks
that people be comfortable if others see the screen, and UbiFit's abstract
garden let participants keep its meaning to themselves (Consolvo pp. 408, 412).

**Proposal.**
- A toggle in the top area (or in You, see N3) that blurs numbers and notes on
  Coach, Sessions and Dashboard until tapped.
- Charts keep their shape but lose their labels.
- The choice is remembered per device, like the theme.

**Principles.** P15, P13 [Consolvo 2009].

**Effort.** S. A CSS class on `<html>`, like the theme switch, plus marking the
sensitive elements.

**Risks and trade-offs.**
- Blurred text must not stay readable to screen readers in a way that surprises
  people. Discreet mode is visual only, and the toggle says so.
- It is easy to forget it is on. Show a small "Discreet" pill while it is
  active.

**How we'd know it works.**
- Share of users who turn it on at least once, and whether they keep it on
  (needs `ui_events`).
- Qualitative: ask 3–5 users whether they now open the app in public.

## N8. "What brings you here?" on first run

[Mockup](design-mockups/11-first-run-focus.html)

**Problem.** Every new user lands in an empty chat. **Finding:** Epstein et al.
found three motivations, behaviour change, instrumental and curiosity, and that
they shape which tools people pick and how they use them (pp. 735–736). Li's
preparation stage is where people decide what to collect, and tools that
ignore it impose the wrong data (pp. 560, 565).

**Proposal.**
- On first sign-in, one screen with three choices:
  - "Get better at running or climbing" (behaviour change): offers a goal (N2)
    and the weekly review (N1)
  - "Keep a simple training log" (a record): leads with the Log form and
    Sessions
  - "Just curious": leads with the coach and the "Am I improving?" prompt
- The choice only changes defaults: the order of Coach shortcuts and whether to
  suggest a goal. It can be changed in You at any time. Nothing is hidden.

**Principles.** P8 [Epstein 2015], P4 [Li 2010].

**Effort.** M. A profile field, the first-run screen, and a few
default-dependent spots.

**Risks and trade-offs.**
- One more screen before first use. It must be skippable, defaulting to "simple
  log".
- Motivations change (Epstein p. 740), so the app could suggest revisiting the
  choice after a month.

**How we'd know it works.**
- Distribution of the three choices. It tells us who our users are, which is
  useful in itself.
- First-week retention (sessions on 2 or more days in the first 7) by choice,
  against users before the screen existed.

## N9. Coach suggestions you can accept, adjust or dismiss

[Mockup](design-mockups/12-coach-suggestions.html)

**Problem.** The coach answers questions but never proposes anything concrete,
and when it does mention a plan in prose there is no way to act on it. **Finding:**
goals work best when set participatively and when progress is easy to gauge
(Consolvo p. 406). **Interpretation:** a suggestion the person can shape keeps
control with them (P18) while still giving the push of an expert.

**Proposal.**
- When the coach suggests something actionable, such as "an easy 30-minute run
  on Thursday" or "a lighter week after this spike", it appears as a card with
  **Add to my week**, **Adjust** and **Not now**.
- Accepted suggestions appear as planned sessions on Coach and in the weekly
  review (N1). Ticking one off opens the Log form prefilled.
- "Not now" teaches nothing permanent and is never mentioned again that week.

**Principles.** P18, P17, P19 [Consolvo 2009], P5 [Li 2010].

**Effort.** L. Needs planned sessions as a concept, agent tools and evals, and
the card. This is the core of the "Training plans and proposals" milestone.

**Risks and trade-offs.**
- Suggestions based on thin data could be wrong or unsafe after injury. Only
  suggest with enough history, respect pauses (N5), and keep the "rough guide"
  tone.
- Too many suggestions become noise. Limit to one open suggestion at a time.

**How we'd know it works.**
- Acceptance rate, and the share of accepted suggestions later logged as done.
- Adjust rate. Frequent adjusting means the defaults are off; adjusting is also
  a healthy sign of control.

---

## Ranking and recommendation

| Rank | Proposal | Effort | Why here |
| --- | --- | --- | --- |
| 1 | N1 Weekly review | M | Highest value for the effort. It uses numbers we already compute, gives reflection a rhythm, and is the place N2, N5, N6 and N9 later report into. |
| 2 | N4 Chat fills in the Log form | L | Fixes trust in the agent at the source. With one-tap Save it costs almost nothing in speed. |
| 3 | N3 Thumb-first navigation | M | Makes the most frequent action the easiest one, and frees the hard-to-reach corner |
| 4 | N5 Pause tracking | M | Cheap compared to the harm of trends punishing an injury. Pairs with proposal 8 in design-research.md. |
| 5 | N7 Discreet mode | S | A small, self-contained privacy win that can ship any time |
| 6 | N2 Outcome goals | L | Strong evidence (Consolvo), but bigger, and it should land after N1 so progress has a home |
| 7 | N8 First-run focus | M | Useful once there are new users to onboard. Low value for the current few accounts. |
| 8 | N6 Context tags | L | Interesting, but risks extra effort for weak insight until there is more data per user |
| 9 | N9 Coach suggestions | L | The most ambitious. It depends on N1, N2 and N5, and belongs to the plans milestone. |

**Recommendation.**
- **Next:** build N1 first, and ship N7 alongside it as a quick win.
- **Then:** N4 and N3, which make logging both faster and more trustworthy.
- **Later:** N5, then N2. Hold N6, N8 and N9 until N1 has shown whether people
  review their weeks. If they don't, the reflection-heavy ideas (N2, N6, N9) need
  rethinking before they are built.
- **First, in any case:** add the small `ui_events` table, because five of the
  nine signals depend on it.
