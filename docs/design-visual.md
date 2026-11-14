# Visual design research: colour, contrast, charts and appeal

This review reads eight papers on visual design and on why people keep or stop
tracking, turns them into principles, checks the principles against WCAG 2.2,
Apple's Human Interface Guidelines and Material Design 3, audits our colours,
type, dark mode and charts, and ends with proposals ranked by effort. It is the
visual companion to [design-research.md](design-research.md) (P1–P24) and
[design-proposals-2.md](design-proposals-2.md) (N1–N9).

- **Scope:** the colour tokens, type scale, dark theme and Dashboard charts
  (`frontend/DESIGN.md`, `frontend/app/globals.css`,
  `frontend/app/dashboard/charts.tsx`, `frontend/components/grade.tsx`), at
  375 px and 1280 px.
- **Method:**
  - I read the code without rendering the app.
  - Every contrast ratio below was computed from the hex values with the WCAG 2.2
    formula.
  - Colour-difference checks use the dataviz palette validator: OKLab ΔE ×100,
    with colour-vision-deficiency (CVD) simulation for protanopia, deuteranopia
    and tritanopia. Its targets are ΔE ≥ 8 under CVD and ≥ 15 for normal vision.
- **Sources:**
  - The papers are copyrighted. They live in `research/`, which git ignores and
    which is never committed.
  - Quotes are single sentences with page numbers. Everything else is paraphrase.
  - Year and venue were checked against each PDF. Where a PDF carries no page
    numbers or DOI (Reinecke 2013, Heer 2010), these were checked against
    Crossref. Guidelines were read on 2026-11-14.
- **Labels:**
  - **Finding** is what a paper or guideline says.
  - **Interpretation** is my reading of it for this app.

Principles are numbered VP1–VP14, so the audit and proposals can refer to them
without clashing with P1–P24.

## 1. The papers

### 1.1 Reinecke et al. (2013): first impressions, complexity and colourfulness

