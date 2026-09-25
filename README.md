# NutriBoii

A nutrition and body-composition dashboard that reads a Google Sheet live.
Static HTML on GitHub Pages, no backend, no build step, no scheduled job.

**Activity sync from Samsung Health, hourly: [SYNC.md](SYNC.md)**

**Theme:** the button beside *Refresh* cycles **Auto** (follows your phone)
→ **Light** → **Dark**.

**Setup: [SETUP.md](SETUP.md)** — the Sheet and the repo already exist, so
what is left is about five minutes.

---

## How it fits together

```
you talk to Claude  ──▶  Claude writes a row  ──▶  Google Sheet
                                                        │
                                    dashboard reads it live on every open
                                                        ▼
                                            GitHub Pages (static)
```

Three roles, and they do not overlap:

- **Claude, in chat** — talks to you about food and activity, does the day's
  arithmetic, writes the row. Never touches this code.
- **This dashboard** — reads and displays. Never writes.
- **You** — open it.

There is no nightly publish job. The original spec had one; the live-read
addition superseded it. A row Claude writes at 4pm is visible the moment you
open the page at 4:01. Nothing to wait for, nothing to break at 11pm.

---

## What Claude writes each day

One row in `Daily Log`, columns in this order:

| Column | Example | Notes |
|---|---|---|
| `Date` | `2026-09-12` | ISO, Singapore local date |
| `DayType` | `Gym` | exactly one of **Rest / Busy / Gym / Treat** |
| `Cal_Eaten` | `1910` | kcal eaten (was `Calories`) |
| `Protein_g` | `160` | grams |
| `Fat_g` | `85` | grams |
| `Carbs_g` | `134` | grams |
| `Steps` | `8872` | Samsung Health, synced hourly ([SYNC.md](SYNC.md)) |
| `ActiveCal` | | no longer written or used — Samsung never shares it |
| `ExerciseCal` | `547` | Samsung Health workout calories, as it reports them |
| `BMR` | `1672` | optional — blank uses the newest `Baselines` row |
| `TDEE` | | burned; written by the API, recomputed by the dashboard (was `TDEE_Target`) |
| `Deficit` | | optional — blank and the dashboard computes it |
| `GymDay` | `Yes` | `Yes` or `No` (or a split like `Day 3`) |
| `Notes` | `fat over from cashews + oil` | free text, and see below |
| `ExerciseMin` | `75` | how long the day's workouts ran, synced |
| `WorkoutSteps` | `975` | steps taken during workouts, synced |

Blank means *not known*. It is rendered as an em dash and left out of every
average. It is never treated as zero.

**How the burn is worked out.** One formula, in two places that must agree to
the calorie — `dayActivity()` in `sheet/api.gs` writes the sheet's `TDEE`, the
same function in `assets/app.js` recomputes it for the page — and a check
feeds both 20,000 random days to prove they do:

```
TDEE    = BMR
        + workouts:  ExerciseCal − (BMR ÷ 1440 × ExerciseMin)
        + steps:     (Steps − WorkoutSteps) × 0.0004 × morning weight
Deficit = TDEE − Cal_Eaten
```

- **Workouts and walking are added, not compared.** 10,000 steps and a gym
  session are two activities. The old rule took the larger and threw the other
  away.
- **A workout's calories include the resting burn you'd have had anyway**, and
  the BMR already pays for those minutes, so they come off: 1.16 kcal a minute
  at a 1,672 BMR. That uses the workout's real length, not a guess.
- **Steps inside a workout are already in its calories**, so they are not
  counted again. They are *measured* from Health Sync's minute-by-minute copy
  of the watch count when it accounts for the day (95–105% of Samsung's
  total); otherwise estimated from the workout's type — walking 90 a minute,
  gym 13, running 160, anything else 60 — figures taken from his own watch.
- **A step is priced at your latest morning weigh-in**, not an old InBody
  weight. Evening readings, and any more than 1 kg from their neighbouring
  morning readings, are ignored. No usable weigh-in: the InBody weight.
- **ActiveCal plays no part.** Samsung never sends Health Connect its activity
  calories; what arrived in their place came from Health Sync and was never
  Samsung's number.
- **A day recorded before workout minutes were** keeps the old rule — the
  larger of workout × 0.7 and all steps — rather than being rewritten with
  guesses. A "Past 30 days" resync fills the minutes in for most of history.

### Notes are parsed, so name the foods

When `Fat_g` goes over the limit, the dashboard reads `Notes` for what caused
it and says so on the day:

> **Fat over by 18g — driven by: chocolate, cashews, olive oil.**

It picks up two patterns: an explicit phrase (`fat over from x + y`,
`driven by: x, y`) and a sweep for common high-fat foods anywhere in the note.
Writing *"fat over from chocolate + cashews + olive oil"* gets the best result.
That is what turns the log from a record into something that breaks the pattern.

