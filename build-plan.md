
# GymBoii Nutrition Dashboard — Build Plan for Claude Code

> **Note:** this is the original brief, kept as received. It was written under
> the name *GymBoii*; the project shipped as **NutriBoii** to keep it separate
> from the unrelated GymBoii project. Names in the text below are historical —
> the code, the repo and the Google Sheet are all NutriBoii.

## Goal
A GitHub Pages HTML dashboard showing daily and historical nutrition/activity
data, fed by a Google Sheet. Data entry happens conversationally (Boii talks
to Claude in chat); Claude writes each day's summary into the Google Sheet.
A separate scheduled Cowork task reads the Sheet nightly (~11pm) and
publishes the dashboard update to GitHub Pages.

This document specs the parts Claude Code should build:
1. The Google Sheet schema
2. The HTML dashboard (reads from the Sheet)
3. The GitHub repo + Pages setup
4. The nightly Cowork task that syncs Sheet -> dashboard -> GitHub

Claude Code should NOT build a manual data-entry UI — data entry is
conversational (handled by Claude in chat, writing directly to the Sheet).

---

## 1. Google Sheet — "GymBoii Daily Log"

One row per day. Columns:

| Column          | Type   | Example       | Notes                                  |
|-----------------|--------|---------------|-----------------------------------------|
| Date            | date   | 2026-09-12    | ISO format                              |
| DayType         | text   | Rest/Active/Gym/Treat | one of the 4 cheat-sheet categories |
| Calories        | number | 1910          | total eaten                             |
| Protein_g       | number | 160           |                                          |
| Fat_g           | number | 85            |                                          |
| Carbs_g         | number | 134           |                                          |
| Steps           | number | 8872          | from Samsung Health                     |
| ActiveCal       | number | 642           | Samsung Health "activity calories"      |
| ExerciseCal     | number | 547           | Samsung Health "exercise calories"      |
| BMR             | number | 1672          | latest InBody BMR                       |
| TDEE_Target     | number | 2102          | computed via sliding formula            |
| Deficit         | number | 192           | TDEE_Target - Calories                  |
| GymDay          | text   | Day 3 / None  | which split, if trained                 |
| Notes           | text   | free text     | flags, e.g. "fat over from cashews+oil" |

Sliding formula (already established, reuse exactly):
  TDEE_Target = BMR + (ExerciseCal * 0.7) + ((ActiveCal - ExerciseCal) * 0.5)

Second tab: "Baselines" — stores current BMR, weight, body fat %, from most
recent InBody scan, so the formula always uses the latest values. Claude
updates this tab whenever a new InBody scan is logged.

---

## 2. HTML Dashboard

Single-page site, mobile-friendly, reads data live from the Google Sheet
(via Google Sheets API or published-CSV link — Claude Code's choice on
implementation, whichever is more reliable for a static GitHub Pages site
with no backend).

Views needed:
- **Today** — current day's numbers vs target, deficit/surplus, macro bars
- **Week** — last 7 days as a simple table or chart: date, calories,
  deficit, steps, gym Y/N
- **History** — scrollable/filterable list of all past days, click into
  any day to see that day's full row (calories, macros, steps, notes)

Keep visual style consistent with the existing reference card already built
(warm paper background, serif headings, terracotta/rust accent, no generic
SaaS-card look). Reuse that file (nutrition-cheatsheet.html, already in
Boii's outputs) as the design starting point/token system.

---

## 3. GitHub repo

- New public or private repo, e.g. `gymboii-dashboard`
- `index.html` = the dashboard
- Enable GitHub Pages on main branch
- Output: permanent URL for Boii to bookmark / add to home screen

---

## 4. Nightly sync (Cowork scheduled task)

- Runs nightly ~11pm (Boii already has working scheduled tasks in Cowork
  for a separate Friday report — reuse that same scheduling mechanism)
- Task: read the day's row from the Google Sheet (if Claude already wrote
  it earlier via chat, this is just a republish; if the row is missing/
  incomplete because Boii didn't log that day, publish whatever partial
  data exists rather than failing)
- Regenerate the dashboard's data view and push the commit to GitHub

---

## Division of responsibility (do not change this)
- **Claude (chat, ongoing)**: talks to Boii daily about food/activity,
  calculates the day's numbers, writes the row to the Google Sheet.
  Does NOT build or touch the dashboard code.
- **Claude Code**: builds the Sheet schema, the dashboard, the repo, and
  the Cowork nightly sync task. One-time build + available for revisions.
- **Cowork scheduled task**: nightly automated publish only.


---

## ADDITION — Visual/UX requirements (added after initial spec)

This should NOT read as a plain document with numbers in a table. It should
feel like a real product dashboard, professional and polished, something
Boii actually wants to open every day. Specifically:

