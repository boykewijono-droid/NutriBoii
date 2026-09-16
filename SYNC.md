# Activity sync: Samsung Health → NutriBoii, every hour

Steps and workout calories flow from your phone into the Sheet on their own,
so Claude only needs to ask you about food.

```
Samsung Health ──▶ Health Connect ──▶ Health Connect Webhook app ──▶ NutriBoii API ──▶ Sheet ──▶ dashboard
  (or Health Sync)    (on the phone)     (posts every 60 min)          (action=sync)
```

## Why not Google Fit

Google stopped accepting new Google Fit API sign-ups in May 2024 and is shutting
the API down by the end of 2026. A new setup can't use it, and an existing one
would stop working within months. Health Connect is Google's replacement, and it
lives on the phone, so a small app on the phone does the posting.

- [Google Fit REST API](https://developers.google.com/fit/rest)
- [Google Fit migration FAQ](https://developer.android.com/health-and-fitness/health-connect/migration/fit/faq)

## What will and won't sync

| Sheet column | Syncs? | Notes |
|---|---|---|
| `Steps` | **Yes** | |
| `ExerciseCal` | **Yes** | Calories burned inside logged workouts |
| `ActiveCal` | **Probably not** | See below |

**ActiveCal is the gap.** Samsung's own documentation says its activity-tracker
data, the all-day activity calories you read off Samsung Health, is *not*
shared with Health Connect
([Samsung Developer](https://developer.samsung.com/health/blog/en/accessing-samsung-health-data-through-health-connect)).
Two ways around it:

1. **Try Health Sync as the source** instead of Samsung Health's built-in link
   (step 2B). It reads Samsung Health directly and may pass activity calories on.
   Whether it does for your phone is something to test, not something I can
   promise.
2. **Keep telling Claude at night.** If ActiveCal never arrives, it stays blank,
   never 0, and Claude asks for it once with the day's totals, the same as today.

## Setup

### 1. Redeploy the API (required)

`sheet/api.gs` gained the `sync` action.

1. Apps Script editor → **`api`** file → select all → paste the new
   [sheet/api.gs](sheet/api.gs) → Ctrl+S.
2. **Deploy → Manage deployments → ✏️ → Version: New version → Deploy.**

The URL and token stay the same.

### 2A. Samsung Health → Health Connect (built in)

Samsung Health → **Settings → Health Connect** → allow it to share **Steps**,
**Exercise** and **Calories burned**.

### 2B. Or: Health Sync → Health Connect

Health Sync app → source **Samsung Health**, destination **Health Connect** →
include steps, activities and calories. Use A *or* B for steps, not both.
Both is still safe, though: the API picks the single largest source per day and
never adds two apps' step counts together.

### 3. Install the webhook app

Play Store: **[Health Connect Webhook](https://play.google.com/store/apps/details?id=com.hcwebhook.app)**
([source and docs](https://github.com/mcnaveen/health-connect-webhook)).

When it asks for Health Connect access, allow: **Steps**, **Active calories
burned**, **Total calories burned**, **Exercise**.

### 4. Point it at NutriBoii

Add one webhook URL: your Apps Script `/exec` URL, then your token and
`action=sync` (the same URL and token Claude Chat uses; they are kept out of
this public repo on purpose):

```
<YOUR_EXEC_URL>?token=<YOUR_TOKEN>&action=sync
```

- Data types: **Steps, Active calories, Total calories, Exercise**. Leave the
  rest off; the API ignores them anyway.
- Sync mode: **Interval, 60 minutes**. The minimum is 15.

### 5. Stop Samsung putting it to sleep

Samsung phones kill background apps aggressively, and a sleeping app doesn't sync.

- **Settings → Apps → Health Connect Webhook → Battery → Unrestricted**
- **Settings → Battery → Background usage limits → Never sleeping apps → add Health Connect Webhook**

### 6. Test it

Trigger a sync in the app. Within a few seconds:

- today's row in **Daily Log** has **Steps** filled
- a hidden tab called **Activity Sync** appears (Sheet → View → Hidden sheets). That's
  the raw record store and it trims itself to the last few days.
- the dashboard shows the steps with **"so far today"** under them

If the app reports a failure, check that the URL has `?token=…&action=sync` on
the end and that step 1 was published as a **new version**.

## How the numbers behave

- **The app sends only new records**, not running totals, so the API rebuilds
  each day from everything it has stored. Sending the same data twice, or
  Samsung updating its one daily step count in place, never double counts.
- **Days follow Singapore time.** A walk at 00:30 counts for the new day.
- **ExerciseCal** counts only calories that fall inside a workout, so an all-day
  calorie stream isn't mistaken for exercise.
- **Food is never touched.** The sync writes only Steps, ActiveCal and
  ExerciseCal. Calories, macros, day type and notes are left exactly as Claude
  wrote them.
- **Today stays open** on the dashboard until Claude logs the day type with your
  final totals. Hourly activity doesn't close it.

## Changing how often

| What | Where | Default |
|---|---|---|
| How often the phone posts | Webhook app → interval | 60 min |
| How often an open dashboard re-reads the Sheet | `autoRefreshMinutes` in [assets/config.js](assets/config.js) | 10 min |

## Not yet verified on a real phone

Built and tested against the app's published schema with simulated payloads
(`node sheet/api-sync.test.js`, 28 checks). Three things only a real sync will
confirm:

1. that the app follows Apps Script's redirect after a POST and reports success
2. the exact name of the exercise array in the payload (the API accepts
   `exercise`, `exercise_sessions` or `exercises`)
3. whether your phone's workouts arrive as total-calorie records

If a sync lands but something looks off, open the **Activity Sync** tab and send me
a few rows.