**Reference.** Katharina Reinecke, Tom Yeh, Luke Miratrix, Rahmatri Mardiko,
Yuechen Zhao, Jenny Liu, and Krzysztof Z. Gajos. 2013. Predicting Users' First
Impressions of Website Aesthetics with a Quantification of Perceived Visual
Complexity and Colorfulness. In *Proceedings of the SIGCHI Conference on Human
Factors in Computing Systems (CHI '13)*. ACM, New York, NY, USA, 2049–2058.
https://doi.org/10.1145/2470654.2481281

**Summary.** People decide whether they like a web page within half a second, and
that first impression colours later judgements of usability and trust. The
authors built two image models, one for perceived colourfulness and one for
perceived visual complexity, from ratings of website screenshots. They then
asked a separate group to rate appeal after 500 ms. Together with demographics,
the two models explained about half of the variation in appeal. Complexity
mattered much more than colourfulness: very busy pages lost the most appeal,
while simple and moderately complex pages did about equally well. Taste was not
universal. Participants over 45 liked low complexity more than younger ones, and
education level changed how colourfulness was received.

**Study details.**

| | |
| --- | --- |
| Year | 2013 (CHI) |
| Method | Online experiments on LabintheWild. Screenshots shown for 500 ms, rated twice on 9-point scales. Regression models of image features, then a linear mixed-effects model of appeal (pp. 2052–2056). |
| Participants | Model building: 184 (colourfulness) and 122 (complexity). Appeal study: 242 volunteers (103 female), aged 16–70, mean 32.3, from 34 countries, 28.5% in the US (pp. 2053, 2055). |
| Stimuli | 450 website screenshots, including foreign-script and greyscale ones |

The final model explained 48% of the variance in appeal (p. 2056). On the shape
of the effect: "In fact, our analyses show that a high visual complexity results
in the largest decrease in appeal, but websites with low levels of complexity are
similarly liked to those with a medium complexity." (p. 2056)

**Principles.**

- **VP1. Keep first screens low to moderate in complexity.** Busy screens lose the
  most appeal; colour matters less [Reinecke 2013].
- **VP2. Don't assume one taste.** Age and education change what looks good, so
  default to calm and let people adjust where it is cheap [Reinecke 2013].

### 1.2 Szafir (2018): colour difference for points, bars and lines

**Reference.** Danielle Albers Szafir. 2018. Modeling Color Difference for
Visualization Design. *IEEE Transactions on Visualization and Computer Graphics*
24, 1 (January 2018), 392–401. https://doi.org/10.1109/TVCG.2017.2744359

**Summary.** Colour-difference rules such as "one CIELAB unit is one
just-noticeable difference" come from large colour patches seen in ideal
conditions. Charts use small marks seen on ordinary screens. In three
crowdsourced experiments, people judged whether two marks in a scatterplot, a
bar chart or a line chart had the same colour. Differences got harder to see as
marks got smaller, and real-world thresholds were much larger than lab models
predict. Elongated marks helped: bars and lines were easier to tell apart than
dots of the same thickness, with the gain levelling off at about a 2:1 length to
thickness ratio. Lightness differences were seen more reliably than differences
along the red–green or blue–yellow axes. The models also showed that 13 of 18
ColorBrewer sequential ramps were not robust at common mark sizes.

**Study details.**

| | |
| --- | --- |
| Year | 2018 (IEEE TVCG, presented at IEEE VIS 2017) |
| Method | Three crowdsourced binary forced-choice experiments ("same" or "different") on Amazon Mechanical Turk, with Ishihara screening. Mixed-factor designs over mark size, colour axis and ΔE; linear models per size and axis (pp. 394–399). |
| Participants | 461 recruited in total, US only. After exclusions: 72 (points), 288 (bars), 72 (lines); mean ages about 34–35 (pp. 395–398) |
| Devices | Participants' own uncalibrated displays, in their own viewing conditions |

For 2 px lines, the 50% threshold on lightness was 15.35 CIELAB ΔE, against
5.75 for a 25 px point (pp. 396, 399). The headline: "First, our models confirm
prior findings [50, 51] that traditional measures of color difference are not
robust for real-world viewing: a 2° JND for a scatterplot point was roughly 3
times larger than that predicted in controlled environments [31]." (p. 399)

**Principles.**

- **VP3. Thin and small marks need bigger colour steps.** A pair that is easy to
  tell apart as bars may fail as 2 px lines or 8 px dots, so validate colours at
  the size they are drawn [Szafir 2018].
- **VP4. Prefer lightness differences and elongated marks** when colour must
  carry identity [Szafir 2018].

### 1.3 Heer and Bostock (2010): crowdsourced graphical perception

**Reference.** Jeffrey Heer and Michael Bostock. 2010. Crowdsourcing Graphical
Perception: Using Mechanical Turk to Assess Visualization Design. In
*Proceedings of the SIGCHI Conference on Human Factors in Computing Systems
(CHI '10)*. ACM, New York, NY, USA, 203–212.
https://doi.org/10.1145/1753326.1753357

**Summary.** The authors tested whether Mechanical Turk could replace the lab for
chart-perception studies. They replicated two classic experiments: Cleveland and
McGill's ranking of encodings, where position on a common scale beats length,
angle and area, and Stone and Bartram's study of how dark gridlines should be.
Both replicated, with more noise but the same design advice. New experiments
found that squarish rectangles are judged worst in area comparisons. They also
found that accuracy stops improving once a chart is about 80 px tall, and that
gridlines help, as long as they are not packed too tightly.

**Study details.**

| | |
| --- | --- |
| Year | 2010 (CHI) |
| Method | Five crowdsourced experiments with qualification tasks: proportional judgements, rectangle areas, gridline alpha adjustment, and chart height × gridline spacing (pp. 205–209) |
| Participants | 186 different Turkers across all experiments; for example N = 50 per chart in Exp. 1A and N = 24 per trial in Exp. 2 and 3 (pp. 205, 207, 209) |
| Devices | Participants' own displays, 1024 × 768 to 1920 × 1200 (p. 208) |

The gridline replication supported an alpha of 0.2 as a safe default (p. 208).
Charts 40 px tall produced significantly more error, with no gain past 80 px
(p. 209). On spacing: "The results suggest that gridlines be separated by at
least 8 pixels." (p. 209)

**Principles.**

- **VP5. Encode the key comparison as position on a common scale** before length,
  angle or area [Heer 2010, replicating Cleveland and McGill].
- **VP6. Keep gridlines light but visible**, about alpha 0.2 of the ink, at least
  8 px apart, and keep charts at least 80 px tall [Heer 2010].

### 1.4 Tuch et al. (2012): is beautiful really usable?

**Reference.** Alexandre N. Tuch, Sandra P. Roth, Kasper Hornbæk, Klaus Opwis,
and Javier A. Bargas-Avila. 2012. Is beautiful really usable? Toward
understanding the relation between usability, aesthetics, and affect in HCI.
*Computers in Human Behavior* 28, 5 (September 2012), 1596–1607.
https://doi.org/10.1016/j.chb.2012.03.024

**Summary.** A popular idea in HCI is "what is beautiful is usable": good-looking
interfaces are judged easier to use. The authors tested both directions at once.
They built four versions of the same online shop, crossing high and low
aesthetics with high and low usability, and had people find products and rate
the shop before and after use. Aesthetics did not change how usable the shop
seemed, either before or after use. Poor usability, though, lowered how
beautiful people found the shop after using it. The frustration it caused
explained that drop. **Interpretation:** for an app people return to daily,
friction costs more in perceived quality than polish can win back.

**Study details.**

| | |
| --- | --- |
| Year | 2012 (Computers in Human Behavior) |
| Method | Lab experiment, 2 × 2 between-subjects (aesthetics × usability), pre- and post-use ratings on validated scales (SUS, AttrakDiff 2, classical and expressive aesthetics, SAM valence), mediation analysis (pp. 1599–1602) |
| Participants | 80 (42 female), mean age 25.7, all experienced online shoppers, paid about US$50 (p. 1599) |
| Stimulus | One online shop, with aesthetics varied by templates chosen by an expert panel, and usability varied by information architecture (pp. 1599–1600) |

In the authors' words: "Users were frustrated by the low usability and lowered
their aesthetics ratings." (p. 1604)

**Principles.**

- **VP7. Fix friction before polishing looks.** Usability drives perceived beauty
  after use, not the other way round [Tuch 2012].

### 1.5 Piepenbrock et al. (2013): positive polarity for younger and older adults

**Reference.** Cosima Piepenbrock, Susanne Mayr, Iris Mund, and Axel Buchner.
2013. Positive display polarity is advantageous for both younger and older
adults. *Ergonomics* 56, 7 (2013), 1116–1124.
https://doi.org/10.1080/00140139.2013.790485

**About the file.** `research/piepenbrock-2013.pdf` is not the article alone. It
is Cosima Piepenbrock's cumulative doctoral dissertation (Heinrich-Heine-Universität
Düsseldorf, submitted March 2014, defended 4 April 2014). It bundles three
studies:

- Experiment 1: character size, published in *Human Factors*
  (https://doi.org/10.1177/0018720813515509, in press at submission)
- Experiment 2: pupil size, under review at the time
- Experiment 3: the 2013 *Ergonomics* article above

This section is about the 2013 article. Page numbers are those of the published
article (the bundled online-first copy, pp. 1–9, maps to 1116–1124). The
dissertation's own summary is cited as [Piepenbrock 2014].

**Summary.** Dark text on a light background ("positive polarity") is usually
read better than light on dark. The likely reason is luminance: a brighter
screen narrows the pupil, which sharpens the image on the retina. Older eyes
scatter more light, so the advantage might shrink or reverse with age. The
authors tested younger and older adults on a Landolt-C acuity test and a
proofreading task, each in one polarity only. Both age groups did better with
dark-on-light. The acuity advantage was smaller for older adults, but it did not
reverse. Reading speed did not differ, so the accuracy gain was not a
speed–accuracy trade-off. The dissertation adds that the advantage is largest
when fine detail must be seen, such as small characters (Piepenbrock 2014, p. 5).

**Study details.**

| | |
| --- | --- |
| Year | 2013 (Ergonomics), received December 2012 |
| Method | Lab experiment, 2 × 2 between-subjects (age × polarity). Visual acuity (FrACT, Landolt C, 184 cm) and proofreading 28 texts at 50 cm, plus mood and discomfort questionnaires (pp. 1118–1119). |
| Participants | 85 older (60–85, mean 69.8) and 84 younger (18–33, mean 22.6) adults, native German speakers, screened for eye disease and cognitive impairment (p. 1118) |
| Devices | 24-inch Apple iMac TFT, 1920 × 1200, white 350 cd/m², black 1 cd/m², dark room, 10-point Helvetica (pp. 1118–1119) |

Effect sizes were large for acuity (d = 2.17 younger, 0.58 older) and small for
proofreading (η² = 0.06) (pp. 1119–1120). The conclusion in the abstract: "The
presentation in positive polarity is recommended for all ages." (p. 1116)

**Principles.**

- **VP8. Dark text on light reads better, most of all for small text and fine
  detail, at any age** [Piepenbrock 2013; Piepenbrock 2014].

### 1.6 Gazit et al. (2025): light and dark mode and cognitive performance

**Reference.** Tali Gazit, Tair Tager-Shafrir, Hua-Xu Zhong, Patrick C. K. Hung,
and Vien Cheung. 2026. The dark side of the interface: examining the influence
of different background modes on cognitive performance. *Ergonomics* 69, 5
(2026), 828–841. https://doi.org/10.1080/00140139.2025.2483451 (published online
25 March 2025)

**About the file.** The PDF is the online-first version, paginated 1–14. That
maps to 828–841 in the print issue, which Crossref lists for May 2026. Pages
below are print pages.

**Summary.** The authors asked whether dark mode changes how well people solve
visual reasoning problems. In an online survey, each person answered 16
non-verbal test items, half on a light background and half on a dark one, with
counterbalanced versions. Scores were higher in light mode, a small effect.
Younger adults outscored older ones in both modes. Preferences were mixed: 42%
preferred light, 29% dark and 24% both. Preference did not predict who did
better in which mode. Women more often preferred light mode.

**Study details.**

| | |
| --- | --- |
| Year | Online 2025, print 2026 (Ergonomics) |
| Method | Online survey, within-subjects (8 light, 8 dark items), two counterbalanced versions; hierarchical regression and repeated-measures ANOVA (pp. 832–834) |
| Participants | 173 completers of 199 (93 female, 79 male, 1 non-binary), mostly aged 18–25 (51%), from Israel (44%), China (23%) and elsewhere; snowball sampling from students, summer 2023 (pp. 831–832) |
| Devices | Participants' own phones and computers. Device type did not predict scores (p. 832). Screen brightness, ambient light and the exact colours are not reported. |

Light versus dark gave F(1,172) = 9.61, p = .002, ηp² = .05 (p. 833). The
summary: "Participants scored higher when questions were presented in light
mode, irrespective of age or gender." (p. 835)

**Principles.**

- **VP9. Light mode is the safer default for reading and reasoning, but let
  people choose.** The advantage is small, and preference does not predict
  performance, so a person's choice should be respected [Gazit 2025].

### 1.7 Epstein et al. (2020): mapping the personal informatics literature

**Reference.** Daniel A. Epstein, Clara Caldeira, Mayara Costa Figueiredo, Xi Lu,
Lucas M. Silva, Lucretia Williams, Jong Ho Lee, Qingyang Li, Simran Ahuja, Qiuer
Chen, Payam Dowlatyari, Craig Hilby, Sazeda Sultana, Elizabeth V. Eikey, and
Yunan Chen. 2020. Mapping and Taking Stock of the Personal Informatics
Literature. *Proceedings of the ACM on Interactive, Mobile, Wearable and
Ubiquitous Technologies* 4, 4, Article 126 (December 2020), 38 pages.
https://doi.org/10.1145/3432231

**Summary.** Ten years after Li et al.'s stage model, the authors mapped 523
papers on self-tracking. The field has concentrated on health and wellbeing.
Physical activity alone was the case in over a third of papers. Most work
studies collecting data and reflecting on it. Integration and action get less
attention, and preparation (deciding what and how to track) the least. Lapsing
and abandonment come up in under a tenth of papers. Few papers offer ways to
protect tracked data from people looking over one's shoulder. The authors call
for work on the neglected stages, more involvement of domain experts, and more
attention to privacy and ethics.

**Study details.**

| | |
| --- | --- |
| Year | 2020 (IMWUT, Article 126) |
| Method | Mapping review: keyword and citation searches in the ACM Digital Library, IEEE Xplore and PubMed in January 2020, covering publications to 2019. 1,017 candidates screened to 523, then coded by several researchers, with Krippendorff's α reported (126:6–126:8). |
| Participants | None. The unit is the publication: 283 ACM, 59 IEEE, 128 PubMed, 53 in more than one (126:7). |

Stage coverage was collection 16%, reflection 23%, both 34%, action 29%,
integration 32% and preparation 11% (126:10). Everyday challenges included
abandonment or lapsing in 9% of papers (126:11). The authors' explanation for
the skew: "Barriers to collection and reflection are natural HCI problems, as
entry and display of information are central to many interfaces." (126:18)

**Principles.**

- **VP10. Design past collection and reflection**, for preparation (choosing what
  to track) and action (what to do next) [Epstein 2020].
- **VP11. Protect data from onlookers**, which the field rarely addresses
  [Epstein 2020].

### 1.8 Attig and Franke (2020): why people stop using activity trackers

**Reference.** Christiane Attig and Thomas Franke. 2020. Abandonment of personal
quantification: A review and empirical study investigating reasons for wearable
activity tracking attrition. *Computers in Human Behavior* 102 (January 2020),
223–237. https://doi.org/10.1016/j.chb.2019.08.025

**Summary.** The authors first reviewed the literature on why people abandon
fitness trackers, then surveyed former users with a questionnaire built from it.
The most common reason was simply losing interest in tracking. Next came
disrupted routines and changed priorities or life circumstances. Reasons tied to
the device itself, such as inaccuracy, discomfort and usability, ranked lower.
About a third said obsessive tracking played a part, and about a third had
stopped because the activity had become a habit ("happy abandonment"). About a
quarter mentioned privacy. Losing motivation went with worse attitudes towards
tracking and more permanent decisions to stop. The authors derive six design
guidelines. Among them are tailored interpretations instead of bare numbers, and
more control over data sharing.

**Study details.**

| | |
| --- | --- |
| Year | 2020 (Computers in Human Behavior), online September 2019 |
| Method | Systematic literature review, then an online questionnaire (LimeSurvey, September–November 2018) with 6-point agreement scales, factor analysis and correlations. Cross-sectional, so no causal claims (pp. 224–229, 232). |
| Participants | 159 German-speaking former wearable users (of 167), 74% female, mean age 32.4 (18–80), recruited through social media and a press release; 96% wore the tracker on the wrist and 44% used a Fitbit (pp. 227–229) |
| Devices | Former wrist-worn and clip-on trackers and smartphone apps |

25% had had usage gaps longer than a month before they stopped (p. 229). On
ranking: "The most agreed upon reason for abandonment was decreasing intrinsic
tracking motivation." (p. 228)

**Principles.**

- **VP12. Treat stopping as normal, and sometimes as success.** Life
  disruptions and finished goals explain much of it [Attig 2020].
- **VP13. Interpret, don't just count.** Give tailored meaning instead of raw
  numbers, and never frame feedback as failure [Attig 2020, DG2].
- **VP14. Give people authority over their data** [Attig 2020, DG6].

## 2. How the evidence fits together

The user asked for explicit agreement, replication and contradiction, and for the
newer, stronger evidence to win where they differ.

| Topic | Older evidence | Newer evidence | Relation | What we follow |
| --- | --- | --- | --- | --- |
| Ranking of encodings | Cleveland and McGill (1984), via Heer 2010 | Heer 2010 | **Replicates** with crowdsourcing, with more noise and the same ranking | Position first (VP5) |
| Gridline darkness | Stone and Bartram (2008), via Heer 2010 | Heer 2010 | **Replicates.** Crowd alpha values were somewhat higher, and the 0.2 "safe default" stands. | VP6 |
| Colour difference thresholds | CIELAB "ΔE ≈ 1 is noticeable" (large patches, lab) | Szafir 2018 | **Contradicts** for charts: real thresholds are about 3× larger and depend on mark size. Szafir also **replicates** earlier size effects. | Szafir. Validate at mark size (VP3). |
| Complexity and appeal | Berlyne's inverted U | Reinecke 2013 | **Partly contradicts:** low and medium complexity are liked about equally, and high complexity costs most. Reinecke cites a *different* 2012 Tuch et al. paper on visual complexity that found the same. | VP1 |
| Aesthetics and usability | Tractinsky et al. (2000), "what is beautiful is usable"; Consolvo 2009 P16 (Aesthetic) | Tuch 2012 | **Contradicts** the beauty → usability direction under a strong usability manipulation, and shows usability → beauty. It does not contradict P16: people still want an attractive tool, but looks don't excuse friction. | Tuch for priorities (VP7). Keep P16 as a goal. |
| Polarity and age | Westheimer et al. (2003): older adults read negative polarity better | Piepenbrock 2013 | **Contradicts** Westheimer, whose ceiling and order effects the authors point out. **Replicates** the positive-polarity advantage for younger adults (Buchner and Baumgartner 2007). | Piepenbrock (VP8) |
| Light vs dark mode | Piepenbrock 2013/2014 (lab, controlled luminance) | Gazit 2025 (online, uncontrolled) | **Agrees** in direction with a different task. Gazit is newer but **weaker**: no control of brightness, colours or ambient light, a convenience sample and a small effect. | Both, with Piepenbrock as the stronger. Neither tested reading in the dark, where dark mode is most used. |
| Where tracking breaks down | Li 2010: collection barriers (tool, forgetting, time) | Epstein 2020; Attig 2020 | Epstein 2020 **agrees** the field still centres on collection and reflection. Attig 2020 **updates** Li for automatic tracking: once collection is automatic, motivation and life disruptions dominate and device problems rank lower. **Interpretation:** we log by hand, so Li's collection barriers still apply to us, *and* Attig's motivation barriers apply on top. | Both (P1 and VP12) |
| Lapses | Epstein 2015: four lapse types, resuming as a phase | Attig 2020; Epstein 2020 | Attig **confirms** with ranked reasons: disrupted routines and changed circumstances are among the top three, and 25% had gaps over a month before stopping. It **adds** "happy abandonment" (the goal is reached). Epstein 2020 shows the topic is still rare (9% of papers). | P6 and VP12 |
| Punishing feedback | Consolvo 2009 P17 | Attig 2020 | **Agrees:** "feedback about failure is demotivating" is a listed abandonment reason (p. 225), and motivation loss goes with permanent quitting. | P17, VP13 |
| Reminders | Consolvo 2009 P14: unobtrusive | Attig 2020, DG1 | **Tension.** Attig recommends meaningful reminders to prevent lapses. That rests on cited work and correlations, not a test of reminders. | Keep P14 (no nagging). A reminder, if ever added, must be opt-in and say *why*, as DG1 suggests. |
| Privacy from onlookers | Consolvo 2009 P15 | Epstein 2020; Attig 2020 | **Agrees and strengthens:** Epstein finds few solutions in the field, and a quarter of Attig's former users cite privacy. | VP11, VP14. Supports N7 discreet mode. |

## 3. Limits against the guidelines

**General caveats** (interpretation):

- Five of the eight papers are crowdsourced or online, so screens, brightness and
  lighting were uncontrolled. That raises ecological validity but adds noise.
- None tested an app like ours on a phone at 375 px. Reinecke and Tuch tested
  websites on desktops; Heer and Szafir tested desktop browsers.
- Samples skew young, educated, Western or US. Attig is German-speaking and 74%
  female; Gazit is mostly Israeli and Chinese students.
- None of the papers studied runners or climbers.

| # | Evidence | Strength | WCAG 2.2 | Apple HIG | Material 3 |
| --- | --- | --- | --- | --- | --- |
| VP1 | Complexity explains far more of first-impression appeal than colourfulness | Moderate: large online sample, 48% of variance explained, but websites at 500 ms, not an app used daily | Not addressed | Not addressed directly | Not addressed directly |
| VP2 | Age × complexity and education × colourfulness interactions | Weak to moderate: the authors call the demographic effects small and in need of larger samples (p. 2057) | Not addressed | Agrees in spirit: "Consider allowing people to customize color schemes such as chart colors or game characters so they can personalize your interface in a way that's comfortable for them." [Apple HIG Accessibility] | Not addressed |
| VP3 | Thresholds grow as marks shrink; 2 px lines need ≈ 15 CIELAB ΔE on lightness | Strong for its question: 432 analysed participants and well-fitting models (R² > 0.87 for every line model). Limited to simple charts with grey distractors. | **1.4.11 Non-text Contrast** needs 3:1 for graphical objects required to understand content, against *adjacent* colours. It says nothing about series-to-series difference, which is Szafir's question. | "Convey information with more than color alone." [Apple HIG Accessibility] | Not addressed for charts |
| VP4 | Lightness differences were detected more often than a\* or b\* differences | Moderate (same studies) | Not addressed | Not addressed | Not addressed |
| VP5 | Ranking replicated | Strong: replicates a classic lab result | 1.4.1 Use of Color: position doesn't rely on colour | Not addressed | Not addressed |
| VP6 | Alpha 0.2 gridlines; 8 px spacing; 80 px height | Moderate: crowdsourced, 2010 displays | Gridlines are decorative, so 1.4.11 doesn't require 3:1 for them | Not addressed | Not addressed |
| VP7 | Usability lowers post-use aesthetics; aesthetics don't raise perceived usability | Moderate: lab, n = 80, one product and a strong usability manipulation (the authors' own limit, p. 1605) | Not addressed | Not addressed | Not addressed |
| VP8 | Positive polarity better for acuity and proofreading at all ages | Strong: controlled lab, n = 169, between-subjects, measured luminance. Limit: a dark room and a desktop monitor, not a phone outdoors or in bed. | **1.4.3 Contrast (Minimum)** is polarity-neutral: 4.5:1 counts the same either way. | Asks for both appearances to work: "make sure the contrast ratio between colors is no lower than 4.5:1. For custom foreground and background colors, strive for a contrast ratio of 7:1, especially in small text." [Apple HIG Dark Mode] | Supports both themes via tonal colour roles [Android M3] |
| VP9 | Light mode slightly better for reasoning items; preference not predictive | Weak to moderate: newer, but uncontrolled and a small effect | Polarity-neutral (1.4.3) | **Disagrees with our theme switch:** "Avoid offering an app-specific appearance setting." [Apple HIG Dark Mode] | Follows the system setting in its examples (`isSystemInDarkTheme()`) [Android M3] |
| VP10 | Stage coverage counts | Moderate: a map of research, not of user outcomes | Not addressed | Not addressed | Not addressed |
| VP11 | Few onlooker-privacy solutions | Moderate | Not addressed | Not addressed | Not addressed |
| VP12 | Ranked abandonment reasons; 25% had long gaps | Moderate: n = 159, retrospective self-report, cross-sectional, some low-reliability scales (p. 232) | Not addressed | Not addressed | Not addressed |
| VP13 | Demotivation through negative feedback; DG2 tailored interpretation | Weak to moderate: a design guideline derived from correlations and cited work | Not addressed | Not addressed | Not addressed |
| VP14 | A quarter cite privacy | Moderate | Not addressed | Not addressed | Not addressed |

