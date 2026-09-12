/**
 * NutriBoii — one-time Google Sheet builder.
 *
 * HOW TO RUN
 *   1. Open the "NutriBoii" spreadsheet (already created; its ID is
 *      in assets/config.js).
 *   2. Extensions -> Apps Script. Delete the placeholder, paste this file.
 *   3. Pick setUpNutriBoii in the function dropdown, then Run. Approve the
 *      permission prompt (it only touches this spreadsheet). Google flags it
 *      unverified because you wrote it: Advanced -> Go to NutriBoii (unsafe).
 *      Takes a few seconds; output lands in the editor's Execution log.
 *   4. Back in the Sheet: Share -> General access -> Anyone with the link ->
 *      Viewer. The dashboard reads it anonymously, so this step is required.
 *
 * Safe to re-run: it adds missing tabs and headers and never deletes data.
 *
 * DESIGN NOTE — there are deliberately NO formulas in any cell. Every value
 * is a plain typed number written by Claude. The dashboard does the maths.
 * That means editing any cell by hand can never break a calculation.
 */

var DAILY = 'Daily Log';
var BASE  = 'Baselines';
var TGT   = 'Targets';

var DAY_TYPES = ['Rest', 'Busy', 'Gym', 'Treat'];

// Data rows to pre-format: ~13 months of daily logging. Kept modest on
// purpose, since formatting every row of a 1000-row sheet is needlessly slow.
var ROWS = 400;

var DAILY_COLS = [
  ['Date',         'date',   'Local Singapore date, ISO format YYYY-MM-DD. One row per day.'],
  ['DayType',      'text',   'Exactly one of: Rest, Busy, Gym, Treat.'],
  ['Calories',     'int',    'Total kcal eaten.'],
  ['Protein_g',    'int',    'Grams.'],
  ['Fat_g',        'int',    'Grams.'],
  ['Carbs_g',      'int',    'Grams.'],
  ['Steps',        'int',    'Samsung Health. Safe for an automated writer to fill.'],
  ['ActiveCal',    'int',    'Samsung Health activity calories. Automatable.'],
  ['ExerciseCal',  'int',    'Samsung Health exercise calories. Automatable.'],
  ['BMR',          'int',    'Latest InBody BMR. Blank = dashboard uses newest Baselines row.'],
  ['TDEE_Target',  'int',    'BMR + ExerciseCal*0.7 + (ActiveCal-ExerciseCal)*0.5. Blank = dashboard computes it.'],
  ['Deficit',      'int',    'TDEE_Target - Calories. Blank = dashboard computes it.'],
  ['GymDay',       'text',   'Which split, e.g. "Day 3". Use "None" if no training.'],
  ['Notes',        'text',   'Free text. Name the foods when fat goes over — the dashboard surfaces them.']
];

var BASE_COLS = [
  ['Date',              'date',  'Date of the InBody scan, YYYY-MM-DD.'],
  ['Weight_kg',         'dec',   'Kilograms.'],
  ['BodyFat_pct',       'dec',   'Percent, e.g. 22.4.'],
  ['BodyFatMass_kg',    'dec',   'Kilograms. Blank = derived from weight x body fat %.'],
  ['SkeletalMuscle_kg', 'dec',   'Kilograms.'],
  ['BMR',               'int',    'From the scan. The newest row is what the dashboard uses.'],
  ['Notes',             'text',  'Free text.']
];

var TGT_ROWS = [
  ['protein_floor_g',  150, 'g',  'Below this, the day is flagged RED.'],
  ['protein_goal_g',   160, 'g',  'Top of the healthy protein band.'],
  ['fat_ceiling_g',     70, 'g',  'Above this, the day is flagged RED.'],
  ['bodyfat_goal_pct',  15, '%',  'The goal. Drives the "weeks to goal" projection.'],
  ['bmr_fallback',    1672, 'kcal', 'Only used if the Baselines tab is empty.']
];

function setUpNutriBoii() {
  // A second run starting while the first is still going can interleave with
  // deleteColumns and shift the header row. One at a time.
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) {
    Logger.log('Another setUpNutriBoii run is already in progress. Nothing done.');
    return;
  }
  try {
    buildAll(SpreadsheetApp.getActiveSpreadsheet());
  } finally {
    lock.releaseLock();
  }
}

function buildAll(ss) {
  buildDaily(ss);
  buildBaselines(ss);
  buildTargets(ss);
  // Drop the blank default tab. Found by name, not by index: insertSheet's
  // position depends on which sheet was active, so the default is not
  // reliably at index 0. Any empty tab that isn't one of ours goes.
  var keep = {};
  keep[DAILY] = 1; keep[BASE] = 1; keep[TGT] = 1;
  ss.getSheets().forEach(function (sh) {
    if (!keep[sh.getName()] && sh.getLastRow() === 0 && ss.getSheets().length > 1) {
      ss.deleteSheet(sh);
    }
  });

  ss.setSpreadsheetTimeZone('Asia/Singapore');

  // Deliberately NO SpreadsheetApp.getUi().alert() here. Run from the Apps
  // Script editor, getUi() succeeds but alert() blocks waiting for a modal
  // that only renders in the spreadsheet tab, so the run looks like it hangs
  // forever. Logger.log works in every context and never blocks.
  Logger.log('NutriBoii sheet ready.');
  Logger.log('Tabs: ' + ss.getSheets().map(function (sh) { return sh.getName(); }).join(', '));
  Logger.log('Next: Share -> General access -> Anyone with the link -> Viewer.');
  Logger.log('Spreadsheet ID: ' + ss.getId());
}

