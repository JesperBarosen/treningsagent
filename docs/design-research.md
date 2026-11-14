# Design research: six papers against our UI

This review reads six HCI papers, turns them into design principles, checks the
principles against current guidelines (Apple HIG, Material Design 3, WCAG 2.2),
and audits our pages against them. It ends with a prioritised list of changes.

- **Scope:** the Coach chat, the Log form, Sessions, the session details sheet,
  the Dashboard, Sign in and Account, at 375 px and 1280 px wide.
- **Method:** I read the code, without rendering the app. File paths point at
  what was read. Claims about how a screen looks are inferred from the Tailwind
  classes and DESIGN.md tokens.
- **Sources:**
  - The papers are copyrighted. They live in `research/`, which git ignores and
    which is never committed.
  - Quotes are single sentences with page numbers. Everything else is paraphrase.
  - Guidelines were read on 2026-11-14.
- **Labels:**
  - **Finding** is what a paper or guideline says.
  - **Interpretation** is my reading of it for this app.

Principles are numbered P1–P20 across all four papers, so the audit and the
change table can refer to them. Two newer papers were added later (sections 1.5
and 1.6, principles P22–P24). They update Li 2010 and Epstein 2015 and bear on
proposals N1 and N5 in [design-proposals-2.md](design-proposals-2.md), which
defines P21. The visual-design papers are in [design-visual.md](design-visual.md).

## 1. The papers

### 1.1 Li, Dey and Forlizzi (2010): a stage-based model of personal informatics