**Guideline notes** (findings):

- **WCAG 1.4.3** requires 4.5:1 for normal text and 3:1 for large text, with no
  preference between light and dark. **WCAG 1.4.11** requires 3:1 for "visual
  information required to identify user interface components and states" and
  for graphical objects needed to understand content. A text field whose only
  edge is a border needs that border at 3:1 against what is next to it.
- **Apple HIG** (Accessibility) uses WCAG AA values in Accessibility Inspector:
  4.5:1 up to 17 pt, 3:1 at 18 pt or bold. It adds: "If your app doesn't provide
  this minimum contrast by default, ensure it at least provides a higher
  contrast color scheme when the system setting Increase Contrast is turned on."
  The Dark Mode page describes dimmer *base* and brighter *elevated* backgrounds,
  and aims at 7:1 for small text in custom colours (quoted above).
- **Material 3:** the m3.material.io pages did not render for this review, so its
  own wording is not verified here. Android's Material 3 page says that
  "Material's color system provides standard tone values and measurements that
  can be used to meet accessible contrast ratios", and that elevation in dark
  themes uses tonal colour overlays [Android M3]. Its type scale puts
  `bodySmall` at 12/16 and `labelSmall` at 11/16, so our 12 px captions sit
  inside Material's range.

## 4. Audit

