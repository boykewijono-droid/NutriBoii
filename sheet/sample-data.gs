/**
 * NutriBoii — TEMPORARY sample data. For looking at the design before real
 * logging starts. Not part of the dashboard.
 *
 * HOW TO USE
 *   1. Apps Script -> Files -> + -> Script -> name it "sample" (no extension;
 *      the editor adds .gs). Paste this file.
 *   2. Run seedSampleData.  Reload the dashboard to see it populated.
 *   3. Run clearSampleData when you are done. It removes ONLY the rows it
 *      wrote, tracked by date in Script Properties, so anything you logged
 *      yourself is left alone.
 *
 * Delete this script file once you are happy with the design.
 *
 * The data is shaped to exercise every feature deliberately:
 *   - two multi-day gaps, so charts show dotted bridges and missing-day ticks
 *   - fat-over days that NAME the foods, so the driver extraction has input,
 *     plus one that names none, to exercise the fallback wording
 *   - a protein-low day, so the protein floor turns red
 *   - a Treat day in real surplus, so a negative deficit bar renders
 *   - all four DayTypes, and today logged so the hero is populated
 *   - four InBody scans trending down, which unlocks the pace projection
 *
 * TDEE_Target and Deficit are left BLANK on purpose: that is the normal path,
 * and it makes the dashboard do the arithmetic rather than trusting the sheet.
 */

var SAMPLE_PROP = 'nutriboii.sampleDates';

/* dayOffset, DayType, Cal, Protein, Fat, Carbs, Steps, Active, Exercise, GymDay, Notes */
var SAMPLE_DAYS = [
  [-27, 'Gym',   1905, 158, 64, 152,  9800, 780, 620, 'Day 1', ''],
  [-26, 'Rest',  1960, 151, 69, 158,  4300, 320,   0, 'None',  'WFH, barely moved'],
  [-25, 'Busy',  2040, 147, 91, 131, 10900, 700, 400, 'None',  'fat over from chocolate + cashews'],
  [-24, 'Gym',   1875, 166, 59, 148, 10400, 790, 640, 'Day 2', ''],
  [-23, 'Rest',  1820, 155, 63, 140,  5100, 360,   0, 'None',  ''],
  [-22, 'Treat', 2810, 138, 118, 285, 6400, 430,   0, 'None',  'dinner out — satay and ice cream'],
  [-21, 'Busy',  1930, 162, 66, 146,  9200, 680, 420, 'None',  ''],
  // -20, -19 deliberately missing: a two-day gap
  [-18, 'Gym',   1890, 170, 61, 143, 10800, 800, 630, 'Day 3', ''],
  [-17, 'Rest',  1955, 144, 66, 162,  4600, 330,   0, 'None',  'no shake, protein short'],
  [-16, 'Busy',  1985, 156, 78, 150,  9900, 710, 430, 'None',  ''],
  [-15, 'Gym',   1880, 168, 58, 147, 10600, 785, 615, 'Day 1', ''],
  [-14, 'Rest',  1845, 159, 62, 138,  5300, 350,   0, 'None',  ''],
  [-13, 'Busy',  2065, 149, 88, 143, 11200, 720, 410, 'None',  'fat over from olive oil + cheese'],
  [-12, 'Gym',   1895, 172, 60, 141, 10300, 795, 625, 'Day 2', ''],
  [-11, 'Treat', 2640, 142, 104, 268, 6900, 440,   0, 'None',  'birthday dinner, laksa and cake'],
  [-10, 'Rest',  1835, 161, 61, 136,  4900, 340,   0, 'None',  ''],
  [ -9, 'Busy',  1945, 164, 65, 144,  9600, 690, 415, 'None',  ''],
  [ -8, 'Gym',   1885, 169, 57, 146, 10700, 800, 635, 'Day 3', ''],
  // -7 deliberately missing: a single-day gap
  [ -6, 'Rest',  1870, 157, 66, 139,  5200, 355,   0, 'None',  ''],
  [ -5, 'Busy',  2010, 155, 89, 120, 11200, 715, 405, 'None',  'fat over from chocolate, cashews and olive oil'],
  [ -4, 'Gym',   1885, 168, 60, 145, 10100, 790, 620, 'Day 1', ''],
  [ -3, 'Treat', 2750, 140, 110, 280, 6200, 425,   0, 'None',  'hawker night — fried carrot cake, satay'],
  [ -2, 'Rest',  1840, 158, 64, 135,  5300, 345,   0, 'None',  ''],
  [ -1, 'Gym',   1910, 160, 85, 134,  8872, 780, 615, 'Day 2', 'fat over from cashews + oil'],
  [  0, 'Busy',  1795, 171, 58, 128,  9950, 700, 410, 'None',  'clean day, hit protein early']
];