### InBody scans

A new row in `Baselines` per scan — date, weight, body fat %, fat mass, muscle,
BMR. The newest row becomes the current baseline. Two or more rows unlock the
projection. `BodyFatMass_kg` can be left blank and is derived from weight × BF%.

---

## What it shows

**Today** — the hero. What you've eaten, **the deficit right beside it**, and
protein and fat with their balance in words. While the day is open the deficit
is the running one — what you've burned so far, less what you've eaten — and
it counts up on paint, because it is the number the whole thing exists to
move. It becomes the final deficit when Claude closes the day. Then the 7-day rolling average deficit and the countdown to 15% body
fat side by side, then macros, then activity.

**Activity** shows steps, active and exercise calories, and an **activity
level** worked out from them rather than asked for: **High** for a workout or
a logged gym day, **Medium** for a day out and about, **Low** for a desk day
at home. Thresholds are in `activityLevels` in `assets/config.js`. A day with
no activity logged stays blank — unknown, not Low.

The hero's colours carry the verdict: **lime** is on target, **amber** is a
heads-up (a deficit smaller than the goal, protein still to eat, fat between
70 and 80 g), **red** is a real miss (a surplus, protein short on a finished
day, fat over 80 g).

**Week** — intake against target and daily deficit for the last 7 calendar
days, plus the day-by-day table.

**Trends** — body fat %, weight and fat mass, with a toggle between **InBody**
and the **daily scale** when a scale is syncing; intake and rolling deficit
over 30 days; the scan history table. Every body figure says where it came
from and when, because a fortnight-old scan is not today's weight.

The two sources are never mixed. InBody scans live in `Baselines` and are what
the pace projection is fitted to; daily scale readings live in `Body Log`,
written by the phone sync, and are a trend line rather than a measurement.

**History** — every calendar day since the first entry, filterable by day type
or by flagged-only. Any day opens to its full row.

### The four things it is opinionated about

**The goal, not just the day.** The point is 15% body fat, so the projection
sits on the Today view next to the calories, not buried in a tab. It fits a
trend through the last few scans' fat mass, holds lean mass constant, and says
plainly: *~17 weeks at this pace.* If fat mass is flat or rising it says that
instead of printing a fantasy number.

**The 7-day average, not the single day.** One treat day swings a daily number
by 900 kcal and means nothing. The rolling average is the number that predicts
fat loss, so it gets its own tile — and it averages the days that exist, not
the days that don't.

**Missing days stay missing.** The date axis is generated from the calendar and
rows are matched onto it. A day you didn't log is a gap: a dashed tick on the
chart, a dotted bridge across the line, "No data logged" in the table. It never
drops to zero, and it never silently closes up so a week with a hole looks
continuous.

**Today's burn is forecast, and it converges.** An open day's target needs a
burn that hasn't happened yet. It is today's own activity so far, plus a
shrinking share of what a usual day adds, so by late evening the forecast is
today's real burn and a long walk moves the target the same evening rather
than next week.

**A calorie target you can act on.** The day's burn (TDEE) is not a target:
eating all of it is a zero deficit. The target is the burn less
`deficit_goal_pct` (15% by default, set it in the Targets tab), and never
below your BMR. A percentage, not a flat number: a flat 500 put the target
below BMR on an ordinary day, and a gym day's bigger burn earns more food.
2,091 kcal burned gives a target of 1,777. A finished day uses its real burn. Today's burn isn't known until the day ends, so the
target is forecast from your usual burn over the last two weeks, never less
than what today has already burned, and shown with a "~".

**Today closes itself at midnight.** Nothing to close by hand. Food arrives
meal by meal and activity every hour, so while the date is today both halves
of the deficit are partial. The Today card answers one question: **how much
room is left**. The big number is always room, and what it counts down to
changes as the day crosses each line -- the plan first, then break-even:

| Where the day is | What the card says |
|---|---|
| nothing eaten yet | the whole plan, "planned today" |
| under the plan | plan less eaten, "left in plan", green |
| past the plan | burn less eaten, "left before even", amber, and how far past the plan |
| past the burn | eaten less burn, "over burn", red |
| no forecast yet | eaten so far, claiming nothing |

Under it one bar carries the whole day at one scale: filled with **food**,
with **eaten**, the **plan** and the **burn** all marked on it, so the gap
between the plan mark and the end is the deficit being aimed at, drawn to
scale. Labels that would sit closer than a quarter of the width drop to the
next line instead of overlapping. The bar fills with food
and never with "progress" -- a bar filled by deficit would sit full before
breakfast, eating nothing being the largest deficit there is. On quiet days,
where the plan sits on the BMR floor and the burn is barely above it, the two
marks stack instead of colliding.