Read from the code at the current `main`. Measured values are in the
[palette sheet](design-mockups/palette-sheet.html).

### 4.1 Colour

| Check | Follows | Breaks or at risk |
| --- | --- | --- |
| Text contrast (1.4.3) | Every text token passes in both themes. Ink 14.7–17.7:1 light, 13.3–16.2:1 dark. Muted 5.23–6.29:1 light, 6.04–7.33:1 dark. Accent, climb and danger 4.53–6.57:1 light. | `--climb` on `--climb-soft` is 4.53:1, right at the floor. Muted text is below Apple's 7:1 aim for small text in custom colours (VP8). |
| Control edges (1.4.11) | `--grade-ring` 3.98:1 light, 3.73:1 dark. Focus ring is the accent (6.41:1, 9.19:1). | **`--line` is 1.45:1 on surface and 1.32:1 on canvas in light, and 1.37 / 1.49:1 in dark.** It is the only visible edge of the chat composer, Log form fields, the weekly note, quick-reply chips and outlined buttons (Edit, Delete, Skip) (`frontend/app/chat.tsx`, `frontend/components/session-form.tsx`, `frontend/app/sessions/session-sheet.tsx`). Surface on canvas is about 1.1:1, so the fill doesn't help. This fails 1.4.11. |
| Hue count and calm (VP1) | One accent, two sport colours and the grade colours, with the default Tailwind palette switched off (`globals.css`). This matches Reinecke's finding that colourfulness matters little and calm is safe. | – |
| Colour never alone (1.4.1) | Grades always carry their name; trend words are words; outcomes use icons (`frontend/components/grade.tsx`) | – |
| Grade colours as a set | Every dot has a ring, so white and black holds stay visible | blue↔purple is ΔE 11.9 for normal vision (below 15) and 3.0 under deuteranopia. green↔red is 4.7 under deuteranopia. Names prevent errors, but at a glance in the grade chart the dots blur together (VP3: dots are small marks). |