/* --------------------------------------------------------------------- */

function sheetFor(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function writeHeader(sh, cols) {
  var names = cols.map(function (c) { return c[0]; });

  // Force the sheet to be exactly names.length columns wide BEFORE writing.
  // Doing it in this order is what makes a re-run repair a drifted layout
  // instead of preserving it.
  var have = sh.getMaxColumns();
  if (have < names.length) sh.insertColumnsAfter(have, names.length - have);
  else if (have > names.length) sh.deleteColumns(names.length + 1, have - names.length);

  sh.getRange(1, 1, 1, names.length).setValues([names]);
  sh.getRange(1, 1, 1, names.length)
    .setFontFamily('Roboto Mono').setFontSize(10).setFontWeight('bold')
    .setBackground('#16150F').setFontColor('#F4F1E8')
    .setVerticalAlignment('middle');
  // Column descriptions live as cell notes, so the header row stays machine-clean.
  cols.forEach(function (c, i) { sh.getRange(1, i + 1).setNote(c[0] + '\n\n' + c[2]); });
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, names.length).setWrap(false);
}

function formatColumns(sh, cols, fromRow, nRows) {
  cols.forEach(function (c, i) {
    var r = sh.getRange(fromRow, i + 1, nRows, 1);
    if (c[1] === 'date') r.setNumberFormat('yyyy-mm-dd').setHorizontalAlignment('left');
    else if (c[1] === 'int') r.setNumberFormat('0').setHorizontalAlignment('right');
    else if (c[1] === 'dec') r.setNumberFormat('0.0').setHorizontalAlignment('right');
    else r.setNumberFormat('@').setHorizontalAlignment('left');
    r.setFontFamily(c[1] === 'text' ? 'Roboto' : 'Roboto Mono').setFontSize(10);
  });
}

function buildDaily(ss) {
  var sh = sheetFor(ss, DAILY);
  writeHeader(sh, DAILY_COLS);
  var rows = ROWS;
  if (sh.getMaxRows() < rows + 1) sh.insertRowsAfter(sh.getMaxRows(), rows + 1 - sh.getMaxRows());
  formatColumns(sh, DAILY_COLS, 2, rows);

  // DayType vocabulary is locked to exactly four values.
  sh.getRange(2, 2, rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(DAY_TYPES, true)
      .setAllowInvalid(false)
      .setHelpText('Must be one of: ' + DAY_TYPES.join(', '))
      .build());

  sh.setColumnWidth(1, 100);
  sh.setColumnWidth(2, 80);
  for (var c = 3; c <= 12; c++) sh.setColumnWidth(c, 84);
  sh.setColumnWidth(13, 90);
  sh.setColumnWidth(14, 320);
  sh.getRange(2, 14, rows, 1).setWrap(true);
  banding(sh, rows, DAILY_COLS.length);
}

function buildBaselines(ss) {
  var sh = sheetFor(ss, BASE);
  writeHeader(sh, BASE_COLS);
  var rows = 100;
  if (sh.getMaxRows() < rows + 1) sh.insertRowsAfter(sh.getMaxRows(), rows + 1 - sh.getMaxRows());
  formatColumns(sh, BASE_COLS, 2, rows);
  sh.setColumnWidth(1, 100);
  for (var c = 2; c <= 6; c++) sh.setColumnWidth(c, 132);
  sh.setColumnWidth(7, 300);
  banding(sh, rows, BASE_COLS.length);

  // One row per InBody scan. The newest row is the current baseline; the
  // whole column is the trend the dashboard projects from.
  sh.getRange(1, 1).setNote(
    'Date\n\nOne row per InBody scan, oldest first.\n' +
    'The NEWEST row supplies the current BMR, weight and body fat %.\n' +
    'Two or more rows unlock the "weeks to goal" projection.\n' +
    'No formulas here — every cell is a plain number, safe to edit.');
}

function buildTargets(ss) {
  var sh = sheetFor(ss, TGT);
  var cols = [['Key', 'text', 'Do not rename these keys — the dashboard looks them up.'],
              ['Value', 'dec', 'The number.'],
              ['Unit', 'text', 'Display only.'],
              ['Notes', 'text', 'What this target does.']];
  writeHeader(sh, cols);
  if (sh.getLastRow() < 2) {
    sh.getRange(2, 1, TGT_ROWS.length, 4).setValues(TGT_ROWS);
  }
  formatColumns(sh, cols, 2, 20);
  sh.getRange(2, 2, TGT_ROWS.length, 1).setNumberFormat('0.##');
  sh.setColumnWidth(1, 180); sh.setColumnWidth(2, 90);
  sh.setColumnWidth(3, 70);  sh.setColumnWidth(4, 380);
  sh.getRange(2, 4, TGT_ROWS.length, 1).setWrap(true);
  sh.getRange(2, 1, TGT_ROWS.length, 1).setFontWeight('bold');
}

function banding(sh, rows, nCols) {
  var r = sh.getRange(2, 1, rows, nCols);
  r.getBandings().forEach(function (b) { b.remove(); });
  r.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);
}
