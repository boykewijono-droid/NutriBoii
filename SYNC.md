# Activity sync: Samsung Health → NutriBoii, every hour

Steps and workout calories flow from your phone into the Sheet on their own,
so Claude only needs to ask you about food.

```
Samsung Health ──▶ Health Connect ──▶ HC Webhook app ──▶ NutriBoii API ──▶ Sheet ──▶ dashboard
   (built-in link)     (on the phone)      (posts every 60 min)       (action=sync)
```

## Where Health Sync fits: it doesn't, and that's fine

Keep Health Sync exactly as it is: **Weight** and **Nutrition** from Google Fit
into Samsung Health, everything else unticked. Don't tick Steps or Activities
for NutriBoii's sake.

Samsung Health has its own built-in link to Health Connect, and that is all
this needs. Adding Health Sync on top would only write the same steps a second
time. The API copes with that, but one path is easier to trust and to debug.

**A heads-up on your weight path.** Zepp Life → Google Fit → Health Sync →
Samsung Health depends on Google Fit, whose APIs Google is shutting down by the
end of 2026 ([Google Fit](https://developers.google.com/fit/rest)). When that
path stops, look for a Health Connect option in Zepp Life or in Health Sync.
Nothing in NutriBoii depends on it: InBody scans go into the Baselines tab
through Claude.

## What will and won't sync

| Sheet column | Syncs? | Notes |
|---|---|---|
| `Steps` | **Yes** | Samsung Health's daily total |
| `ExerciseCal` | **Yes** | Calories from workouts you record in Samsung Health |
| `ExerciseMin` | **Yes** | How long those workouts ran |
| `WorkoutSteps` | **Yes** | Steps taken during them — measured, or estimated from the workout type |
| `ActiveCal` | **No, and not needed** | See below |

**Samsung never shares its activity calories**
([Samsung Developer](https://developer.samsung.com/health/blog/en/accessing-samsung-health-data-through-health-connect)),
and that is fine: the burn doesn't use them. It is built from steps and
workouts, which do sync exactly — see *How the burn is worked out* in the
README. The `ActiveCal` column is no longer written.

**Keep Health Sync running.** Samsung sends one step total for the whole day,
which can't say which steps fell inside a workout. Health Sync writes the same
watch count into Health Connect minute by minute, and that is what lets the
burn take a walk's own steps out instead of counting them twice. Without it the
steps inside a workout are estimated from its type instead.

## Setup

### 1. Redeploy the API

Do this after every change to `sheet/api.gs`. Editing the file changes
nothing on its own: the old version keeps serving until a new one is
published.

1. Apps Script editor → the **`api`** file → select all → paste the new
   [sheet/api.gs](sheet/api.gs) → **Ctrl+S**.
2. **Deploy → Manage deployments → ✏️ (edit) → Version: New version → Deploy.**

The URL and token stay the same.

### 2. Samsung Health → Health Connect

Samsung Health → **⋮ → Settings → Health Connect**. Turn syncing on and
allow Samsung Health to share **Steps**, **Exercise**, **Active calories
burned** and **Total calories burned**.

Menu names shift a little between One UI versions. If you can't find it: phone
**Settings** → search **Health Connect** → **App permissions** → **Samsung
Health**.

To check it works: Health Connect → **Data and access → Activity → Steps**
should show today's steps, with Samsung Health as the source.

### 3. Install the webhook app, free, with Obtainium

The Play Store version costs $6.49. The same developer publishes the same app
free on GitHub, and it's the build this setup was checked against. The only
difference is a check that the app came from Play. Obtainium installs it
from GitHub and keeps it updated.

1. On the phone, open **[Obtainium's releases](https://github.com/ImranR98/Obtainium/releases/latest)**
   and download the APK listed as **`app-arm64-v8a-release.apk`**. Open it. Android asks
   to allow installs from your browser: allow it, install, then switch that
   permission back off.
2. Open Obtainium → **Add App** → App source URL:
   `https://github.com/mcnaveen/health-connect-webhook` → **Add**.
3. It finds **HC Webhook** (file `app-foss-release.apk`). Tap **Install**,
   and allow Obtainium to install apps when Android asks.

Obtainium checks for updates in the background and notifies you. The app's
name on the phone is **HC Webhook**.

When HC Webhook first asks for Health Connect access, allow **Steps**, **Total
Calories** and **Exercise Sessions**. **Active Calories** is no longer used;
allowing it does no harm.

Prefer to pay, or to skip Obtainium? The [Play Store version](https://play.google.com/store/apps/details?id=com.hcwebhook.app)
works exactly the same with every step here.

### 3b. The daily scale, if you use one

A Mi Body Composition Scale reaches Health Connect the same way the steps do:
scale → Zepp Life → Health Sync → Samsung Health → Health Connect. If yours is
already there, NutriBoii can take a weigh-in a day without you typing anything.

- In HC Webhook, also switch on **Weight** and **Body Fat** (and **Lean Body
  Mass**, **Bone Mass**, **BMI** if your scale reports them), and allow the
  matching Health Connect permissions.
- Readings land in their own **`Body Log`** tab, one row per day — the **last**
  weigh-in of the day, since a second reading replaces the first rather than
  adding to it.
- Trends then offers a toggle: **InBody** or **Daily scale**.

**The InBody stays the north star.** A $25 scale's body fat is a trend line,
not a measurement: it is consistent enough to show a direction over a fortnight
and not accurate enough to plan against. Nothing from the scale touches the
`Baselines` tab, and the pace projection still uses InBody scans only.

To seed some history the first time: **Manual Sync → Past 30 Days → Sync Now**.

### 4. Choose the data types

In the app's **Data Types**, switch on **Steps**, **Total Calories** and
**Exercise Sessions**.

Then set **Resolution → Full** for **Steps**. Total Calories is already Full by
default. Full matters twice over: it keeps each app's count separate, and it is
what carries Health Sync's minute-by-minute steps — on Daily, NutriBoii can
only estimate which steps fell inside a workout.

This matters. On the **Daily** default the app sends one figure per day, which
Health Connect has already merged across every app that writes steps — and
there are usually several. On one real phone that was Samsung Health (2,881),
Android's own step counter (2,307) and Health Sync (283), and the merged
figure came out at 2,375: a number that matched nothing and read lower than
the phone. Full sends each app's own records, each tagged with the app that
wrote it, so NutriBoii can take Samsung Health's own count and ignore the rest.

Don't use the minute options. Those bundle every app's records together before
sending, which locks the double-count in.

### 5. Add NutriBoii as the webhook

**Webhook URLs → New Webhook URL**, paste the line below, then **Add Webhook**.
Delivery format: **JSON (HTTP POST)**. No headers needed.

```
<YOUR_EXEC_URL>?token=<YOUR_TOKEN>&action=sync
```

That's the same `/exec` URL and token Claude Chat uses, with `&action=sync` on
the end. They're kept out of this public repo on purpose.

Tap **Test Webhook**. It should say **Test successful**. The test sends made-up
numbers, which NutriBoii recognises and doesn't write.

Two quirks of that message:

- **"Test successful: Failed" means it worked.** The app hides `token=` in its
  logs, then looks the test up by the unhidden URL, finds nothing, and prints
  "Failed" where the status code should be. The **Logs** screen shows the real
  result: status 200.
- **"Test successful" only proves the phone reached Google.** Apps Script
  answers with a success code even when the token is wrong or the API wasn't
  redeployed, so step 8 is the real check.

### 6. Sync every hour

**Sync Schedule → Interval → 60 → Update Interval.** The minimum is 15.

### 7. Stop Samsung putting it to sleep

Samsung phones kill background apps aggressively, and a sleeping app doesn't sync.

- **Settings → Apps → HC Webhook → Battery → Unrestricted**
- **Settings → Battery → Background usage limits → Never sleeping apps → add HC Webhook**

### 8. Run the first sync

**Manual Sync → Time Range: Default (New data only) → Sync Now.**

The first sync looks back 48 hours. Within a few seconds:

- **Daily Log** +y before that is
  skipped on purpose: the 48-hour window starts part-way through it, so its
  count would be short.
- a hidden tab called **Activity Sync** appears (Sheet → View → Hidden sheets).
  It's the raw record store and trims itself to the last week.
- the dashboard shows the steps with **"so far today"** under them.

**Fill in history.** Manual Sync → **Past 30 Days** → Sync Now. Days up to 35
back are rebuilt from a resend, so this fills `ExerciseMin` and `WorkoutSteps`
in for past workouts too; the raw records are still trimmed to a week
afterwards. It *replaces* Steps and ExerciseCal for those days with Samsung's
own numbers, and never touches food.

If nothing appears in the Sheet, check that the URL has the right token and
ends in `&action=sync`, and that step 1 was published as a **new version**.
The app's **Logs** screen shows each post it made.

## How the numbers behave

- **Samsung Health is the step count.** Several apps write steps into Health
  Connect — Android'''s own counter and Health Sync both do on this phone. For
  each day and each measure NutriBoii takes ONE source, never the sum, and
  Samsung Health wins outright whenever it has anything for that day, so the
  sheet matches what your phone shows. Another app only stands in when Samsung
  is silent.
- **The scale is a separate story.** Weight and body fat land in `Body Log`
  and never touch the activity numbers, the `Baselines` tab or the pace
  projection.
- **Re-sent totals replace, they don't add.** If the phone sends a running
  daily total, 3,000 steps at 9:00 and 4,200 at 10:00, the Sheet shows 4,200,
  not 7,200. Sending the same data twice changes nothing.
- **Days follow Singapore time.** A walk at 00:30 counts for the new day.
- **ExerciseCal counts only calories inside a workout**, so an all-day calorie
  total is never mistaken for exercise. The same workout arriving from two apps
  counts once.
- **Food is never touched.** The sync writes only Steps, ExerciseCal,
  ExerciseMin and WorkoutSteps. Cal_Eaten, macros, day type and notes stay as
  Claude wrote them.
- **Today closes itself at midnight.** Hourly activity doesn't close it, and
  neither does anything else.
- **Weigh-ins: one per day, the morning one.** A second weigh-in never adds to
  the first, and an evening one never replaces a morning one.

## Changing how often

| What | Where | Default |
|---|---|---|
| How often the phone posts | Webhook app → Sync Schedule → Interval | 60 min |
| How often an open dashboard re-reads the Sheet | `autoRefreshMinutes` in [assets/config.js](assets/config.js) | 10 min |

## What's checked, and what only a real sync will show

Checked:

- the payload format, against the webhook app's source code, not just its README
- the POST reaching the live API and getting a proper JSON reply after Google's
  redirect, the same way the app sends it
- everything above, in `node sheet/api-sync.test.js` (46 checks)

Only a real sync will show:

1. whether Samsung Health writes each workout's calories as a total-calorie
   record, which is how ExerciseCal is filled
2. whether your phone shares active calories at all

If something looks off after a sync, open the **Activity Sync** tab and send me
a few rows.
