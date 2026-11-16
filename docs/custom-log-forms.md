# Custom log forms: design

Design for the milestone **Custom log forms**: log forms the user shapes per sport or session type (#44), and climbing grade systems with the user's own gyms (#85). This is design only; nothing here is built yet.

The work is split into five issues, in order:

| # | Issue | Area | Size | Priority |
|---|-------|------|------|----------|
| 1 | [#98 Store climbs in their own grade system with a common difficulty index](https://github.com/JesperBarosen/treningsagent/issues/98) | backend, database | L | P1 |
| 2 | [#99 Pick a gym and grade system when logging, and edit gyms](https://github.com/JesperBarosen/treningsagent/issues/99) | frontend | M | P2 |
| 3 | [#100 Session templates with typed fields in the database and API](https://github.com/JesperBarosen/treningsagent/issues/100) | backend, database | L | P1 |
| 4 | [#101 Template editor and a Log form that follows the template](https://github.com/JesperBarosen/treningsagent/issues/101) | frontend | L | P2 |
| 5 | [#102 Let the coach log and draft templated sessions](https://github.com/JesperBarosen/treningsagent/issues/102) | agent, evals | M | P2 |

#98 and #99 are sub-issues of #85; #100, #101 and #102 are sub-issues of #44. Gyms come first because they change an existing table (`climbs`) that templates then build on, and they are useful on their own.

Mockups (375 px phone, light and dark side by side; where this doc lists alternatives, the mockup shows variant A and B):

1. [Template list and "New template"](design-mockups/custom-forms/01-template-list.html)
2. [Template editor, adding a field of each type](design-mockups/custom-forms/02-template-editor.html)
3. [Log form with the Fingerboard template](design-mockups/custom-forms/03-log-with-template.html)
4. [Bouldering log with gym picker and the gym's colours](design-mockups/custom-forms/04-bouldering-gym-picker.html)
5. [Gym editor: ordered colours with approximate V/Font range](design-mockups/custom-forms/05-gym-editor.html)
6. [Chat draft card for a templated session](design-mockups/custom-forms/06-chat-draft-card.html)

---

## 1. Goals and non-goals

**Goals**

- Log any kind of training (fingerboard, strength, mobility, intervals) with the fields that matter for it, and still have it count in weekly load.
- Log climbs in the grade system they were climbed in: a gym's own colours, V-scale or Font.
- Compare climbing progress across gyms and systems with one common difficulty index.
- The coach knows the user's templates and gyms and fills them in from a chat message, as a draft the user confirms.
- Existing sessions, climbs, goals and charts keep working without the user doing anything.

**Non-goals for this milestone**

- Charts of custom fields (for example "added kg over time"). Values are stored so this can come later.
- Sharing templates or gyms between users, or a public gym directory.
- Changing how load is computed (it stays duration × RPE, see section 8).
- Formulas or computed fields inside a template.

## 2. User stories

**Templates**

1. As someone who trains on a fingerboard, I want a "Fingerboard" form with sets × seconds × edge (mm) × added kg, so I log a session in under a minute without writing it in notes.
2. As someone who lifts, I want a "Strength" form with exercises as sets × reps × kg, so my gym sessions count in weekly load next to running and climbing.
3. As a runner, I want an "Intervals" form under Running with distance, rep count and a select for the workout type, so interval sessions are easy to find later.
4. As a user, I want to pick the template when I log, and the app to remember the last one per sport, so the common case is one tap.
5. As a user, I want to rename a field, add an option or hide a field I no longer use without losing what I logged before.
6. As a user, I want my templated sessions to show their values in Sessions and the session sheet, and to edit them in the same form.

**Gyms and grades**

7. As a boulderer who climbs at two gyms, I want each gym's own colour circuit, so I log the colours I see on the wall.
8. As a climber, I want to give each colour an approximate V or Font range, so a blue at one gym and a green at another are compared fairly.
9. As someone who also climbs outdoors or on the Kilter board, I want to log V or Font grades directly.
10. As a climber, I want the app to remember the gym I logged at last.
11. As a climber with a goal ("send a red by March"), I want the goal to keep working after I add a second gym.

**Coach**

12. As a user, I want to tell the coach "fingerboard today: 6 × 10 s on 20 mm with +10 kg, effort 7" and get a draft in my Fingerboard form to save.
13. As a user, I want the coach to say which template it used, and to ask when two templates could fit.
14. As a user, I want the coach to understand my gym's colours when I say "flashed two blues at Klatreverket".

**Privacy**

15. As a user in discreet mode, I want custom numbers and text blurred like the rest of my data.

## 3. Data model

### 3.1 Overview

```
auth.users ─┬─< session_templates (fields jsonb)
            ├─< sessions ── template_id ─> session_templates   (nullable)
            │      └─< climbs ── gym_id ─> gyms
            │                └── gym_grade_id ─> gym_grades
            ├─< gyms ─< gym_grades (ordered colours, approx range)
            └─< goals ── gym_id, gym_grade_id (climb goals)
```

Two principles from the existing schema stay:

- **Only raw, user-reported facts are stored.** Load, pace and the difficulty index are computed when read.
- **Every row has a `user_id` and RLS limits it to its owner.**

### 3.2 Session templates

A template is a named form for one sport. Its fields are a typed schema in `jsonb`.

```sql
create table public.session_templates (
    id           bigint generated always as identity primary key,
    user_id      uuid        not null default auth.uid()
                 references auth.users (id) on delete cascade,
    name         text        not null check (char_length(name) between 1 and 40),
    sport        text        not null check (sport in ('running', 'climbing', 'other')),
    -- Optional built-in fields this template shows (running: distance_km, elevation_m).
    core_fields  text[]      not null default '{}',
    fields       jsonb       not null default '[]'
                 check (jsonb_typeof(fields) = 'array' and jsonb_array_length(fields) <= 20),
    position     smallint    not null default 0,   -- order in the list
    archived_at  timestamptz,                      -- archived, never deleted once used
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);
create unique index session_templates_user_name_idx
    on public.session_templates (user_id, lower(name)) where archived_at is null;
```

**Core fields are not in the schema.** Every session, templated or not, has date, duration, effort (RPE), notes and tags as today. They feed load and the weekly review, so a template can't remove or rename them. A template only adds fields after them, and for running it chooses whether distance and elevation show.

**Run and Climb stay built-in.** A session without a template (`template_id` null) uses today's Run or Climb form. That is how every existing session keeps working. Whether the built-in forms appear in the template list is alternative **T1** below.

#### Field schema

Each entry in `fields`:

| Property | Type | Rules |
|----------|------|-------|
| `key` | string | `^[a-z][a-z0-9_]{0,31}$`, unique in the template, **never changes** (made from the first label) |
| `label` | string | 1–40 characters, can be renamed |
| `type` | string | one of the types below, **never changes** |
| `required` | boolean | default false |
| `help` | string | optional, up to 80 characters, shown under the field |
| `archived` | boolean | default false; hidden from new logs, old values still shown |

Types and their extra properties:

| Type | Extra properties | Value in `custom_values` |
|------|------------------|--------------------------|
| `number` | `unit` (up to 8 characters; suggestions: kg, lb, mm, s, min, m, km, reps, %), `min`, `max`, `decimals` (0–2) | number |
| `select` | `options`: 2–12 of `{value, label, archived?}`; `multiple` (boolean) | option value, or an array of them when `multiple` |
| `boolean` | none | `true` or `false` |
| `text` | `max_length` (up to 500, default 200) | string |
| `sets` | `reps_unit` (`reps` or `s`), `load_unit` (`kg`, `lb` or none), `load_signed` (allow negative load for assisted hangs or pull-ups), `extras`: up to 2 number columns `{key, label, unit, min, max, decimals}` | array of up to 30 rows `{sets, reps, load?, <extra keys>}` |
| `climbs` | `default_style` (`boulder`, `kilter`, `rope`); climbing templates only, at most one per template | not in `custom_values`: stored in `climbs` like today |

A `sets` row is a **group of identical sets**: `{sets: 6, reps: 10, load: 10, edge_mm: 20}` reads "6 × 10 s on 20 mm, +10 kg". Whether the form enters groups or one row per set is alternative **T3**.

Example: the Fingerboard template.

```json
[
  {"key": "protocol", "label": "Protocol", "type": "select",
   "options": [{"value": "max_hangs", "label": "Max hangs"},
               {"value": "repeaters", "label": "Repeaters"},
               {"value": "density", "label": "Density hangs"}]},
  {"key": "grip", "label": "Grip", "type": "select", "multiple": true,
   "options": [{"value": "half_crimp", "label": "Half crimp"},
               {"value": "open_hand", "label": "Open hand"},
               {"value": "full_crimp", "label": "Full crimp"}]},
  {"key": "hangs", "label": "Hangs", "type": "sets", "required": true,
   "reps_unit": "s", "load_unit": "kg", "load_signed": true,
   "extras": [{"key": "edge_mm", "label": "Edge", "unit": "mm", "min": 4, "max": 60}]},
  {"key": "finger_pain", "label": "Any finger pain?", "type": "boolean"}
]
```

#### Changing a template later

Sessions keep pointing at the template, and the template is read when the session is shown. So edits must never change what an old value means:

- `key`, `type`, `unit`, `reps_unit` and `load_unit` can't change. To change them, add a new field and archive the old one.
- Labels, help, `required`, `min`/`max` and option labels can change.
- Options can be added or archived, not removed. Archived options still label old values.
- A field that no session uses can be deleted; a used field is archived.
- A template that no session uses can be deleted; a used template is archived.

This is alternative **D1 A** (archive, never rewrite). Alternative **D1 B** keeps a version number on the template and a full schema snapshot per version, with `sessions.template_version`. B allows any edit, but every reader has to handle several versions, and the coach sees one template under several shapes. **Recommendation: A.** It is simpler and the rules above cover the realistic edits.

### 3.3 Sessions

```sql
alter table public.sessions
    add column template_id   bigint references public.session_templates (id) on delete restrict,
    add column custom_values jsonb  not null default '{}'
        check (jsonb_typeof(custom_values) = 'object'
               and pg_column_size(custom_values) <= 16384);

alter table public.sessions drop constraint sessions_sport_check;
alter table public.sessions add constraint sessions_sport_check
    check (sport in ('running', 'climbing', 'other'));
```

- `template_id` null means the built-in Run or Climb form, as today.
- `custom_values` holds the template's fields by `key`. It is `{}` without a template.
- A templated session's `sport` must equal the template's sport. A check constraint can't see another table, so `forms.py` enforces it (section 4).
- **A third sport, `other`**, for training that isn't running or climbing: strength, fingerboard, mobility, cycling. It counts in weekly load and uses the reserved chart colour `--chart-strength` (#58). This also covers #27 ("Other training"), if you agree (question Q1). A Fingerboard template could be `climbing` or `other`; that is the user's choice, and the sport decides which Dashboard series it counts in.

### 3.4 Gyms and grades

```sql
create table public.gyms (
    id           bigint generated always as identity primary key,
    user_id      uuid        not null default auth.uid()
                 references auth.users (id) on delete cascade,
    name         text        not null check (char_length(name) between 1 and 60),
    -- Which system the ranges below are entered in; display only.
    range_system text        not null default 'v' check (range_system in ('v', 'font')),
    archived_at  timestamptz,
    created_at   timestamptz not null default now()
);

create table public.gym_grades (
    id           bigint generated always as identity primary key,
    user_id      uuid        not null default auth.uid()
                 references auth.users (id) on delete cascade,
    gym_id       bigint      not null references public.gyms (id) on delete cascade,
    position     smallint    not null check (position >= 1),   -- 1 = easiest
    name         text        not null check (char_length(name) between 1 and 24),
    colour       text        not null check (colour ~ '^#[0-9a-f]{6}$'),
    -- Approximate range as difficulty-index values (section 3.5); both null = unknown.
    range_low    numeric(3, 1),
    range_high   numeric(3, 1),
    archived_at  timestamptz,
    unique (id, gym_id),
    constraint gym_grades_range check (
        (range_low is null) = (range_high is null) and (range_low is null or range_low <= range_high))
);
create unique index gym_grades_position_idx
    on public.gym_grades (gym_id, position) where archived_at is null;
```

- **Ordered colours.** `position` is the order on the wall, easiest first. Reordering rewrites positions in one transaction.
- **Colours come from a palette**, not a free colour picker: the seven screen-safe grade colours (#55) plus candidates such as orange, pink and grey, each validated for colour-blind contrast before it ships. The name is free text, so a gym's "teal" can use the green swatch. Every chip keeps its name and ring, as today.
- **The range is stored as index values**, so V and Font ranges compare directly. The editor shows it in the gym's `range_system`.

**Climbs**

```sql
alter table public.climbs
    add column grade_system text   not null default 'gym'
        check (grade_system in ('gym', 'v', 'font')),
    add column gym_id       bigint references public.gyms (id),
    add column gym_grade_id bigint,
    add constraint climbs_gym_grade_fkey
        foreign key (gym_grade_id, gym_id) references public.gym_grades (id, gym_id),
    add constraint climbs_gym_system check (
        (grade_system = 'gym') = (gym_grade_id is not null));

alter table public.climbs drop constraint climbs_grade_check;
alter table public.climbs drop constraint climbs_grade_ordinal_check;
alter table public.climbs alter column grade_ordinal drop not null;
```

- `grade` keeps the grade as the user knows it: the colour name (`blue`), `V4` or `6B+`. The backend checks it against the gym's colours or the V/Font list. Keeping the label on the row keeps reads, the coach's text and a later CSV export (#24) simple.
- `gym_id` is set for gym colours and optional for V/Font (a gym whose Kilter board uses V grades).
- The composite foreign key makes sure the colour belongs to that gym.
- `grade_ordinal` stays for gym colours (the position) during the move, and is dropped once nothing reads it.

### 3.5 One common difficulty index

Every climb gets a **difficulty index**: a number on the V-scale, computed when read, never stored on the climb.

| System | Index |
|--------|-------|
| V-scale | VB = −1, V0 = 0, V1 = 1 … V17 = 17 |
| Font | 4 = 0, 4+ = 0.5, 5 = 1, 5+ = 2, 6A = 3, 6A+ = 3.5, 6B = 4, 6B+ = 4.5, 6C = 5, 6C+ = 5.5, 7A = 6, 7A+ = 7, 7B = 8, 7B+ = 8.5, 7C = 9, 7C+ = 10, 8A = 11, 8A+ = 12, 8B = 13, 8B+ = 14, 8C = 15, 8C+ = 16, 9A = 17 |
| Gym colour | midpoint of the colour's range; e.g. blue "V2–V3" = 2.5. Unknown range: no index |

- The index is internal. **The user never sees a number**: charts label it in the user's main system (their most-used gym, else V) and each point keeps its own grade name.
- Progression (`progression.py`), goals (`goals.py`) and the Dashboard's climbing trends use the index instead of `grade_ordinal`. `nearest_grade` becomes "nearest grade in the display system".
- A colour without a range has no index. Its climbs still show in that gym's own view and count for that gym's goals, but are left out of comparisons across gyms. The gym editor nudges to add a range.
- Kilter and Moon boards use V or Font, so they need no gym.

Alternative **D2**: store the index on each climb when it is logged (B) instead of computing it when read (A). B keeps history fixed if a range is edited later; A follows the project's rule that derived values are computed when read, and lets a corrected range fix old sessions too. **Recommendation: A.** A range is an approximation the user refines; a reset circuit is a new gym (or new colours), not an edited range.

### 3.6 Goals

`climb_grade` goals get `grade_system`, `gym_id` and `gym_grade_id`, and lose the fixed-colour check. "Send a red at My gym" is reached by a send at that gym's red or by any climb whose index is at least red's range low; whether climbs at other gyms count is question Q4. A V or Font goal ("send V5") compares by index across everything.

### 3.7 Validation (server side)

All rules live in one backend module, `forms.py`, called by every write path: the Log form's API, session edits, and the agent's `log_session` and `draft_session`. The database checks only shapes and sizes.

**When a template is saved** (`validate_template`):

- At most 20 fields; keys match the pattern and are unique; types are known; each type's properties are complete and within limits.
- At most one `climbs` field, and only for `climbing`.
- Against the stored version: `key`, `type` and units are unchanged; nothing used is removed, only archived.

**When a session is saved** (`validate_values`):

- The template is the user's own and not archived (an edit of an older session may keep an archived template).
- The session's sport equals the template's.
- Every key in `custom_values` is a field of the template. Unknown keys are refused, never dropped silently.
- Each value has the field's type and is within `min`, `max`, `decimals`, `max_length` and the options. `sets` rows have `sets` 1–20 and `reps` 1–600 and only the declared columns.
- Required fields are present. Archived fields can't get new values, but a session that already has one keeps it on edit.
- Total size up to 16 KB.

Errors name the field by label: "Hangs, row 2: edge must be between 4 and 60 mm". The agent gets the same message as a tool error and can correct itself (section 7).

The frontend repeats the main checks for instant feedback, but the server decides. One shared fixture of valid and invalid examples (`backend/tests/fixtures/forms.json`) runs in both pytest and Vitest, so the two can't drift.

## 4. RLS

New tables follow the existing pattern: RLS on, `to authenticated`, owner only, and column grants that leave `user_id` to its default.

| Table | select | insert | update | delete |
|-------|--------|--------|--------|--------|
| `session_templates` | own | own | own (`name`, `fields`, `core_fields`, `position`, `archived_at`) | own, and the backend allows it only when unused |
| `gyms` | own | own | own (`name`, `range_system`, `archived_at`) | own, only when unused |
| `gym_grades` | own | own, **and the gym is the caller's** | own (`position`, `name`, `colour`, `range_low`, `range_high`, `archived_at`) | own, only when unused |

Foreign key checks bypass RLS, so every reference to another user-owned row also needs an ownership check in the policy (as `climbs` already does for `session_id`):

- `sessions` insert and update: `template_id is null or exists (select 1 from session_templates t where t.id = template_id and t.user_id = (select auth.uid()))`.
- `climbs` insert: as today, plus `gym_id is null or exists (… gyms g where g.id = gym_id and g.user_id = auth.uid())`. The composite key then ties `gym_grade_id` to that gym.
- `goals` insert and update: the same check for `gym_id`.
- `gym_grades` insert: the gym is the caller's.

`on delete restrict` on `sessions.template_id`, `climbs.gym_id` and `climbs.gym_grade_id` means a used template, gym or colour can only be archived. Deleting the user still cascades everything through `user_id`.

Tests (pytest, against the local database as the `authenticated` role): a user can't read another user's templates or gyms, can't log a session with another user's `template_id`, can't log a climb with another user's `gym_id`, and can't add colours to another user's gym.

## 5. Migrations, and how existing data keeps working

Four migrations, all additive except dropping the fixed-colour checks:

| Migration | Issue | What |
|-----------|-------|------|
| `…_create_gyms.sql` | #98 | `gyms`, `gym_grades`, RLS, grants |
| `…_climb_grade_systems.sql` | #98 | new `climbs` and `goals` columns, backfill, drop colour checks, new policies |
| `…_create_session_templates.sql` | #100 | `session_templates`, RLS, grants |
| `…_session_templates_on_sessions.sql` | #100 | `sessions.template_id`, `custom_values`, sport `other`, new policies and grants |

**Backfill in `…_climb_grade_systems.sql`**, in one transaction:

1. For each user with climbs or climb goals, insert a gym "My gym" with today's seven colours in order, the current screen colours, and default ranges: yellow VB–V0, green V0–V1, blue V1–V3, purple V3–V4, red V4–V6, black V6–V8, white V8–V10 (question Q2).
2. Set `grade_system = 'gym'`, `gym_id` and `gym_grade_id` on every climb from its colour.
3. Do the same for every `climb_grade` goal.
4. Then drop the checks and add the new constraints, so the backfilled rows are validated by them.

**Why existing users see no change**

- Sessions without a template have `template_id` null and `custom_values` `{}`: the Run and Climb forms, load, Sessions and the session sheet treat them exactly as now.
- Climbs keep their `grade` text, so every list and chip reads the same. Progression moves from ordinals to the index, but with the default ranges the order of the seven colours is unchanged, so trends, "hardest sent" and goal progress come out the same. A test compares `calculate_progression` before and after on the seed data.
- Goals point at the "My gym" colour they named.
- API responses only gain fields. An old frontend still running in a browser tab ignores them, and the backend still accepts a climb with only `grade` (a colour) by using the user's most recent gym.

**Deploy order**: migration, then backend, then frontend, as for earlier schema changes. A user without any gym who logs climbing gets "My gym" created on first save.

## 6. UI

Mobile first, as everywhere: every control at least 44 × 44 px, labels above fields, numbers with `inputmode="decimal"` and tabular figures, and nothing that needs a drag or long press without a tap alternative.

### 6.1 Template list (You → Log forms)

[Mockup 1](design-mockups/custom-forms/01-template-list.html). A list of the user's templates grouped by sport, each row with its name, sport badge and a one-line field summary ("Protocol · Grip · Hangs · Pain"). "New template" at the top; archived templates folded away at the bottom. Gyms are listed in their own section on the same screen ("Gyms"), since both shape the Log form.

**Alternative T1, built-in forms in the list.**
- **A**: Run and Climb appear as built-in entries (lock icon). Tapping one lets you hide the optional fields (elevation, climbs) and set it as the default, but not delete it.
- **B**: Only the user's own templates appear; Run and Climb stay fixed and unlisted.
- **Recommendation: A.** One place for "how my log looks", and an easy start: "Duplicate Run" for an Intervals template.

### 6.2 Template editor

[Mockup 2](design-mockups/custom-forms/02-template-editor.html). Name, sport (Run, Climb, Other), the core fields shown greyed and locked ("Always: date, duration, effort, notes, tags"), then the template's fields as cards. "Add field" opens a sheet with the six types, each with an icon and one line of explanation. A field card opens inline to edit label, unit, options or columns. A preview button shows the Log form as it will look.

**Alternative T2, reordering fields.**
- **A**: Up and down buttons on each field card (44 px each).
- **B**: A drag handle, with up and down in the field's menu as the accessible fallback.
- **Recommendation: A.** Templates have few fields, buttons are exact on a phone and need no fallback.

### 6.3 Picking a template in Log, and the templated form

[Mockup 3](design-mockups/custom-forms/03-log-with-template.html). After picking, the form shows date, duration and effort as today, then the template's fields, then notes and tags. The last template per sport is remembered on the device. A templated session in Sessions shows the template name as its title and a summary line ("6 × 10 s · 20 mm · +10 kg").

**Alternative T4, where the template is picked.**
- **A**: Templates are tiles next to Run and Climb in the "What did you do?" grid (most-used first, up to six, then "More").
- **B**: Pick the sport first, then a row of form chips under it ("Standard", "Intervals", "Fingerboard").
- **Recommendation: A** for one tap; B scales better past ten templates. A with a "More" sheet covers both.

**Alternative T3, entering sets.**
- **A**: Grouped rows: each row is "sets × reps × load (+ extras)", with steppers. Most fingerboard and strength sessions are one or two rows.
- **B**: One row per set, with "Copy last set". Exact when every set differs (pyramids, drop sets), but long.
- **Recommendation: A**, as the data model stores groups; B's case is covered by adding rows.

### 6.4 Gym picker in the climbing log

[Mockup 4](design-mockups/custom-forms/04-bouldering-gym-picker.html). Above the grade chips: the gym (remembered from the last climbing session) and the grade system (Gym colours, V, Font). With gym colours, each chip shows its colour, name and approximate range in small text ("blue · V1–3"). With V or Font, the chips are that scale, starting near the user's recent grades and scrolling sideways.

**Alternative G1, picking the gym.**
- **A**: A button with the gym's name that opens a sheet with the gyms, "Outdoors (V/Font)" and "Add gym".
- **B**: A row of gym chips, always visible.
- **Recommendation: A.** Most people climb at one or two gyms; the button keeps the form short and the chips for grades.

### 6.5 Gym editor

[Mockup 5](design-mockups/custom-forms/05-gym-editor.html). Name, then the colours easiest first. Each colour row: swatch (from the palette), name, approximate range, and up/down buttons. "Add colour" at the bottom; a used colour can only be archived. The range system switch (V or Font) sits at the top.

**Alternative G2, entering a range.**
- **A**: Two selects, "from" and "to".
- **B**: A V/Font ruler per colour where you tap the lowest and highest grade.
- **Recommendation: A.** Smaller, works with screen readers out of the box. B shows overlap between colours at a glance, so it could come later as a read-only overview.

### 6.6 Discreet mode

Custom numbers, `sets` rows, text values and climb ranges are marked `SENSITIVE` and blur like today's numbers and notes; a tap reveals them. Template names, field labels and gym names stay visible, as sport names do today. A template name can be revealing ("Knee rehab"); see Q6.

## 7. Agent

### 7.1 `list_templates`

A new read-only tool. It returns what the coach needs to fill in a form:

```json
{
  "templates": [
    {"id": 12, "name": "Fingerboard", "sport": "other",
     "fields": [
       {"key": "protocol", "label": "Protocol", "type": "select",
        "options": ["max_hangs", "repeaters", "density"]},
       {"key": "hangs", "label": "Hangs", "type": "sets", "required": true,
        "reps_unit": "s", "load_unit": "kg", "load_signed": true,
        "extras": [{"key": "edge_mm", "unit": "mm"}]}
     ]}
  ],
  "gyms": [
    {"id": 3, "name": "Klatreverket", "grades": [
      {"name": "green", "range": "V0–V1"}, {"name": "blue", "range": "V2–V3"}]}
  ],
  "last_gym_id": 3
}
```

Archived templates and fields are left out. The tool description tells the model to call it before logging anything that isn't a plain run or climb, or when the user names a gym.

Alternative **A1**: put a short list of template and gym names into the system prompt every turn (B) instead of a tool (A). B saves a tool call but costs tokens every turn and goes stale within a conversation. **Recommendation: A**, with names only in the system prompt as a hint if evals show the model forgets to call it.

### 7.2 `log_session` and `draft_session`

Both gain two optional properties, and climbs gain a grade system:

```json
"template_id": {"type": "integer", "description": "From list_templates. Omit for a plain run or climb."},
"values": {"type": "object", "description": "Template fields by key, only what the user said. sets: [{sets, reps, load, <extra keys>}]."},
"climbs[].grade_system": {"enum": ["gym", "v", "font"]},
"climbs[].gym_id": {"type": "integer"},
"climbs[].grade": {"type": "string", "description": "Colour name for gym, 'V4' or '6B+'."}
```

- The static tool schema can't describe each user's fields, so `values` is a plain object and `forms.py` validates it. A validation error comes back as the tool result, naming the field; the model fixes it or asks.
- The same rules as today: only what the user said, never guessed numbers, one call per session.
- `draft_session` returns the draft with labels and units filled in, so the draft card can render it without another request.
- `get_history` returns `template` (name) and `values` with labels and units, so the coach can say "your hangs went from +6 to +10 kg".

### 7.3 Draft card

[Mockup 6](design-mockups/custom-forms/06-chat-draft-card.html). The card shows the template name in place of the sport name, the core line (duration, effort) and the template's values. Save stores it; Review opens the Log form with the template picked and every field filled in (`lib/chat-drafts.ts` carries `template_id` and `values`).

**Alternative A2, showing values on the card.**
- **A**: One compact summary line per field ("Max hangs · half crimp", "6 × 10 s · 20 mm · +10 kg").
- **B**: A two-column table of label and value.
- **Recommendation: A.** It matches the session card in Sessions and keeps the chat scannable; Review shows the full form.

### 7.4 Evals

New cases in `backend/evals/cases/`, each with a seeded template or gym:

| Case | Checks |
|------|--------|
| `template_fingerboard_draft` | "6 × 10 s on 20 mm with +10 kg, effort 7, 40 min" → `draft_session` with the Fingerboard `template_id` and one `hangs` row with all four numbers |
| `template_only_stated_fields` | fields the user didn't mention (grip, pain) are left out, not guessed |
| `template_not_invented` | "did some yoga, 30 min, effort 3" with no yoga template → `sport: other` without a template, never an invented `template_id` |
| `template_ambiguous_asks` | two templates fit ("Strength A", "Strength B") → the coach asks which, no draft yet |
| `gym_named_colours` | "flashed two blues at Klatreverket" → that `gym_id`, `grade_system: gym`, grade `blue` |
| `outdoor_v_grade` | "sent a V4 outdoors" → `grade_system: v`, grade `V4`, no gym |
| `template_validation_retry` | a seeded edge limit is broken by a typo ("200 mm") → the coach asks instead of saving |
| `progression_across_gyms` | climbs at two gyms and in V → the summary names grades in each system and doesn't claim a jump caused by a gym change |

The existing evals must keep passing, in particular `chat_drafts_instead_of_logging` and the progression cases.

## 8. Load

**Unchanged: session-RPE load = duration (min) × effort (1–10)** (Foster et al. 2001) for every session, templated or not, in every sport. Duration and effort are core fields, so every templated session has them.

- Template fields never change load. A fingerboard session of 40 min at effort 7 is 280, whatever the hangs were.
- The `other` sport counts in weekly load, the acute:chronic ratio and the Dashboard, with its own series colour and an "Other" entry in the sport filter.
- Volume measures (tonnage, time under tension, total hang time) are possible later as values derived from `sets` and shown in the session sheet. They don't enter load; see Q5.

## 9. Risks

| Risk | Mitigation |
|------|-----------|
| The template editor grows into a form builder and the milestone never ends | Six field types, 20 fields, no formulas, no conditional fields. Anything else is a follow-up |
| Edits change what old values mean | Keys, types and units fixed; archive instead of delete (section 3.2) |
| The frontend and backend disagree on what is valid | One module on the server decides; a shared fixture runs in both test suites |
| Grade conversion is disputed (V↔Font, and gym ranges are rough) | The index is never shown as a number; each climb keeps its own grade; the ranges are the user's, editable |
| Progression changes for existing users after the move to the index | Default ranges keep the colour order; a before/after test on seed data |
| Foreign keys bypass RLS and leak another user's template or gym | Ownership checks in every policy that takes a reference; tests for each (section 4) |
| The coach picks the wrong template, or invents values | `list_templates` first, only stated fields, evals for both; drafts are confirmed by the user by default |
| `jsonb` values are hard to chart later | Keys never change, so values can be queried by key; a per-field chart is a follow-up, not blocked |
| Extra grade colours (orange, pink, grey) are not colour-blind safe | Validate each with the existing checks (#55) before adding it to the palette; names always shown |
| Custom fields reveal private context in discreet mode | Values blur; Q6 for names |

## 10. Open questions for you

1. **Q1. A third sport `other`?** Is "Other" right as the third sport (and does it close #27), or do you want user-named sports such as "Strength" and "Cycling"? User-named sports touch the Dashboard filter, colours and load per sport; one `other` keeps that simple.
2. **Q2. Default ranges for "My gym".** Are yellow VB–V0, green V0–V1, blue V1–V3, purple V3–V4, red V4–V6, black V6–V8, white V8–V10 close enough for your gym? They decide how old climbs compare to new ones.
3. **Q3. Should templates be per sport only, or also offer "copy from" a starter set** (Fingerboard, Strength, Intervals, Mobility) on first use?
4. **Q4. Goals across gyms.** Should "send a red at My gym" also be reached by an equally hard climb at another gym or outdoors, or only at that gym?
5. **Q5. Volume from sets.** Do you want tonnage or total hang time shown in the session sheet in this milestone, or later?
6. **Q6. Discreet mode and template names.** Blur template names too, or keep them visible like sport names?
7. **Q7. kg and lb.** One unit per field (as designed), or convert between kg and lb for display?
8. **Q8. Alternatives.** Do you agree with the recommendations for T1–T4, G1, G2, A1, A2, D1 and D2, or do you prefer a B anywhere after seeing the mockups?

## 11. Follow-ups outside this milestone

- Charts of custom number fields and `sets` volume over time.
- Shared or public gym circuits.
- Import (#45) mapping GPX/FIT files to a running template.
- The coach proposing sessions in a template ("Training plans and proposals").
