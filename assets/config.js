/* ==========================================================================
   NutriBoii — configuration
   This is the ONLY file you normally need to edit.
   ========================================================================== */
window.NUTRIBOII_CONFIG = {

  /* ------------------------------------------------------------------ */
  /* 1. The Google Sheet                                                 */
  /* ------------------------------------------------------------------ */
  /* Paste the spreadsheet ID here (the long string in the Sheet's URL,
     between /d/ and /edit). The Sheet must be shared as
     "Anyone with the link -> Viewer".

     Leave as "" and the dashboard will show a first-run setup screen that
     accepts the ID in the browser and remembers it (localStorage).      */
  sheetId: "1_8vDpG2dIdTvPrWARYo8M8harF6vg0brcpeLfSkAsnE",

  /* Tab names inside that spreadsheet. Must match exactly. */
  tabs: {
    daily:     "Daily Log",
    baselines: "Baselines",
    targets:   "Targets"
  },

  /* ------------------------------------------------------------------ */
  /* 2. Targets — fallbacks only                                         */
  /* ------------------------------------------------------------------ */
  /* These are used when the "Targets" tab is missing or a key is blank.
     Preferred: edit the Targets tab in the Sheet, not this file.        */
  targets: {
    protein_floor_g:   150,   // below this = RED warning state
    protein_goal_g:    160,   // top of the healthy band
    fat_ceiling_g:      70,   // above this = AMBER, a heads-up
    fat_red_g:          80,   // above this = RED, a real overshoot
    deficit_goal_pct:   15,   // calorie target = burn less this %, never below BMR
    bodyfat_goal_pct:   15,   // the "why" — drives the projection
    bmr_fallback:     1600    // placeholder; only used if Baselines is empty
  },

  /* ------------------------------------------------------------------ */
  /* 3. Fixed rules (spec'd — change only if the spec changes)           */
  /* ------------------------------------------------------------------ */
  timezone:  "Asia/Singapore",          // all day boundaries are SGT
  dayTypes:  ["Rest", "Busy", "Gym", "Treat"],

  /* TDEE_Target = BMR + (ExerciseCal * 0.7) + ((ActiveCal - ExerciseCal) * 0.5)
     Used to recompute the target when the Sheet's TDEE_Target cell is blank. */
  /* stepKcalPerKg puts a FLOOR under the day's activity: steps x this x your
     weight, used when it beats the calorie figures. Samsung shares its step
     count but not its activity calories, so without it a 13,500-step day can
     be credited with almost nothing. 0.0004 x 76 kg is about 30 kcal per
     1,000 steps, net of the resting burn those minutes would have cost. */
  tdee: { exerciseFactor: 0.7, incidentalFactor: 0.5, stepKcalPerKg: 0.0004 },

  /* How active a day was, worked out from the day's own numbers so nobody has
     to answer a question about it:
       High   — a workout, or a gym day logged: gym, hiking, running, tennis
       Medium — out and about: an office day, a full day on your feet
       Low    — a desk day at home
     A day is High if ANY of the "high" tests pass, Medium if any "med" test
     passes, otherwise Low. A day with no activity logged at all stays blank. */
  activityLevels: {
    highExerciseCal: 300,   // a real session, not a walk
    highActiveCal:   700,
    medExerciseCal:  100,
    medActiveCal:    400,
    medSteps:       7000
  },

  rollingWindowDays: 7,     // the rolling-average deficit window

  /* Days of InBody history the pace projection fits over. Scans are
     irregular, so a fixed COUNT of scans can span a year and average an
     old gaining period into what should read as the current pace. Falls
     back to the last two scans if the window holds fewer than two. */
  projectionWindowDays: 120,
  weekDays:          7,     // "Week" view span
  trendDays:        30,     // "Trends" calorie chart span

  /* How often an OPEN dashboard re-reads the Sheet, in minutes. The phone
     pushes activity on its own schedule (set in the Health Connect Webhook
     app, 60 min to start); this only makes sure a page left open shows it
     without a manual refresh. 0 turns it off. */
  autoRefreshMinutes: 10,

  /* "Night" theme: dark from the first hour until the second, Singapore time.
     If you change these, change the same two numbers in index.html <head>. */
  nightHours: [19, 7]
};