- **App-style navigation**: a persistent nav (sidebar or top bar) with
  clear sections — Today / Week / History / (optionally) Trends. Not just
  one long scrolling page of stats.
- **Charts, not just tables**: e.g. a line chart of calories vs target over
  the week/month, a stacked or grouped bar for macros, a trend line for
  weight/body fat from InBody scans over time. Use a lightweight charting
  approach that works on static GitHub Pages (e.g. Chart.js via CDN, or
  hand-rolled SVG if a more custom look is wanted).
- **Visual hierarchy**: today's key numbers (calories, deficit, protein)
  should be the immediate hero on load — big, legible, obvious at a glance
  — with supporting detail (macros, steps, gym status) secondary.
- **Professional, designed feel**: intentional color palette and
  typography (not default Bootstrap/generic SaaS look), consistent with
  the tone of the existing reference card (nutrition-cheatsheet.html) as a
  starting point, but elevated — this is the "real dashboard" version of
  that reference card, not a duplicate of it.
- **Responsive**: works well on both phone (primary use case, checked
  daily) and desktop.

Recommendation: given the visual design bar requested here, this build
should be done with Claude Opus (stronger for open-ended visual/product
design decisions) rather than a faster/lighter model — flag this to
whoever kicks off the Claude Code session.


---

## ADDITION — Design bar: "expensive," not generic

Explicit direction for whoever builds this (recommended: Claude Opus,
already flagged above) — the design bar is HIGH. This should look
premium and considered, like a paid product a fitness-tech company
charges for, not a free template or a "cheap-looking" utility page.

Concretely, that means:

- **No generic SaaS-card look.** Avoid: identical rounded cards with the
  same soft grey box-shadow on everything, default Bootstrap/Tailwind
  component defaults left unstyled, stock gradient washes as decoration,
  the default "AI-generated" tells (tracked-out ALL-CAPS eyebrow labels
  over every heading, generic terracotta-on-cream or near-black-with-neon
  palettes, arrows tacked onto every button).
- **Deliberate typography.** Pick real typefaces with a clear type scale
  and intentional weight/spacing choices — not default system fonts left
  unstyled. Typography should carry personality, not just be readable.
- **A considered color palette** — a small, deliberate set of colors (4-6)
  that feels premium and cohesive, not default blues/greens or a
  clip-art-bright dashboard look. Should feel like it was designed
  specifically for a personal fitness/nutrition tracking product for this
  user, not a generic admin template.
- **Restraint.** One or two elements should be the "hero"/memorable part
  of the design (e.g. the today's-numbers view, or a signature chart
  treatment) — everything else should be quiet and disciplined around it.
  Expensive design shows restraint, not decoration on every element.
- **Polish in the details**: spacing, alignment, hover/interaction states,
  chart styling (not default Chart.js theme left as-is — restyle axes,
  colors, tooltips to match the rest of the palette), empty/loading states
  handled deliberately rather than left blank or broken-looking.
- **Goal in one sentence**: this should feel like something Boii is proud
  to open every night, not a spreadsheet with a skin on it.


---

## ADDITION — Five refinements before handoff (Claude's suggestions, reviewed and approved by Boii)

### 1. Make the "why," not just the "what," prominent
The real goal is ~15% body fat, not just hitting daily macros. The
InBody trend (weight, body fat %, body fat mass over time) should be
as prominent on the dashboard as today's calories — not buried in a
secondary tab. Add a simple projection: at the current rate of change
(fat mass lost per week, from the last 2+ scans), estimate weeks/months
to reach the 15% target and display it plainly, e.g. "At this pace: ~10
weeks to goal." Recompute this automatically whenever a new InBody scan
row is added to the Baselines tab.

### 2. Auto-surface the fat-macro overshoot pattern
Recurring issue: fat target is overshot most days, usually from stacking
2-3 fat sources in one day (e.g. chocolate + cashews + olive oil).
When a day's Fat_g exceeds target, the dashboard should flag that day
visually (not just show the raw number) and, where the Notes field
contains the contributing foods, surface them — e.g. "Fat over by 25g —
driven by: chocolate, cashews, olive oil." This turns the log into a
pattern-breaker, not just a record.

### 3. Weekly rolling average as its own metric
Single-day numbers swing a lot (one treat day, one clean day). Add a
7-day rolling average deficit as its own standalone number on the
dashboard (not something the user has to eyeball from the daily table).
This is the number that actually predicts fat-loss progress.

### 4. Explicit empty-state handling for unlogged days
Some days won't get logged (Boii doesn't message that day). The
dashboard must show these as "No data logged" — visually distinct from
a 0-calorie day — on both the daily view and any chart/trend line
(e.g. a gap or dotted segment, not a value dropping to zero). Do not
let missing days silently render as zero in any chart.

