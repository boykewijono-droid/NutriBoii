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
  tdee: { exerciseFactor: 0.7, incidentalFactor: 0.5 },

  rollingWindowDays: 7,     // the rolling-average deficit window
  weekDays:          7,     // "Week" view span
  trendDays:        30      // "Trends" calorie chart span
};
