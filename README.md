# NutriBoii

A nutrition and body-composition dashboard that reads a Google Sheet live.
Static HTML on GitHub Pages, no backend, no build step, no scheduled job.

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
| `Calories` | `1910` | kcal eaten |
| `Protein_g` | `160` | grams |
| `Fat_g` | `85` | grams |
| `Carbs_g` | `134` | grams |
| `Steps` | `8872` | Samsung Health |
| `ActiveCal` | `642` | Samsung Health activity calories |
| `ExerciseCal` | `547` | Samsung Health exercise calories |
| `BMR` | `1672` | optional — blank uses the newest `Baselines` row |
| `TDEE_Target` | | optional — blank and the dashboard computes it |
| `Deficit` | | optional — blank and the dashboard computes it |
| `GymDay` | `Day 3` | or `None` |
| `Notes` | `fat over from cashews + oil` | free text, and see below |

Blank means *not known*. It is rendered as an em dash and left out of every
average. It is never treated as zero.

`TDEE_Target` and `Deficit` are there so a value can be pinned if you ever want
to, but leaving them empty is the normal path:

```
TDEE_Target = BMR + (ExerciseCal × 0.7) + ((ActiveCal − ExerciseCal) × 0.5)
Deficit     = TDEE_Target − Calories
```

### Notes are parsed, so name the foods

When `Fat_g` goes over the ceiling, the dashboard reads `Notes` for what caused
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

**Today** — the hero. Calories, deficit and protein at a glance, then the
7-day rolling average deficit and the countdown to 15% body fat side by side,
then macros, then activity.

**Week** — intake against target and daily deficit for the last 7 calendar
days, plus the day-by-day table.

**Trends** — body fat %, weight and fat mass across every InBody scan; intake
and rolling deficit over 30 days; the scan history table.

**History** — every calendar day since the first entry, filterable by day type
or by flagged-only. Any day opens to its full row.

### The three things it is opinionated about

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

## Keeping it private

The Sheet must be link-readable for a static page to read it. If that is not
acceptable, the options are a small proxy holding a service-account key
(Cloudflare Worker or similar), or going back to a scheduled job that bakes the
data into the page at build time — which costs you the live reads.

## Later: activity auto-fill

`Steps`, `ActiveCal` and `ExerciseCal` are plain typed columns with nothing
coupling them to manual entry, so a Google Fit or Health Connect job can fill
them without a schema change or any edit here. Deliberately not built yet.