### 5. Ownership of the Baselines tab
Claude (in chat) is the one who updates the "Baselines" tab (BMR,
weight, body fat %, latest InBody scan data) whenever Boii logs a new
InBody scan — this is a manual conversational update, not automated.
Claude Code should build the Sheet/dashboard so that updating this tab
is simple and low-risk (e.g. a clearly separated tab, clear column
headers, no hidden formulas that break if a value is edited) since it
will be edited by Claude directly through Sheets access, not through
a UI.


---

## ADDITION — Four final details before handoff (approved by Boii)

### 1. Attach the design reference file
This doc repeatedly points to `nutrition-cheatsheet.html` as the design
starting point / token system. Whoever kicks off the Claude Code build
MUST actually attach that file to the session — it lives in Boii's
outputs folder (nutrition-cheatsheet.html). Without it, Claude Code is
designing blind against a file it cannot see.

### 2. Lock the DayType vocabulary — use exactly these four
There is a mismatch in this doc (Sheet says "Rest/Active/Gym/Treat",
cheat sheet said "Rest/Busy/Gym/Treat"). Pick ONE and use it everywhere.
Canonical set to use: **Rest / Busy / Gym / Treat**.
- Rest = low activity, WFH, no gym
- Busy = office / moderate activity day
- Gym = trained that day (note which split in GymDay column)
- Treat = deliberate higher-calorie day
Any color-coding or filtering by day type must use these exact four
labels — no synonyms.

### 3. Units and timezone — state once, apply everywhere
- All times / day boundaries: **Singapore time (SGT, UTC+8)**. A "day"
  ends at local midnight SGT.
- Weight: **kilograms**. Energy: **kilocalories (kcal)**. Macros: **grams**.
- Never render pounds, or a US/other timezone day boundary.

### 4. Protein floor as a visual flag (not just calories)
On a cut, protein protects muscle — it matters as much as the fat ceiling.
The hero view already emphasizes calories and deficit. Add: flag protein
RED (same treatment as fat-over-target) whenever daily Protein_g drops
below ~150g. Protein UNDER target is a warning state, just like fat OVER
target. Ideally show protein as a progress bar against the ~150-160g goal,
not just a bare number.


---

## ADDITION — Live-read dashboard + robust missing-day handling (approved by Boii)

### Drop the scheduled publish dependency — read the Sheet LIVE
Preferred architecture: the dashboard should read the Google Sheet LIVE
every time the page is opened (via Sheets API or published-CSV link), so
that the moment Claude writes a day's row to the Sheet (right after
talking to Boii, any time of day), opening the dashboard shows the latest
data with no wait and no rebuild step.

This means the nightly ~11pm Cowork publish job is NOT required for data
freshness and can be dropped. (Keep Cowork only if Claude Code decides a
static baked-in build is more reliable for GitHub Pages — but the live-read
approach is preferred specifically so there is no scheduled dependency and
no waiting.) Sections 4 and the earlier Cowork references above are
superseded by this where they conflict.

### Date axis must be generated from the CALENDAR, not from existing rows
Critical for correct missing-day handling: the dashboard must build its
date axis (for week/history/trend views) from the actual calendar range,
then MATCH existing Sheet rows onto those dates — NOT simply plot whatever
rows exist back-to-back.

Why: if Boii doesn't talk to Claude on a given day, no row is written for
that date. If the chart just plots existing rows in sequence, a skipped
day silently collapses and a week with a gap looks falsely continuous.

Correct behavior:
- Generate every date in the view's range from the calendar.
- For each date, if a row exists, show its data; if not, show
  "No data logged" — a visible gap / dotted segment on charts, NOT zero.
- When Boii resumes logging the next day, that new date's row simply
  appears in its correct calendar position; the skipped day remains a
  visible gap and nothing shifts or collapses.


---

## ADDITION — Future path: auto-pull activity data (do NOT build now)

Deferred by Boii — build the skeleton first, add this later.

Current state: Boii already has Samsung Health syncing to Google Health
Connect AND to Google Fit (to be double-checked, but believed set up).
This means the activity data (steps, active calories, exercise calories)
already lands in systems that have an API — unlike Samsung Health itself,
which is closed.

Future automation path (NOT for the initial build):
- Once the dashboard is live and proven, a small pull could read daily
  steps / active kcal / exercise kcal from Google Fit's API (or Health
  Connect) and auto-fill the activity columns of the Sheet, so Boii only
  has to tell Claude about food, not activity numbers.

Implication for the initial build (do this now):
- Build the Sheet so the activity columns (Steps, ActiveCal, ExerciseCal)
  can be populated either manually (by Claude, from what Boii reports) OR
  later by an automated writer, without schema changes. i.e. don't hard-couple
  those columns to manual entry; keep them clean, typed, and independently
  writable so a future Google Fit pull can fill them without breaking anything.
- Do NOT build the Google Fit / Health Connect integration yet. Just leave
  the door open for it.