Everything behind those numbers -- forecast burn, 85% of it, the BMR floor,
eaten, burned so far, how far past the plan, the deficit and the goal -- is
one tap away behind the **?**, in the card, without leaving the screen.

The card carries its own palette and display face, from a design done
separately; the rest of the page has not been brought across to match it.

It used to close when the day type was logged, which turned a label into a
chore and left an unlabelled day open for ever. So the **day type is worked out
when nobody writes one**: `Gym` if training was logged, otherwise `Busy` or
`Rest` from the activity level, shown with a dashed border to say it was
derived. `Treat` is never inferred — a deliberate higher-calorie day is a
decision, not something to read off a big dinner. The day that just finished
sits under the hero as one tappable line with its final deficit.

---

## Files

```
index.html            markup + the shell
assets/config.js      the only file you normally edit — sheet ID, targets
assets/styles.css     design tokens and all styling
assets/app.js         fetch, parse, model, charts, views
sheet/setup.gs        Apps Script that builds the three tabs
sheet/*.csv           the same headers, if you'd rather build it by hand
```

No dependencies. No bundler. Charts are hand-drawn SVG — which is also what
makes the dotted-gap rendering possible, since no chart library distinguishes
"missing" from "zero" the way this needs to.

The two typefaces (Fraunces, IBM Plex Mono) come from Google Fonts and are the
page's only external request besides the Sheet itself.

---

## How it reads the Sheet

`https://docs.google.com/spreadsheets/d/<id>/gviz/tq?tqx=out:csv&sheet=<tab>`

The `gviz` endpoint was chosen over *File → Publish to web* for two reasons: it
reflects an edit immediately, where a published CSV can cache for minutes, and
it addresses tabs by name so one sheet ID covers all three.

**It must be served over http(s).** Google grants CORS by reflecting the
requesting origin, and a page opened straight off disk has the origin `null`,
which cannot be reflected. So double-clicking `index.html` will always show
"Cannot read the Sheet" even when everything is configured correctly. GitHub
Pages is fine; to check a change locally, serve the folder instead:

```bash
python -m http.server 8000   # then open http://localhost:8000
```

If Google ever changes that endpoint, publish each tab to CSV and set the URLs
directly — the code takes them without any other change:

```js
publishedCsv: {
  daily:     "https://docs.google.com/.../pub?gid=0&single=true&output=csv",
  baselines: "https://docs.google.com/.../pub?gid=1&single=true&output=csv",
  targets:   "https://docs.google.com/.../pub?gid=2&single=true&output=csv"
}
```

---

## Conventions

Singapore time throughout; a day ends at local midnight SGT. Kilograms,
kilocalories, grams. Day types are exactly `Rest`, `Busy`, `Gym`, `Treat` —
the Sheet enforces it with a dropdown, and the dashboard ignores anything else
rather than inventing a fifth category.

---

## The diary checks itself

Each meal bullet carries its own calories, so the bullets should add up to
`Cal_Eaten`. When every bullet is priced and the two disagree by more than 5
kcal, the note says so — both numbers and the gap — and leaves the judgement
to you. It exists because 22 Sept sat at 1,915 in the diary and 1,895 in the
total for a day, with nothing anywhere saying which to believe. A bullet with
no calories in brackets silences the check rather than making it guess.

## Undoing a meal

Logging adds; `unlog` takes back. `action=unlog&date=today&match=panuozzo`
finds that one bullet in the day's diary, reads the calories out of its own
bracket, subtracts exactly those from the day's total, removes the line and
recomputes the day. It exists because removing a line by hand leaves its
calories behind in `Cal_Eaten`, and the diary and the total then disagree with
nothing on screen to say which is right. It refuses rather than guesses: two
matches remove nothing and the error lists both.

## Why the asset URLs carry a `?v=`

GitHub Pages serves everything with `Cache-Control: max-age=600`, so a phone
can keep running the previous `app.js` for some time after a deploy -- long
enough to look like a change never shipped, which is what happened the day
`EATEN` was added to the hero. `index.html` therefore points at
`assets/app.js?v=<hash>`, the hash being of the three asset files' contents,
so a deploy is always a new URL and no browser can serve the old one.

Forgetting to restamp would put the bug straight back, so `app.test.js`
recomputes the hash and fails if `index.html` disagrees, printing the value
to use. `scratchpad/patch_cachebust.py` restamps.

## Keeping it private

The Sheet must be link-readable for a static page to read it. If that is not
acceptable, the options are a small proxy holding a service-account key
(Cloudflare Worker or similar), or going back to a scheduled job that bakes the
data into the page at build time — which costs you the live reads.

## Activity auto-fill

`Steps`, `ExerciseCal`, `ExerciseMin` and `WorkoutSteps` arrive hourly from
Samsung Health through Health Connect and the API's `sync` action. The sync
writes only those four columns and never touches food. Setup and caveats:
[SYNC.md](SYNC.md).