**Reference.** Ian Li, Anind Dey, and Jodi Forlizzi. 2010. A Stage-Based Model of
Personal Informatics Systems. In *Proceedings of the SIGCHI Conference on Human
Factors in Computing Systems (CHI '10)*. ACM, New York, NY, USA, 557–566.
https://doi.org/10.1145/1753326.1753409

**Summary.** The authors asked people who track themselves which problems get in
their way, and organised the answers into five stages: preparation, collection,
integration, reflection and action. The main idea is that a problem early in the
chain, such as a tedious entry form, starves every later stage. The model also
says people go round the stages repeatedly as their questions change. Each stage
can be done by the person, by the system, or by both. The authors argue for
designing the whole chain rather than one screen. They also argue for letting
people move data in and out, and for balancing automation against control.

**Study details.**

| | |
| --- | --- |
| Year | 2010 (CHI) |
| Method | Online survey, follow-up interviews over instant messenger, affinity diagramming (p. 559) |
| Participants | 68 survey respondents, 11 of them interviewed. Aged 18–64, median range 26–30, recruited from Quantified Self and visualisation blogs and forums (p. 559). |
| Devices | Not a device study. Participants used their own tools: websites, spreadsheets, pen and paper, pedometers, a Wii Fit, a CPAP machine (p. 560). |

The most common collection barriers were the tool itself (13 of 68), forgetting
(12) and lack of time (11) (p. 561, Table 2). On manual tracking, the authors
note: "Since manually collecting information requires more time, fewer
participants reflected on them." (p. 560)

**Principles.**

- **P1. Keep collection cheap.** Every extra step in logging costs data later [Li 2010].
- **P2. Make the data ready to reflect on.** People should not have to transcribe
  or reorganise their data before they can look at it [Li 2010].
- **P3. Support both a quick glance at "now" and long-term trends.** One
  participant complained that the time filters stopped at one month (p. 562) [Li 2010].
- **P4. Let people change what they track and move data in and out**, because
  people iterate [Li 2010].
- **P5. Balance automation with user control in each stage.** Automation brings
  inaccuracy and less control. Manual entry brings burden [Li 2010].

### 1.2 Epstein, Ping, Fogarty and Munson (2015): a lived informatics model

**Reference.** Daniel A. Epstein, An Ping, James Fogarty, and Sean A. Munson. 2015.
A Lived Informatics Model of Personal Informatics. In *Proceedings of the 2015 ACM
International Joint Conference on Pervasive and Ubiquitous Computing (UbiComp '15)*.
ACM, New York, NY, USA, 731–742. https://doi.org/10.1145/2750858.2804250

**Summary.** This paper revises Li et al.'s model for people who track for reasons
other than changing a behaviour: to get rewards, to share, or out of curiosity. It
splits preparation into deciding to track and choosing a tool. It merges
collection, integration and reflection into one ongoing activity, and adds
lapsing and resuming as normal parts of tracking. The authors name four kinds of
lapse: forgetting, upkeep, skipping and suspending. They ask designers to plan
for people coming back after a break, for moving between tools, and for goals
that change over time.

**Study details.**

| | |
| --- | --- |
| Year | 2015 (UbiComp) |
| Method | Screener and domain surveys on Amazon Mechanical Turk, semi-structured interviews, qualitative coding (pp. 733–734) |
| Participants | 168 unique survey respondents (105 physical activity, 99 finances, 83 location), US only. 22 interviewees aged 24–39 (p. 734). |
| Devices | Participants' own tools, e.g. Fitbit, RunKeeper, MapMyRun, Mint, spreadsheets, Foursquare (p. 734, Table 1) |

44% of physical activity trackers had abandoned a tool within three months
(p. 736). Between 14% and 17% still called themselves trackers despite not
having used their tool for a month or more (p. 738). On resuming, the authors
write: "Historical data offers opportunities to bootstrap the data collection
process, but its use requires careful consideration." (p. 740)

**Principles.**

- **P6. Plan for lapses and for coming back.** A gap is normal, and old data can
  help someone restart or put them off [Epstein 2015].
- **P7. Support moving between tools.** Lock-in and data loss keep people on a
  tool that no longer fits, or make them give up [Epstein 2015].
- **P8. Support different and changing motivations**: behaviour change, a record,
  curiosity [Epstein 2015].
- **P9. Accept skipped and partial entries.** People skip what they already know
  or what is too fiddly to enter [Epstein 2015].

### 1.3 Parhi, Karlson and Bederson (2006): target sizes for one-handed thumb use

**Reference.** Pekka Parhi, Amy K. Karlson, and Benjamin B. Bederson. 2006. Target
Size Study for One-Handed Thumb Use on Small Touchscreen Devices. In *Proceedings
of the 8th Conference on Human-Computer Interaction with Mobile Devices and
Services (MobileHCI '06)*. ACM, New York, NY, USA, 203–210.
https://doi.org/10.1145/1152215.1152260

**Summary.** In a lab experiment, people held a touchscreen handheld in one hand
and tapped targets of different sizes and positions with their thumb. There were
two tasks: single taps (like pressing a button) and a sequence of taps (like a
PIN pad). Speed kept improving as targets grew. Errors stopped falling at
9.6 mm for single taps and 7.7 mm for sequences. Combining errors, tap scatter
and comfort ratings, the authors recommend at least 9.2 mm and 9.6 mm
respectively. People rated the middle of the screen most comfortable and the
corners least. Taps on the right edge drifted rightwards.

**Study details.**

| | |
| --- | --- |
| Year | 2006 (MobileHCI) |
| Method | Within-subjects lab experiment. Discrete phase: 5 sizes × 9 locations × 5 repetitions. Serial phase: 5 sizes × 4 locations × 5 repetitions. RM-ANOVA, standing, lift-off selection (pp. 205–206). |
| Participants | 20 right-handed people (17 male, 3 female), aged 19–42, mean 25.7, from a computer science department (p. 205) |
| Devices | HP iPAQ h4155 PDA, 8.9 cm (3.5 in) screen, 240 × 320 px, used with the right thumb (p. 205) |

Mean error rates for single taps were 29.9% at 3.8 mm, 12.9% at 5.8 mm, 5.0% at
7.7 mm, 2.8% at 9.6 mm and 1.6% at 11.5 mm (p. 207, Figure 4). Their conclusion:
"Based on our findings, we recommend that target sizes should be at least 9.2 mm
for single-target tasks and 9.6 mm for multi-target tasks in order to keep the
dimensions of the targets as small as possible without decreasing performance
and user preference." (p. 210)

**Principles.**

- **P10. Make thumb targets large**: about 9.2 mm for single taps and 9.6 mm for
  repeated taps [Parhi 2006].
- **P11. Put frequent targets where the thumb rests.** The centre was most
  comfortable and the corners least (p. 208) [Parhi 2006].
- **P12. Let targets on the thumb's side run to the screen edge**, because taps
  there drift outwards (p. 210) [Parhi 2006].

### 1.4 Consolvo, McDonald and Landay (2009): design strategies for behaviour change

**Reference.** Sunny Consolvo, David W. McDonald, and James A. Landay. 2009.
Theory-Driven Design Strategies for Technologies that Support Behavior Change in
Everyday Life. In *Proceedings of the SIGCHI Conference on Human Factors in
Computing Systems (CHI '09)*. ACM, New York, NY, USA, 405–414.
https://doi.org/10.1145/1518701.1518766

**Summary.** Drawing on goal-setting, the transtheoretical model, Goffman's
presentation of self and cognitive dissonance, the authors propose eight design
strategies for everyday behaviour-change technology. They built UbiFit Garden
to test them: a phone wallpaper where flowers bloom for each workout and a
butterfly appears when the weekly goal is met. In a three-month field
experiment, people with the garden kept up their activity, including in holiday
weeks, while those without it slipped. Participants valued editing their own
records, gentle rewards without punishment, and getting credit for every kind
of activity.

**Study details.**

| | |
| --- | --- |
| Year | 2009 (CHI) |
| Method | Theory-driven strategies, then a paper survey, a three-week field trial and a three-month field experiment with three conditions: full system, no garden, no sensor (pp. 411–412) |
| Participants | Survey: 75 (46 female, aged 18–63). Trial: 12 (aged 25–35). Experiment: 28 (15 female, aged 25–54), Seattle area (pp. 411–412). |
| Devices | Participants' mobile phones running the garden wallpaper and a journal app, plus the Mobile Sensing Platform, a research wearable that infers walking, running, cycling and more. The paper does not name the phone model (pp. 410–411). |

On punishment, they write: "Individuals already feel bad when they do not meet
their goals; they do not need the persuasive technology that is trying to help
them instead make them feel worse." (p. 413) In the experiment, 35–40% of
activities were sensed automatically and the rest were journaled by hand
(p. 413).

**Principles.**

- **P13. Abstract and reflective.** Show behaviour in a form that can be read at a
  glance and that relates to the goal [Consolvo 2009].
- **P14. Unobtrusive.** Available when needed, never in the way, and easy to
  ignore on a busy day [Consolvo 2009].
- **P15. Public.** Comfortable even if someone else sees the screen, so the user
  controls who sees their data [Consolvo 2009].
- **P16. Aesthetic.** Attractive enough that people want it on their own device [Consolvo 2009].
- **P17. Positive.** Reward progress and never punish a missed day or week [Consolvo 2009].
- **P18. Controllable.** Let people add, edit and delete their data and decide who
  can see it [Consolvo 2009].
- **P19. Trending and historical.** Show past behaviour in relation to goals, let
  it adapt as goals change, and keep it portable [Consolvo 2009].
- **P20. Comprehensive.** Give credit for every relevant activity, not only what
  the system can measure [Consolvo 2009].

### 1.5 Epstein et al. (2020): mapping the personal informatics literature

**Reference.** Daniel A. Epstein, Clara Caldeira, Mayara Costa Figueiredo, Xi Lu,
Lucas M. Silva, Lucretia Williams, Jong Ho Lee, Qingyang Li, Simran Ahuja, Qiuer
Chen, Payam Dowlatyari, Craig Hilby, Sazeda Sultana, Elizabeth V. Eikey, and
Yunan Chen. 2020. Mapping and Taking Stock of the Personal Informatics
Literature. *Proceedings of the ACM on Interactive, Mobile, Wearable and
Ubiquitous Technologies* 4, 4, Article 126 (December 2020), 38 pages.
https://doi.org/10.1145/3432231

**Summary.** A decade after Li et al., the authors coded 523 papers on
self-tracking. They found that the field studies health and wellbeing above all,
with physical activity the case in over a third of papers. Research focuses on
collecting and reflecting. Integration and action get less attention, and
preparation the least. Lapsing and abandonment come up in under a tenth of
papers, and few papers offer ways to keep tracked data private from people
nearby. The authors ask for work on the neglected stages, for domain experts in
the design process, and for more attention to privacy.

**Study details.**

| | |
| --- | --- |
| Year | 2020 (IMWUT) |
| Method | Mapping review of the ACM Digital Library, IEEE Xplore and PubMed, searched in January 2020 for publications to 2019; 1,017 candidates screened to 523 and coded by several researchers (126:6–126:8) |
| Participants | None; the unit is the publication (283 ACM, 59 IEEE, 128 PubMed, 53 in several) (126:7) |
| Devices | Not applicable |

Stage coverage: collection 16%, reflection 23%, both 34%, action 29%,
integration 32%, preparation 11% (126:10). Abandonment or lapsing appears in 9%
of papers (126:11). On the skew: "Barriers to collection and reflection are
natural HCI problems, as entry and display of information are central to many
interfaces." (126:18)

**Principles.**

- **P22. Design for preparation and action, not only collection and reflection**
  [Epstein 2020].

**How it updates the earlier papers.**

- **Li 2010:** it *confirms* that the stage model still frames the field, and
  that collection and reflection dominate. It also shows Li's preparation stage
  is still the least studied. **Interpretation:** this supports reworked N8
  (#37), choosing a sport and the research behind the coach, as an
  under-served preparation step.
- **Epstein 2015:** lapsing remains rare in the literature (9%), so P6 still
  rests mostly on the 2015 interviews and on Attig 2020 below.
- **N5 (pause tracking):** the paper notes few designs that protect data from
  onlookers or handle sensitive domains. Injury details in a pause, such as body
  part and pain, are sensitive, so they belong behind discreet mode (N7).

### 1.6 Attig and Franke (2020): why people stop using activity trackers

**Reference.** Christiane Attig and Thomas Franke. 2020. Abandonment of personal
quantification: A review and empirical study investigating reasons for wearable
activity tracking attrition. *Computers in Human Behavior* 102 (January 2020),
223–237. https://doi.org/10.1016/j.chb.2019.08.025

**Summary.** A literature review of reasons for abandoning fitness trackers,
followed by a questionnaire for former users. Losing interest in tracking was
the most agreed reason. Then came disrupted routines, and changed priorities or
life circumstances. Device problems such as inaccuracy, discomfort and usability
ranked lower. About a third said obsessive tracking played a part. About a third
stopped because the activity had become a habit, which the authors call "happy
abandonment". About a quarter cited privacy. Losing motivation went with worse
attitudes towards tracking and more permanent quitting. The authors give six
design guidelines. These include meaningful reminders, tailored interpretations
instead of bare numbers, and more control over data sharing.

**Study details.**

| | |
| --- | --- |
| Year | 2020 (Computers in Human Behavior), online September 2019 |
| Method | Systematic review, then an online questionnaire (September–November 2018), 6-point agreement scales, factor analysis and correlations. Cross-sectional and retrospective (pp. 224–229). |
| Participants | 159 German-speaking former users, 74% female, mean age 32.4 (18–80), recruited via social media and a press release (p. 227) |
| Devices | Former trackers: 96% wrist-worn, 44% Fitbit (p. 229) |

25% had had a gap of over a month before stopping (p. 229). "Feedback about
failure is demotivating" is one of the reasons listed from the literature
(p. 225, Table 1). On ranking: "The most agreed upon reason for abandonment was
decreasing intrinsic tracking motivation." (p. 228)

**Principles.**

- **P23. Expect life to interrupt tracking, and let some endings be success**
  [Attig 2020].
- **P24. Interpret numbers for the person, and never frame them as failure**
  [Attig 2020].

**How it updates the earlier papers.**

- **Li 2010:** Li found collection barriers (the tool, forgetting, lack of time)
  most common. For *automatic* trackers, Attig finds motivation and life
  disruptions outrank device problems. **Interpretation:** we log by hand, so
  Li's collection barriers still apply (P1), and Attig's motivation barriers come
  on top. The newer study doesn't replace Li for manual logging; it adds a layer.
- **Epstein 2015:** it *confirms* lapses with ranked reasons. Disrupted routines
  and changed circumstances are in the top three, and a quarter had month-long
  gaps. It *adds* "happy abandonment": stopping because the goal or habit is
  reached is not failure.
- **Consolvo 2009:** it *agrees* with P17 (negative feedback demotivates). It
  partly conflicts with P14, since Attig recommends reminders. That advice rests
  on cited work and correlations, not a test, so we keep P14 and allow only
  opt-in reminders that explain why.
- **N1 (weekly review, #29):** this supports a coach sentence built from the
  numbers that interprets rather than counts, and never says "failed" (P24).
  It also supports a fresh start after an empty week.
- **N5 (pause tracking, #33):** this is the strongest support for N5. Life
  disruptions are among the top reasons people stop (P23), and a pause with a
  reason turns an interruption into an expected state instead of a decline. It
  also suggests letting "I've built the habit" be a legitimate reason to pause
  or stop.

## 2. Limits

For each principle: how strong the evidence is, and whether current guidelines
agree. The guidelines checked are Apple's Human Interface Guidelines [Apple HIG
Accessibility; Apple HIG Charts], Material Design 3 [M3 Structure; Google Touch
targets] and WCAG 2.2 [WCAG 2.2]. "Not addressed" means the guideline is silent,
not that it disagrees.

**General caveats** (interpretation):

- The first four papers are 10–20 years old. The two added later (2020) are newer but still predate today's phones and apps.
- Three rely on self-report from enthusiastic, tech-savvy, mostly US samples.
- Parhi used a resistive PDA screen that is far smaller than today's phones.
- None of the papers studied runners or climbers specifically. Consolvo's
  sample (people trying to be more active) is the closest to ours.

| # | Evidence (finding) | Strength (interpretation) | Apple HIG | Material 3 | WCAG 2.2 |
| --- | --- | --- | --- | --- | --- |
| P1 | Collection barriers were reported by 11–13 of 68 respondents each (Li p. 561) | Moderate: consistent with later work (Epstein's "upkeep" lapses), but self-reported and from a 2010 sample | Not addressed directly | Not addressed directly | Partly: 3.3.7 Redundant Entry (A) asks that information already entered *in the same process* is reused. Our "Repeat last session" goes further than this. |
| P2 | Transcription was the top integration barrier (10/68, Li p. 561) | Moderate | Not addressed | Not addressed | Not addressed |
| P3 | Short- and long-term reflection both valued. One participant wanted more than a month (Li p. 562). | Weak to moderate: few respondents. The value of long-term views is echoed by Consolvo P19. | Agrees on charts: "An effective chart highlights a few key pieces of information in a dataset, helping people gain insights and make decisions." [Apple HIG Charts] | Not checked (page did not render) | Not addressed |
| P4 | Tool switching lost data. Import/export recommended (Li p. 563). | Moderate. Also echoed by Epstein (P7). | Not addressed | Not addressed | Not addressed |
| P5 | Trade-off argued from cases (Mint mislabelling, Li p. 565) | Weak: an argument, not measured | Not addressed | Not addressed | 3.3.4 Error Prevention (AA): changes to stored user data should be reversible, checked or confirmed. This agrees with keeping the user in control. |
| P6 | Four lapse types. 14–17% "current" trackers had not tracked for a month (Epstein p. 738). | Moderate: 168 + 22 people, but MTurk and US only, and no app-level test of resume designs | Not addressed | Not addressed | Not addressed |
| P7 | Switching costs keep people on poor tools (Epstein p. 740) | Moderate (interviews) | Not addressed | Not addressed | Not addressed |
| P8 | Three motivations, varying by domain (Epstein p. 736) | Moderate. Our users are probably mostly "behaviour change" (interpretation). | Not addressed | Not addressed | Not addressed |
| P9 | Skipping when entry is too fiddly (Epstein p. 739) | Moderate | Not addressed | Not addressed | Not addressed |
| P10 | Errors stop falling at about 9.6 mm (single taps). Recommendation ≥ 9.2 mm (Parhi pp. 207, 210). | Strong for its setting (controlled experiment), but n = 20, all right-handed, standing, 2006 resistive screen | **Agrees in spirit, smaller number.** 44 × 44 pt default and 28 × 28 pt minimum on iOS [Apple HIG Accessibility]. | **Agrees in spirit.** 48 × 48 dp with 8 dp spacing, about 9 mm, per Google's Android help [Google Touch targets]. M3 page not verified (see caveat below). | **Floor, not target.** 2.5.8 (AA): at least 24 × 24 CSS px or spacing. 2.5.5 (AAA): 44 × 44 CSS px [WCAG 2.2]. |
| P11 | Centre most comfortable, corners least (Parhi p. 208) | Weak to moderate: subjective ratings on a small PDA. **Interpretation:** today's taller phones put the top corners even further out of reach. | Not addressed as a zone rule | Not addressed | Not addressed |
| P12 | Rightward drift on the right column (Parhi p. 208) | Weak: one observation, right-handers only | Not addressed | Not addressed | Not addressed |
| P13 | Garden was understood at a glance and kept activity up (Consolvo p. 412) | Moderate: field experiment, but n = 28 and a three-condition design | Agrees: highlight a few key pieces of information [Apple HIG Charts] | Not checked | 1.1.1 / 1.4.1: charts need text alternatives and must not rely on colour alone. Apple agrees: "Avoid relying solely on color to differentiate between different pieces of data or communicate essential information in a chart." [Apple HIG Charts] |
| P14 | Phone placement valued and the system could be ignored (Consolvo p. 412) | Moderate | Not addressed | Not addressed | 2.4.11 Focus Not Obscured (AA) is related: fixed bars must not fully hide the focused element |
| P15 | Abstract garden protected privacy in public (Consolvo p. 412) | Moderate. **Interpretation:** the same need covers a shared phone or browser. | Not addressed here | Not addressed | Not addressed |
| P16 | Garden liked, but some men were teased about flowers (Consolvo p. 412) | Weak: taste varies | Not addressed | Not addressed | Not addressed |
| P17 | Punishment reduced use in Fish'n'Steps, and the gentle garden was valued (Consolvo pp. 409, 413) | Moderate, but the comparison is across studies | Not addressed | Not addressed | Not addressed |
| P18 | All sensor users called editing essential (Consolvo p. 413) | Moderate | Not addressed | Not addressed | 3.3.4 (AA) agrees for deletes: reversible, checked or confirmed |
| P19 | Only short-term evidence. The authors call it limited (p. 413). | Weak, by the authors' own account | Not addressed | Not addressed | Not addressed |
| P20 | Manual journaling covered what the sensor missed. No one avoided activities (Consolvo p. 413). | Moderate | Not addressed | Not addressed | Not addressed |
| P22 | Preparation in 11% of 523 papers, action in 29% (Epstein 2020, 126:10) | Moderate: a map of research attention, not of user outcomes | Not addressed | Not addressed | Not addressed |
| P23 | Disrupted routines and changed circumstances among the top reasons; 25% had month-long gaps (Attig pp. 228–229) | Moderate: n = 159, retrospective self-report, cross-sectional, about wearables rather than manual logs | Not addressed | Not addressed | Not addressed |
| P24 | Demotivating feedback listed as a reason; motivation loss linked to permanent quitting (Attig pp. 225, 231) | Weak to moderate: a correlation and a derived guideline. It agrees with P17. | Not addressed | Not addressed | Not addressed |

**From millimetres to CSS pixels** (interpretation, P10). Assume an iPhone-class
screen at about 460 ppi with a device pixel ratio of 3. That gives about 153
CSS px per inch, so 1 CSS px ≈ 0.166 mm. On that basis:

| CSS px | Physical size |
| --- | --- |
| 44 | ≈ 7.3 mm |
| 36 | ≈ 6.0 mm |
| 9.2 mm (Parhi's single-tap recommendation) | ≈ 55 px |

So Apple's and WCAG's 44 is a compromise, smaller than Parhi's recommendation.
Our 36 px controls sit near Parhi's 5.8 mm condition, where the single-tap error
rate was 12.9%. Modern capacitive screens are more accurate than the 2006
resistive one, so the real error rate is probably lower. The direction still
holds.

**Material Design 3 caveat.** The M3 page itself did not render for this review,
so its wording is not verified here. The 48 × 48 dp figure (with 8 dp spacing,
about 9 mm) comes from Google's Android accessibility help [Google Touch targets].
I assume, as an interpretation, that Material 3 uses the same number. Check the
M3 page before quoting it as Material's own.

## 3. Audit

Read from the code at the current `main`. The key widths:

- **375 px:** a phone with the bottom tab bar, the sticky top bar and the fixed
  chat composer.
- **1280 px:** desktop, with links in the top bar, no tab bar, and content
  capped at `max-w-content` (42 rem), or `max-w-5xl` on the dashboard.

| # | Follows | Breaks or at risk |
| --- | --- | --- |
| P1 | Logging in one sentence in the chat (`frontend/app/chat.tsx`, quick replies prefill "Ran  km in  min…"). The Log form asks for the sport first, defaults the date to today and the effort to 5, and has "Repeat last session" (`frontend/components/session-form.tsx`, `frontend/app/log/log-view.tsx`). | Effort is always required (`session-form.tsx`, `valid`). This is reasonable, since load depends on it. |
| P2 | Load, pace, trends and the acute:chronic ratio are computed by the backend and shown without any work (`frontend/app/dashboard/dashboard-view.tsx`) | No data from other tools can be brought in, so anyone with a watch or an older log must retype it |
| P3 | Short term: the in-chat "Logged" card (`frontend/components/session-card.tsx`) and "This week so far" (`dashboard-view.tsx`, `LoadCard`) | Long term: Sessions shows 8 weeks only (`frontend/app/sessions/sessions-view.tsx`, `DAYS = 56`) and the dashboard 8 weeks (`WEEKS = 8`). There is no way to see older data. At 375 px the Coach page, the first screen, has no glance at the week. |
| P4 | – | No import or export. Sports are fixed to running and climbing (`frontend/lib/api.ts`, `Sport`). Covered by the "Custom log forms" and "Import (GPX/FIT)" milestones. |
| P5 | Two routes: the agent parses free text, or the form gives full manual control | A session logged through the chat cannot be corrected from the chat. The Logged card links to `/sessions` in general, not to that session (`session-card.tsx`, `LoggedSessionCard`). |
| P6 | Trend chips say "Not enough data" instead of guessing, and the ratio card explains how much history it needs (`dashboard-view.tsx`, `RatioCard`) | Nothing acknowledges a return after a break. After weeks away, the dashboard shows "Declining" or "Not enough data" with no context. |
| P7 | – | No export, so leaving the app means losing the data |
| P8 | Quick replies cover both logging and curiosity ("Am I improving?", "This week's load") | No goals for behaviour-change users (see P17, P19) |
| P9 | Notes, distance and climbs are optional. A run needs only sport, duration and effort (`session-form.tsx`). | – |
| P10 | Buttons are `min-h-11`, 44 px (`frontend/components/states.tsx`). Tab bar, grade chips, the climb row's +/− and remove buttons, sheet buttons and the theme switch are all 44 px. The sport cards are 56 px (`min-h-14`). | Below DESIGN.md's own 44 px rule: chat quick replies `min-h-9` = 36 px (`chat.tsx:177`); Sessions filter `min-h-9` (`sessions-view.tsx:73`); Log form style toggle `min-h-9` (`session-form.tsx:310`); sign-in method toggle `min-h-10` = 40 px (`frontend/app/sign-in/sign-in-form.tsx:122`). All pass WCAG 2.5.8 (24 px) but miss Apple's 44 pt and Material's 48 dp. At 1280 px with a mouse this matters less. |
| P11 | At 375 px the tab bar, composer and send button sit at the bottom, within thumb reach (`frontend/components/nav.tsx`, `chat.tsx`). The sheet's Edit and Delete are at the bottom of the sheet (`frontend/app/sessions/session-sheet.tsx`). | The Log form's "Log session" button sits at the end of the form, so a long climbing session pushes it below the fold (`session-form.tsx`). Theme, Account and Sign out sit in the top-right corner (`nav.tsx`). This is acceptable because they are rarely used. |
| P12 | Tab bar items are `flex-1`, so they reach both edges (`nav.tsx`, `TabBar`) | The send button stops 16 px short of the right edge (`chat.tsx`, `px-4`). This is minor. |
| P13 | Trend words, grade dots with names, and a "Show the numbers" table for every chart (`dashboard-view.tsx`, `frontend/app/dashboard/charts.tsx`). Colour is never the only signal (`frontend/components/grade.tsx`). | The glanceable view lives on the Dashboard tab, not on the Coach page people open first |
| P14 | No notifications or nags. Quiet empty states (`states.tsx`). | At 375 px the fixed composer and tab bar cover the bottom of the chat. `pb-52` leaves room, but WCAG 2.4.11 should be checked with a keyboard. |
| P15 | Data is behind sign-in and Row Level Security | **The chat history stays in `localStorage` after sign-out** (`chat.tsx`, `STORAGE_KEY`, and `nav.tsx`, `SignOutButton`). The next person to sign in on the same browser sees the previous user's chat, including any sessions and notes it mentions. |
| P16 | One design system, light and dark, an app icon (`frontend/DESIGN.md`) | – |
| P17 | "Declining" uses the same neutral chip as "Flat", and only "Improving" is tinted (`dashboard-view.tsx`, `TrendChip`). The ratio card is labelled "Rough guide" and avoids injury talk. | No positive reinforcement at all: nothing marks a good week or a goal met |
| P18 | Edit and two-tap Delete in the sheet (`session-sheet.tsx`). Log via form or chat. | Sessions older than 8 weeks cannot be opened, so they cannot be edited or deleted (`sessions-view.tsx`). Chat-logged sessions cannot be fixed in place (P5). |
| P19 | Dashboard trends compare the last 2 weeks with the 4 before (`dashboard-view.tsx`) | No goals to relate history to. History capped at 8 weeks. No portability (P7). |
| P20 | Climbing records every climb, including unsent ones (`session-form.tsx`, `ClimbsField`) | Only running and climbing exist. Strength work, cycling or hangboarding cannot be logged, so weekly load undercounts training. |

**Other finding (no principle):** the chat error bubble still says "Check that the
API is running, then try again." in production (`chat.tsx`, `Message`). PR #9
fixed the same message in `states.tsx` but not here.

## 4. Proposed changes

Prioritised by expected benefit against effort. **S** is a few hours, **M** is a
day or two, **L** is a milestone-sized piece. Mockups for the top three are in
`docs/design-mockups/`: static HTML using the DESIGN.md tokens, with before and
after side by side at 375 px.

| # | Change | Page | Principles | Effort | Expected benefit |
| --- | --- | --- | --- | --- | --- |
| 1 | Clear the saved chat on sign-out, and key it by user id ([mockup](design-mockups/01-clear-chat-on-sign-out.html)) | Coach, top bar | P15, P18 [Consolvo 2009] | S | Stops one user seeing another's chat on a shared phone or browser. This is a privacy fix. |
| 2 | Raise the four 36–40 px toggles and chips to 44 px, and add 8 px between chips ([mockup](design-mockups/02-tap-targets-44px.html)) | Coach, Sessions, Log, Sign in | P10 [Parhi 2006]. Apple HIG, Material, DESIGN.md. | S | Fewer mis-taps one-handed. Brings the app in line with its own design rule. |
| 3 | Add "Edit" and "Undo" to the in-chat Logged card, opening that session's sheet ([mockup](design-mockups/03-edit-from-logged-card.html)) | Coach | P5 [Li 2010], P18 [Consolvo 2009] | M | Lets people fix a misread run or climb right where it happened, which keeps the agent's record trustworthy |
| 4 | Show the full chat error text only in development, and plain wording in production | Coach | P14 [Consolvo 2009] (interpretation: errors should not demand action the user cannot take) | S | Removes a developer message from the production app |
| 5 | A compact "This week" strip on the Coach page: sessions, load so far, and last week for comparison | Coach | P3 [Li 2010], P13 [Consolvo 2009] | M | A glance at the week where people already are, without opening the Dashboard |
| 6 | "Load older" for Sessions, in steps of 8 weeks, so all history is reachable and editable | Sessions | P3 [Li 2010], P18, P19 [Consolvo 2009] | M | Long-term reflection, and old mistakes can be corrected |
| 7 | Keep the Log form's submit button in a sticky bar above the tab bar on mobile | Log, sheet edit | P11 [Parhi 2006] | S | The main action stays in thumb reach on long climbing sessions |
| 8 | A neutral "Welcome back" after 14 or more days without sessions, with trends labelled "after a break" instead of "Declining" | Coach, Dashboard | P6 [Epstein 2015], P17 [Consolvo 2009] | M | Lowers the cost of resuming after illness or injury, a common reason for gaps in both papers |
| 9 | Export sessions and climbs as CSV from Account | Account | P4 [Li 2010], P7 [Epstein 2015], P19 [Consolvo 2009] | M | No lock-in. People can analyse or move their data. |
| 10 | Empty states on Sessions and Dashboard offer both "Log a session" (form) and "Tell the coach" (chat) | Sessions, Dashboard | P1 [Li 2010], P8 [Epstein 2015] | S | A first entry in whichever way suits the person |
| 11 | An optional weekly goal (sessions or load) that the user sets, with a quiet mark when it is met and nothing when it is not | Dashboard, Coach | P17, P19 [Consolvo 2009], P8 [Epstein 2015] | L | Positive reinforcement and a reference point for trends. Fits the "Training plans and proposals" milestone. |
| 12 | An "Other training" sport (strength, cycling, hangboard) counted in weekly load | Log, Dashboard | P20 [Consolvo 2009], P4 [Li 2010] | L | Load reflects all training, not just what the app models. Fits "Custom log forms". |
| 13 | Let the chat send button reach the right edge of the composer on mobile | Coach | P12 [Parhi 2006] | S | A slightly more forgiving target for right-handed thumbs. Low priority, since the evidence is weak. |

## 5. References

Apple Inc. 2026. Accessibility. *Human Interface Guidelines*. Retrieved November
14, 2026 from https://developer.apple.com/design/human-interface-guidelines/accessibility
[Apple HIG Accessibility]

Apple Inc. 2026. Charts. *Human Interface Guidelines*. Retrieved November 14, 2026
from https://developer.apple.com/design/human-interface-guidelines/charts
[Apple HIG Charts]

Christiane Attig and Thomas Franke. 2020. Abandonment of personal
quantification: A review and empirical study investigating reasons for wearable
activity tracking attrition. *Computers in Human Behavior* 102 (2020), 223–237.
https://doi.org/10.1016/j.chb.2019.08.025 [Attig 2020]

Sunny Consolvo, David W. McDonald, and James A. Landay. 2009. Theory-Driven Design
Strategies for Technologies that Support Behavior Change in Everyday Life. In
*Proceedings of the SIGCHI Conference on Human Factors in Computing Systems
(CHI '09)*. ACM, New York, NY, USA, 405–414. https://doi.org/10.1145/1518701.1518766
[Consolvo 2009]

Daniel A. Epstein, Clara Caldeira, Mayara Costa Figueiredo, Xi Lu, Lucas M.
Silva, Lucretia Williams, Jong Ho Lee, Qingyang Li, Simran Ahuja, Qiuer Chen,
Payam Dowlatyari, Craig Hilby, Sazeda Sultana, Elizabeth V. Eikey, and Yunan
Chen. 2020. Mapping and Taking Stock of the Personal Informatics Literature.
*Proc. ACM Interact. Mob. Wearable Ubiquitous Technol.* 4, 4, Article 126
(December 2020), 38 pages. https://doi.org/10.1145/3432231 [Epstein 2020]

Daniel A. Epstein, An Ping, James Fogarty, and Sean A. Munson. 2015. A Lived
Informatics Model of Personal Informatics. In *Proceedings of the 2015 ACM
International Joint Conference on Pervasive and Ubiquitous Computing (UbiComp '15)*.
ACM, New York, NY, USA, 731–742. https://doi.org/10.1145/2750858.2804250
[Epstein 2015]

Google. 2026. Accessibility: Structure. *Material Design 3*. Retrieved November 14,
2026 from https://m3.material.io/foundations/designing/structure [M3 Structure]
(the page did not render for this review)

Google. 2026. Touch target size. *Android Accessibility Help*. Retrieved November
14, 2026 from https://support.google.com/accessibility/android/answer/7101858
[Google Touch targets]

Ian Li, Anind Dey, and Jodi Forlizzi. 2010. A Stage-Based Model of Personal
Informatics Systems. In *Proceedings of the SIGCHI Conference on Human Factors in
Computing Systems (CHI '10)*. ACM, New York, NY, USA, 557–566.
https://doi.org/10.1145/1753326.1753409 [Li 2010]

Pekka Parhi, Amy K. Karlson, and Benjamin B. Bederson. 2006. Target Size Study for
One-Handed Thumb Use on Small Touchscreen Devices. In *Proceedings of the 8th
Conference on Human-Computer Interaction with Mobile Devices and Services
(MobileHCI '06)*. ACM, New York, NY, USA, 203–210.
https://doi.org/10.1145/1152215.1152260 [Parhi 2006]

W3C. 2024. Web Content Accessibility Guidelines (WCAG) 2.2. W3C Recommendation,
12 December 2024. https://www.w3.org/TR/WCAG22/ [WCAG 2.2]

W3C Web Accessibility Initiative. 2024. Understanding Success Criterion 2.5.8:
Target Size (Minimum). Retrieved November 14, 2026 from
https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