/* dayOffset, Weight_kg, BodyFat_pct, BodyFatMass_kg, SkeletalMuscle_kg, BMR, Notes */
var SAMPLE_SCANS = [
  [-98, 83.6, 25.9, 21.6, 41.0, 1695, 'baseline scan'],
  [-70, 82.4, 24.8, 20.4, 41.2, 1690, ''],
  [-35, 80.1, 23.1, 18.5, 41.0, 1680, ''],
  [ -7, 78.3, 21.6, 16.9, 41.1, 1672, '']
];

function seedSampleData() {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) { Logger.log('Another run in progress.'); return; }
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var daily = sdSheet(ss, 'Daily Log');
    var base  = sdSheet(ss, 'Baselines');
    var props = PropertiesService.getDocumentProperties();

    // Refuse to touch rows we did not write.
    if (daily.getLastRow() > 1 && !props.getProperty(SAMPLE_PROP)) {
      Logger.log('Daily Log already has data that is not sample data. Nothing done.');
      Logger.log('Clear it yourself first if you really want sample rows.');
      return;
    }
    clearSampleData();

    var dates = [];
    var rows = SAMPLE_DAYS.map(function (d) {
      var date = sdOffsetDate(d[0]);
      dates.push(date);
      //     Date  DayType Cal   P     F     C     Steps ActiveCal ExerciseCal BMR   TDEE  Def  GymDay Notes
      return [date, d[1], d[2], d[3], d[4], d[5], d[6], d[7],     d[8],       1672, '',   '',  d[9],  d[10]];
    });
    daily.getRange(2, 1, rows.length, 14).setValues(rows);

    var scans = SAMPLE_SCANS.map(function (s) {
      return [sdOffsetDate(s[0]), s[1], s[2], s[3], s[4], s[5], s[6]];
    });
    base.getRange(2, 1, scans.length, 7).setValues(scans);

    props.setProperty(SAMPLE_PROP, JSON.stringify({
      daily: dates,
      scans: SAMPLE_SCANS.map(function (s) { return sdOffsetDate(s[0]); })
    }));

    Logger.log('Seeded ' + rows.length + ' days and ' + scans.length + ' InBody scans.');
    Logger.log('Gaps left at: ' + [sdOffsetDate(-20), sdOffsetDate(-19), sdOffsetDate(-7)].join(', '));
    Logger.log('Reload the dashboard. Run clearSampleData when you are done.');
  } finally {
    lock.releaseLock();
  }
}

function clearSampleData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getDocumentProperties();
  var raw = props.getProperty(SAMPLE_PROP);
  if (!raw) { Logger.log('No sample data recorded. Nothing to clear.'); return; }

  var mark = JSON.parse(raw);
  var removed = sdDeleteByDate(sdSheet(ss, 'Daily Log'), mark.daily) +
                sdDeleteByDate(sdSheet(ss, 'Baselines'),  mark.scans);
  props.deleteProperty(SAMPLE_PROP);
  Logger.log('Removed ' + removed + ' sample rows.');
}

/* --------------------------------------------------------------------- */

/* Helpers are prefixed sd* on purpose. Apps Script gives every .gs file in
   the project ONE shared global scope, so a plain name like mustGet here
   silently collides with the identically named helper in api.gs and one of
   them wins at random depending on load order. */
function sdSheet(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error('Tab "' + name + '" not found. Run setUpNutriBoii first.');
  return sh;
}

/** A date N days from today, Singapore time, as 'YYYY-MM-DD'. */
function sdOffsetDate(n) {
  var d = new Date();
  d.setDate(d.getDate() + n);
  return Utilities.formatDate(d, 'Asia/Singapore', 'yyyy-MM-dd');
}

/** Delete only the rows whose column A matches one of `wanted`. Bottom up, so
 *  the shifting row indices cannot make it skip or overshoot. */
function sdDeleteByDate(sh, wanted) {
  if (sh.getLastRow() < 2) return 0;
  var want = {};
  (wanted || []).forEach(function (d) { want[d] = 1; });

  var col = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  var kill = [];
  for (var i = 0; i < col.length; i++) {
    var v = col[i][0];
    if (v === '' || v == null) continue;
    var key = (v instanceof Date)
      ? Utilities.formatDate(v, 'Asia/Singapore', 'yyyy-MM-dd')
      : String(v).trim().slice(0, 10);
    if (want[key]) kill.push(i + 2);
  }
  for (var j = kill.length - 1; j >= 0; j--) sh.deleteRow(kill[j]);
  return kill.length;
}