### 4.2 Typography

| Check | Follows | Breaks or at risk |
| --- | --- | --- |
| Body size | 16 px body and inputs (stops iOS zoom); a clear scale of 12/14/16/18/22/28 | – |
| Small text (VP8) | 12 px is inside Material's scale (`bodySmall` 12/16) and above Apple's 11 pt minimum | Much information sits at 12 px in the muted colour: dates on rows, weekly totals, pace trend lines and "Rough guide" (`frontend/app/sessions/sessions-view.tsx`, `frontend/app/dashboard/dashboard-view.tsx`). Week headings are 12 px uppercase with tracking. That is the condition (small characters, lower contrast) where Piepenbrock found the largest polarity cost, and in dark mode the app is negative polarity. |
| Numbers | `tabular-nums` throughout, Space Grotesk for display numbers | – |

### 4.3 Dark mode

| Check | Follows | Breaks or at risk |
| --- | --- | --- |
| Default | System by default (`frontend/lib/theme.ts`), so the OS decides. Neither paper argues against honouring a choice (VP9). | We also offer an app-specific Light/Dark switch (PR #13), which Apple's HIG advises against. **Interpretation:** for a web app that may run in a browser whose setting differs from what the person wants at the gym, keeping the switch is defensible, and it defaults to System. This is a deliberate deviation, not an oversight. |
| Surfaces | No pure black (`#0E1214`), no pure white text (`#ECEEEC`) | Sheets, dialogs and the fixed composer use the same `--surface` as the cards beneath them. The sheet separates only by shadow, which is weak on dark. Apple's base/elevated model and Material's tonal elevation both make the top layer lighter. |
| Polarity cost | – | No measure against the extra legibility cost of small light-on-dark text (see 4.2) |

### 4.4 Charts

| Check | Follows | Breaks or at risk |
| --- | --- | --- |
| Encodings (VP5) | Load uses stacked columns on a common baseline. Pace and grades use position on a common scale. No pies or areas (`frontend/app/dashboard/charts.tsx`). | Stacked segments compare only the bottom series on a common baseline. That is fine for a total-first chart; climbing-only load would need the filter in #46. |
| Sport colours (VP3, VP4) | Pass every validator check in both modes: CVD ΔE 11.5 light / 11.0 dark, normal 19.5 / 20.1, 3:1 on surface. Drawn as 20 px bars (elongated) with a legend and a table. | Tooltip keys are 14 × 4 px lines (`LineKey`), the size where Szafir's thresholds are highest. The series name is printed next to them, so this is minor. |
| Gridlines (VP6) | Solid hairlines in `--line`: 1.45:1 on white, close to the 0.2-alpha "safe default" (about 1.61:1 on white). Pace chart has 3 ticks; load chart has the default ticks. | – |
| Chart sizes (VP6) | 224 px (load, grades) and 128 px (pace), all above 80 px | – |
| A third sport | – | No colour is reserved. Grades already take yellow, green, blue, purple and red, so the free hue space is small (see V-M2). |
| Complexity on mobile (VP1) | Each chart has a title, legend and table | At 375 px the Dashboard is six stacked cards with five charts. The first screen shows one chart and part of another, and no summary. |

## 5. Proposals

Ranked by effort. **S** is a few hours, **M** a day or two, **L** a
milestone-sized piece. No UI code is changed in this PR; each proposal has an
issue in the project (Phase: Design), listed in the last column.

| # | Change | Principles and guidelines | Effort | Mockup | Issue |
| --- | --- | --- | --- | --- | --- |
| V-S1 | **Control outlines at 3:1.** Add `--control` (`#8A857A` light, `#6B767C` dark) for the borders of fields, chips and outlined buttons; keep `--line` for decorative hairlines. Measured 3.67 / 3.34:1 light and 3.73 / 4.04:1 dark on surface / canvas. | WCAG 1.4.11 | S | [13](design-mockups/13-control-outlines.html) | #53 |
| V-S2 | **Muted text to 7:1.** `--ink-muted` `#474E53` light (8.46 / 7.68 / 7.03:1) and `#B0B8BC` dark (8.27 / 9.04 / 7.25:1 on the V-M1 surfaces). | VP8; Apple HIG 7:1 for small text | S | [15](design-mockups/15-small-text.html) | #54 |
| V-S3 | **Grade colours re-stepped for the screen.** green `#3FAE5F`, red `#C0302F`, purple `#9440B8`. green↔red rises from 4.7 to 12.3 under deuteranopia; blue↔purple rises from 11.9 to 16.8 for normal vision but stays at 5.3 under CVD, so names remain essential. Check with the gym that the holds still read right. | VP3; 1.4.1; Apple: "red-green and blue-orange" | S | [14](design-mockups/14-grade-colours.html) | #55 |
| V-S4 | **A 13 px "meta" step** for captions that carry information (dates, weekly totals, trend lines), and sentence-case week headings. Chart ticks stay at 12 px. | VP8 (small characters) | S | [15](design-mockups/15-small-text.html) | #56 |
| V-M1 | **Dark surfaces and elevation.** Canvas `#121618`, surface `#191F22`, a new `--elevated` `#222A2E` for sheets, dialogs and the composer, ink `#E8EBE9`. Ink stays 12.2–15.2:1. M because both dark token blocks, the theme test and three components change, and every dark screen needs a visual pass. | VP8, VP9; Apple base/elevated; Material tonal elevation | M | [16](design-mockups/16-dark-surfaces.html) | #57 |
| V-M2 | **A validated third sport colour.** Strength `#4A5BB5` light / `#7083E0` dark. With running and climbing, all pairs pass in both modes (CVD worst 11.5 / 11.0, normal worst 18.9 / 19.6). Fixed order: running, climbing, strength. It is ΔE 6.9 from grade blue, which is acceptable only while sports and grades never share a chart. Otherwise use the 45° texture. Lands with "Other training" (#27) and the Dashboard filter (#46). | VP3, VP4; dataviz checks | M | [17](design-mockups/17-three-sport-load.html) | #58 |
| V-M3 | **Summary-first Dashboard on mobile.** The filter (#46), three headline numbers, one sentence from the backend's numbers, then each chart as an expandable row with its trend chip. From 768 px the grid stays. | VP1, VP2, VP13; P13 [Consolvo 2009] | M | [18](design-mockups/18-dashboard-summary-first.html) | #59 |
| V-M4 | **Higher contrast when asked.** Under `prefers-contrast: more`, outlines and dividers use `#5A6166` light / `#9AA3A7` dark (5.72–7.33:1) and secondary text uses ink. | Apple HIG Increase Contrast; WCAG 1.4.11 | M | [palette sheet](design-mockups/palette-sheet.html) | #60 |
| V-L1 | **Personal chart colours.** An Account setting for an alternative chart palette (for example a CVD-optimised or high-lightness-contrast set) and denser or calmer Dashboard layouts, both validated with the same checks. | VP2; Apple: "Consider allowing people to customize color schemes such as chart colors" | L | – | #61 |

**Not proposed:**

- Switching the default to dark, or forcing light. The evidence favours light for
  reading, but the app already follows the OS, and preference didn't predict
  performance (VP9).
- Changing gridlines or chart heights. They already match VP6.

**Recommendation.**

- **Now:** V-S1, because it is a WCAG AA failure.
- **Next:** V-S2 and V-S4 together, since both are about small text, then V-S3
  after a quick check with the gym.
- **With the Dashboard filter (#46):** V-M3. With "Other training" (#27) or custom
  log forms (#44): V-M2.
- **Later:** V-M1, V-M4, then V-L1.
- **First, in any case:** keep fixing friction before polish. Tuch shows that
  poor usability lowers how good the app looks, and not the reverse (VP7).

## 6. References

Apple Inc. 2026. Accessibility. *Human Interface Guidelines*. Retrieved November
14, 2026 from https://developer.apple.com/design/human-interface-guidelines/accessibility
[Apple HIG Accessibility]

Apple Inc. 2026. Dark Mode. *Human Interface Guidelines*. Retrieved November 14,
2026 from https://developer.apple.com/design/human-interface-guidelines/dark-mode
[Apple HIG Dark Mode]

Christiane Attig and Thomas Franke. 2020. Abandonment of personal
quantification: A review and empirical study investigating reasons for wearable
activity tracking attrition. *Computers in Human Behavior* 102 (2020), 223–237.
https://doi.org/10.1016/j.chb.2019.08.025 [Attig 2020]

Daniel A. Epstein, Clara Caldeira, Mayara Costa Figueiredo, Xi Lu, Lucas M.
Silva, Lucretia Williams, Jong Ho Lee, Qingyang Li, Simran Ahuja, Qiuer Chen,
Payam Dowlatyari, Craig Hilby, Sazeda Sultana, Elizabeth V. Eikey, and Yunan
Chen. 2020. Mapping and Taking Stock of the Personal Informatics Literature.
*Proc. ACM Interact. Mob. Wearable Ubiquitous Technol.* 4, 4, Article 126
(December 2020), 38 pages. https://doi.org/10.1145/3432231 [Epstein 2020]

Tali Gazit, Tair Tager-Shafrir, Hua-Xu Zhong, Patrick C. K. Hung, and Vien
Cheung. 2026. The dark side of the interface: examining the influence of
different background modes on cognitive performance. *Ergonomics* 69, 5 (2026),
828–841. https://doi.org/10.1080/00140139.2025.2483451 (published online
25 March 2025) [Gazit 2025]

Google. 2026. Material Design 3 in Compose. *Android Developers*. Retrieved
November 14, 2026 from
https://developer.android.com/develop/ui/compose/designsystems/material3
[Android M3]

Jeffrey Heer and Michael Bostock. 2010. Crowdsourcing Graphical Perception:
Using Mechanical Turk to Assess Visualization Design. In *Proceedings of the
SIGCHI Conference on Human Factors in Computing Systems (CHI '10)*. ACM, New
York, NY, USA, 203–212. https://doi.org/10.1145/1753326.1753357 [Heer 2010]

Cosima Piepenbrock. 2014. *Ergonomische Gestaltung digitaler Anzeigen für jüngere
und ältere Erwachsene – Optimierung der Lesbarkeit durch eine positiv polare
Textdarstellung*. Doctoral dissertation. Heinrich-Heine-Universität Düsseldorf,
Düsseldorf, Germany. [Piepenbrock 2014]

Cosima Piepenbrock, Susanne Mayr, and Axel Buchner. 2014. Positive display
polarity is particularly advantageous for small character sizes: Implications
for display design. *Human Factors* (published online 2013).
https://doi.org/10.1177/0018720813515509

Cosima Piepenbrock, Susanne Mayr, Iris Mund, and Axel Buchner. 2013. Positive
display polarity is advantageous for both younger and older adults.
*Ergonomics* 56, 7 (2013), 1116–1124.
https://doi.org/10.1080/00140139.2013.790485 [Piepenbrock 2013]

Katharina Reinecke, Tom Yeh, Luke Miratrix, Rahmatri Mardiko, Yuechen Zhao,
Jenny Liu, and Krzysztof Z. Gajos. 2013. Predicting Users' First Impressions of
Website Aesthetics with a Quantification of Perceived Visual Complexity and
Colorfulness. In *Proceedings of the SIGCHI Conference on Human Factors in
Computing Systems (CHI '13)*. ACM, New York, NY, USA, 2049–2058.
https://doi.org/10.1145/2470654.2481281 [Reinecke 2013]

Danielle Albers Szafir. 2018. Modeling Color Difference for Visualization
Design. *IEEE Transactions on Visualization and Computer Graphics* 24, 1 (2018),
392–401. https://doi.org/10.1109/TVCG.2017.2744359 [Szafir 2018]

Alexandre N. Tuch, Sandra P. Roth, Kasper Hornbæk, Klaus Opwis, and Javier A.
Bargas-Avila. 2012. Is beautiful really usable? Toward understanding the
relation between usability, aesthetics, and affect in HCI. *Computers in Human
Behavior* 28, 5 (2012), 1596–1607. https://doi.org/10.1016/j.chb.2012.03.024
[Tuch 2012]

W3C. 2024. Web Content Accessibility Guidelines (WCAG) 2.2. W3C Recommendation,
12 December 2024. https://www.w3.org/TR/WCAG22/ [WCAG 2.2]
