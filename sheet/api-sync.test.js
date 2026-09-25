/* Tests for action=sync: activity pushed from the phone by the Health Connect
 * Webhook app.   node sheet/api-sync.test.js
 *
 * Payload shapes follow the app's SOURCE (SyncManager.buildJsonPayload and
 * HealthConnectManager, checked Sept 2026), not just its README:
 *   - steps and active_calories default to DAILY totals: one record per day,
 *     start_time = midnight (or the lookback window's start, for the oldest
 *     day), end_time = now or the next midnight, and NO metadata at all
 *   - total_calories and exercise are raw records with metadata.data_origin
 *     and NO record id
 * The app re-sends today's running total on every sync, so most of these tests
 * are about totals being replaced, not added, across repeated payloads.
 */
const fs = require('fs');
const path = require('path');

/* The sheet as it stands BEFORE this change: 14 columns, old names. Every
 * world starts here, so every test also runs the in-place migration. */
const OLD_HDR = ['Date','DayType','Calories','Protein_g','Fat_g','Carbs_g','Steps',
  'ActiveCal','ExerciseCal','BMR','TDEE_Target','Deficit','GymDay','Notes'];
/* ...and as the API leaves it: two renamed, two appended. `row()` reads by
 * position with these names. */
const DAILY_HDR = ['Date','DayType','Cal_Eaten','Protein_g','Fat_g','Carbs_g','Steps',
  'ActiveCal','ExerciseCal','BMR','TDEE','Deficit','GymDay','Notes','ExerciseMin','WorkoutSteps'];
const BASE_HDR = ['Date','Weight_kg','BodyFat_pct','BodyFatMass_kg','SkeletalMuscle_kg','BMR','Notes'];

function makeSheet(name, header) {
  const n = header.length;
  const grid = [header.slice()];
  const s = {
    _grid: grid, _hidden: false,
    getName: () => name,
    getLastRow: () => {
      for (let r = grid.length - 1; r >= 0; r--)
        if (grid[r] && grid[r].some(v => v !== '' && v != null)) return r + 1;
      return 0;
    },
    getLastColumn: () => Math.max(n, ...grid.map(g => g.length)),
    _maxCols: n,
    getMaxColumns: () => s._maxCols,
    insertColumnsAfter: (after, k) => { s._maxCols += k; },
    getMaxRows: () => Math.max(grid.length, 1000),
    insertRowsAfter: () => {},
    hideSheet: () => { s._hidden = true; },
    setFrozenRows: () => s,
    getRange: (r, c, nr, nc) => {
      nr = nr || 1; nc = nc || 1;
      const ensure = (rr) => { while (grid.length < rr) grid.push(new Array(n).fill('')); };
      const rg = {
        setValue: (v) => { for (let i = 0; i < nr; i++) { ensure(r + i); for (let j = 0; j < nc; j++) grid[r - 1 + i][c - 1 + j] = v; } return rg; },
        getValue: () => (grid[r - 1] ? grid[r - 1][c - 1] : ''),
        setValues: (vals) => { for (let i = 0; i < nr; i++) { ensure(r + i); for (let j = 0; j < nc; j++) grid[r - 1 + i][c - 1 + j] = vals[i][j]; } return rg; },
        getValues: () => { const out = []; for (let i = 0; i < nr; i++) { const row = grid[r - 1 + i] || new Array(n).fill(''); out.push(row.slice(c - 1, c - 1 + nc)); } return out; },
        clearContent: () => { for (let i = 0; i < nr; i++) { if (grid[r - 1 + i]) for (let j = 0; j < nc; j++) grid[r - 1 + i][c - 1 + j] = ''; } return rg; },
        setNumberFormat: () => rg,
        sort: (spec) => {
          const body = grid.slice(r - 1, r - 1 + nr);
          body.sort((a, b) => String(a[spec.column - 1]).localeCompare(String(b[spec.column - 1])));
          for (let i = 0; i < body.length; i++) grid[r - 1 + i] = body[i];
        },
      };
      return rg;
    },
  };
  return s;
}

const SRC = fs.readFileSync(path.join(__dirname, 'api.gs'), 'utf8');

function world() {
  const sheets = { 'Daily Log': makeSheet('Daily Log', OLD_HDR), 'Baselines': makeSheet('Baselines', BASE_HDR) };
  sheets['Baselines'].getRange(2, 1, 1, 7).setValues([['2026-09-11', 75.9, 20.6, 15.6, 34.3, 1672, '']]);
  return { sheets, store: { 'nutriboii.apiSecret': 'T' }, clock: 0 };
}

/** Each call is stamped one second after the previous one, so "newest" is
 *  deterministic even when two calls land in the same millisecond. */
function call(w, body, params) {
  const ss = {
    getSheetByName: (x) => w.sheets[x] || null,
    insertSheet: (x) => (w.sheets[x] = makeSheet(x, x === 'Body Log'
      ? ['Date','Weight_kg','BodyFat_pct','LeanMass_kg','BoneMass_kg','BodyWater_kg','BMI','Source','Measured']
      : new Array(8).fill(''))),
  };
  let captured = null;
  const RealDate = Date;
  const base = RealDate.now() + (w.clock++) * 1000;
  function FakeDate(...a) { return a.length ? new RealDate(...a) : new RealDate(base); }
  FakeDate.now = () => base; FakeDate.UTC = RealDate.UTC; FakeDate.parse = RealDate.parse;
  FakeDate.prototype = RealDate.prototype;
  const sandbox = {
    Date: FakeDate,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    LockService: { getDocumentLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    PropertiesService: { getDocumentProperties: () => ({ getProperty: (k) => (k in w.store ? w.store[k] : null), setProperty: () => {}, deleteProperty: () => {} }) },
    Utilities: {
      getUuid: () => 'x',
      // honours the pattern, so code that asks for a time gets a time
      formatDate: (d, tz, fmt) => {
        const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit',
          day: '2-digit', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(d);
        const g = t => ((parts.find(x => x.type === t) || {}).value || '');
        if (!fmt) return g('year') + '-' + g('month') + '-' + g('day');
        return String(fmt)
          .replace(/'([^']*)'/g, (m, lit) => lit)
          .replace(/yyyy/g, g('year')).replace(/MM/g, g('month')).replace(/dd/g, g('day'))
          .replace(/h:mm/g, g('hour') + ':' + g('minute'))
          .replace(/\ba\b/g, g('dayPeriod').toUpperCase());
      },
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => { captured = t; return { setMimeType: () => t }; } },
    HtmlService: { createHtmlOutput: (h) => { captured = h; return { addMetaTag: () => h }; } },
    Logger: { log: () => {} },
  };
  const e = { parameter: Object.assign({ token: 'T', action: 'sync' }, params || {}),
              postData: body === undefined ? undefined : { contents: typeof body === 'string' ? body : JSON.stringify(body) } };
  const keys = Object.keys(sandbox);
  new Function(...keys, SRC + '\nreturn doPost(arguments[arguments.length-1]);')(...keys.map(k => sandbox[k]), e);
  return JSON.parse(captured);
}

// --- dates relative to today in Singapore --------------------------------
const sgt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' });
const TODAY = sgt.format(new Date());
const shift = (ymd, n) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const YEST = shift(TODAY, -1);
/** ISO UTC instant for a Singapore wall-clock time; h may be fractional or 24. */
const at = (ymd, h, extraMs) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + (h - 8) * 3600000 + (extraMs || 0)).toISOString();
};

/** The burn: BMR + workouts net of their resting minutes + steps OUTSIDE
 *  workouts. The hand-worked numbers beside each use of it are the check that
 *  this mirror is itself right. */
const WEIGHT = 75.9;                       // the scan in world(); no weigh-ins
const PER_MIN = 1672 / 1440;               // 1.16111 kcal a minute at rest
const tdee = (steps, exCal, exMin, wSteps, weight) => {
  const perStep = 0.0004 * (weight || WEIGHT);
  steps = steps || 0; exCal = exCal || 0;
  if (exCal > 0 && !(exMin > 0)) return Math.round(1672 + Math.max(exCal * 0.7, steps * perStep));
  const net = exCal > 0 ? Math.max(0, exCal - PER_MIN * exMin) : 0;
  const inside = exCal > 0 ? (wSteps != null ? wSteps : 60 * exMin) : 0;
  return Math.round(1672 + net + Math.max(0, steps - Math.min(steps, inside)) * perStep);
};
/** Health Sync's per-minute copy of the watch count: `perMin` steps in every
 *  minute from h1 to h2 (Singapore hours). */
const minuteSteps = (ymd, h1, h2, perMin, origin) => {
  const out = [];
  for (let m = Math.round(h1 * 60); m < Math.round(h2 * 60); m++)
    out.push({ count: perMin, start_time: at(ymd, m / 60), end_time: at(ymd, (m + 1) / 60), metadata: md(origin || HSYNC) });
  return out;
};

const SAMSUNG = 'com.sec.android.app.shealth', HSYNC = 'nl.appyhapps.healthsync';
const md = (origin) => ({ data_origin: origin || SAMSUNG, recording_method: 'automatically_recorded' });
/** A daily total as the app sends it: no metadata. `endH` is the hour it runs
 *  to (a sync time has seconds and milliseconds on it, like Instant.now()). */
const daily = (field, ymd, endH, value) => ({ [field]: value, start_time: at(ymd, 0),
  end_time: endH === 24 ? at(ymd, 24) : at(ymd, endH, 17123) });
const stepsDay = (ymd, endH, n) => daily('count', ymd, endH, n);
const activeDay = (ymd, endH, kcal) => daily('calories', ymd, endH, kcal);
/** The oldest day of a lookback window: starts at the window's odd instant. */
const clippedDay = (field, ymd, startH, value) => ({ [field]: value, start_time: at(ymd, startH, 41987), end_time: at(ymd, 24) });
const rawSteps = (ymd, h1, h2, count, origin) => ({ count, start_time: at(ymd, h1), end_time: at(ymd, h2), metadata: md(origin) });
const rawCal = (ymd, h1, h2, calories, origin) => ({ calories, start_time: at(ymd, h1), end_time: at(ymd, h2), metadata: md(origin) });
/** type is the Health Connect exercise type: 70 strength training, 79 walking */
const session = (ymd, h1, h2, origin, type) => ({ type: String(type == null ? 70 : type),
  start_time: at(ymd, h1), end_time: at(ymd, h2), duration_seconds: (h2 - h1) * 3600, metadata: md(origin) });
const payload = (o) => Object.assign({ timestamp: new Date().toISOString(), app_version: '2.9.0' }, o);

const row = (w, date) => {
  const r = w.sheets['Daily Log']._grid.slice(1).find(x => String(x[0]).slice(0, 10) === date);
  if (!r) return null;
  // a cell never written reads as blank, exactly as the real sheet returns it
  const o = {}; DAILY_HDR.forEach((h, i) => o[h] = r[i] === undefined ? '' : r[i]); return o;
};
const rawKeys = (w) => w.sheets['Activity Sync']._grid.slice(1).map(x => x[0]).filter(Boolean);

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok ? '' : '\n        want ' + JSON.stringify(want) + '\n        got  ' + JSON.stringify(got)));
};

console.log('\n=== a sync with the app\'s default settings builds the day ===');
{
  const w = world();
  const r = call(w, payload({
    steps: [stepsDay(TODAY, 19.5, 8200)],
    active_calories: [activeDay(TODAY, 19.5, 610)],
    exercise: [session(TODAY, 7, 8)],
    total_calories: [rawCal(TODAY, 7, 8, 350), rawCal(TODAY, 0, 19.5, 1990)],
  }));
  eq('ok', r.ok, true);
  const d = row(w, TODAY);
  eq('steps from the daily total', d.Steps, 8200);
  eq('active calories are NOT written: they were never Samsung\'s', d.ActiveCal, '');
  eq('exercise = the workout record only; the all-day total is not exercise', d.ExerciseCal, 350);
  eq('the workout ran 60 minutes', d.ExerciseMin, 60);
  // no minute-by-minute steps, so a strength session is taken at 13 a minute
  eq('steps inside it estimated from its type: 13/min x 60', d.WorkoutSteps, 780);
  eq('new row inherits BMR from the newest scan', d.BMR, 1672);
  // 1672 + (350 - 1.16111 x 60) + (8200 - 780) x 0.0004 x 75.9
  //  = 1672 + 280.33 + 225.27 = 2177.6
  eq('TDEE: BMR + the workout net of its resting minutes + the steps outside it', d.TDEE, 2178);
  eq('the same arithmetic as the mirror', d.TDEE, tdee(8200, 350, 60, 780));
  eq('no calories eaten yet, so deficit stays blank', d.Deficit, '');
  eq('DayType untouched', d.DayType, '');
  eq('raw records kept in a hidden tab', [!!w.sheets['Activity Sync'], w.sheets['Activity Sync']._hidden], [true, true]);
}

console.log('\n=== THE HOURLY CASE: each sync re-sends today\'s running total ===');
{
  const w = world();
  call(w, payload({ steps: [stepsDay(TODAY, 9, 3000)], active_calories: [activeDay(TODAY, 9, 120)] }));
  call(w, payload({ steps: [stepsDay(TODAY, 10, 4200)], active_calories: [activeDay(TODAY, 10, 180)] }));
  call(w, payload({ steps: [stepsDay(TODAY, 11, 5000)], active_calories: [activeDay(TODAY, 11, 205)] }));
  const d = row(w, TODAY);
  eq('steps are the latest total, 5000, not 3000+4200+5000', d.Steps, 5000);
  eq('active calories arrived three times and were written none of them', d.ActiveCal, '');
  eq('superseded totals are deleted from the raw tab', rawKeys(w).length, 2);
}

console.log('\n=== the same payload twice does not double anything ===');
{
  const w = world();
  const p = payload({ steps: [stepsDay(TODAY, 9, 1200)], active_calories: [activeDay(TODAY, 9, 90)] });
  call(w, p); call(w, p);
  eq('steps still 1200', row(w, TODAY).Steps, 1200);
  eq('and nothing else written', row(w, TODAY).ActiveCal, '');
}

console.log('\n=== after midnight, yesterday\'s final total replaces its 23:00 total ===');
{
  const w = world();
  call(w, payload({ steps: [stepsDay(YEST, 23, 11000)] }));
  call(w, payload({ steps: [stepsDay(YEST, 24, 11650), stepsDay(TODAY, 0.5, 120)] }));
  eq('yesterday 11650', row(w, YEST).Steps, 11650);
  eq('today starts fresh at 120', row(w, TODAY).Steps, 120);
}

console.log('\n=== first sync: the 48-hour window starts part-way through a day ===');
{
  const w = world();
  const D2 = shift(TODAY, -2);
  call(w, payload({
    steps: [clippedDay('count', D2, 14.2, 2300), stepsDay(YEST, 24, 9800), stepsDay(TODAY, 14.2, 6100)],
    active_calories: [clippedDay('calories', D2, 14.2, 150)],
  }));
  eq('the clipped day is NOT written as if 2300 were its whole total', row(w, D2), null);
  eq('yesterday, complete, is written', row(w, YEST).Steps, 9800);
  eq('today is written', row(w, TODAY).Steps, 6100);
}

console.log('\n=== a manual "Past 7 Days" resend fills the week, skipping the clipped end ===');
{
  const w = world();
  const D7 = shift(TODAY, -7), D6 = shift(TODAY, -6), D3 = shift(TODAY, -3);
  call(w, payload({ steps: [clippedDay('count', D7, 16, 1900), stepsDay(D6, 24, 7400), stepsDay(D3, 24, 12000), stepsDay(TODAY, 16, 5000)] }));
  eq('7 days back, clipped, skipped', row(w, D7), null);
  eq('6 days back written', row(w, D6).Steps, 7400);
  eq('3 days back written', row(w, D3).Steps, 12000);
}

console.log('\n=== "Full" resolution: raw intervals add up; new ones add on ===');
{
  const w = world();
  call(w, payload({ steps: [rawSteps(TODAY, 7, 8, 1200), rawSteps(TODAY, 9, 10, 800)] }));
  eq('1200 + 800', row(w, TODAY).Steps, 2000);
  call(w, payload({ steps: [rawSteps(TODAY, 12, 13, 3000)] }));
  eq('only the new interval arrives next time, and is added: 5000', row(w, TODAY).Steps, 5000);
}

console.log('\n=== time buckets (no metadata, not overlapping) add up ===');
{
  const w = world();
  const bucket = (h, n) => ({ count: n, start_time: at(TODAY, h), end_time: at(TODAY, h + 1) });
  call(w, payload({ steps: [bucket(7, 900), bucket(8, 1500)] }));
  call(w, payload({ steps: [bucket(8, 1650), bucket(9, 400)] }));      // 8:00 bucket re-sent, grown
  eq('900 + 1650 + 400 (the grown 8:00 bucket replaces its old value)', row(w, TODAY).Steps, 2950);
}

console.log('\n=== two apps writing raw steps are never added together ===');
{
  const w = world();
  call(w, payload({ steps: [rawSteps(TODAY, 0, 20, 8000, SAMSUNG),
                            rawSteps(TODAY, 8, 12, 4100, HSYNC), rawSteps(TODAY, 12, 20, 4000, HSYNC)] }));
  eq('one source only (8000), not 16100', row(w, TODAY).Steps, 8000);
}

console.log('\n=== Samsung Health is the step count, even when another app claims more ===');
{
  const ZEPP = 'com.xiaomi.hm.health';
  const w = world();
  call(w, payload({ steps: [rawSteps(TODAY, 0, 20, 8000, SAMSUNG), rawSteps(TODAY, 0, 20, 12500, ZEPP)] }));
  eq('THE POINT: Samsung wins outright, not the bigger number', row(w, TODAY).Steps, 8000);
}

console.log('\n=== but another app stands in when Samsung is silent ===');
{
  const ZEPP = 'com.xiaomi.hm.health';
  const w = world();
  call(w, payload({ steps: [rawSteps(TODAY, 0, 20, 9400, ZEPP), rawSteps(TODAY, 0, 20, 6000, HSYNC)] }));
  eq('largest of the others', row(w, TODAY).Steps, 9400);
}

console.log('\n=== the same workout from two apps counts once ===');
{
  const w = world();
  call(w, payload({ exercise: [session(TODAY, 18, 19, SAMSUNG), session(TODAY, 18, 19, HSYNC)],
                    total_calories: [rawCal(TODAY, 18, 19, 420, SAMSUNG), rawCal(TODAY, 18, 19, 415, HSYNC)] }));
  eq('420 from Samsung, not 835 and not Health Sync\'s copy', row(w, TODAY).ExerciseCal, 420);
}

console.log('\n=== days follow Singapore time, not UTC ===');
{
  const w = world();
  // 00:30 SGT today is still "yesterday" in UTC
  call(w, payload({ steps: [rawSteps(TODAY, 0.5, 1, 300), rawSteps(YEST, 22, 23, 700)] }));
  eq('00:30 SGT counts for today', row(w, TODAY).Steps, 300);
  eq('22:00 SGT yesterday counts for yesterday', row(w, YEST).Steps, 700);
}

console.log('\n=== food logged by Claude is left alone ===');
{
  const w = world();
  w.sheets['Daily Log'].getRange(2, 1, 1, 14).setValues([[TODAY, 'Busy', 1540, 147, 68, 70, '', '', '', 1672, '', '', 'No', 'lunch at hawker']]);
  call(w, payload({ steps: [stepsDay(TODAY, 20, 9000)] }));
  const d = row(w, TODAY);
  eq('steps filled', d.Steps, 9000);
  eq('calories, protein, fat, day type and notes unchanged',
     [d.Cal_Eaten, d.Protein_g, d.Fat_g, d.DayType, d.Notes], [1540, 147, 68, 'Busy', 'lunch at hawker']);
  eq('still one row for the date', w.sheets['Daily Log']._grid.filter(x => String(x[0]).slice(0, 10) === TODAY).length, 1);
  // a rest day: every step counts. 1672 + 9000 x 0.0004 x 75.9 = 1945.2
  eq('a rest day counts every step', d.TDEE, 1945);
  eq('deficit derived now that calories exist', d.Deficit, 1945 - 1540);
}

console.log('\n=== what does not arrive stays blank, never 0 ===');
{
  const w = world();
  w.sheets['Daily Log'].getRange(2, 1, 1, 14).setValues([[TODAY, '', 1500, '', '', '', '', 640, '', 1672, '', '', '', '']]);
  call(w, payload({ steps: [stepsDay(TODAY, 20, 7000)] }));
  const d = row(w, TODAY);
  eq('ActiveCal typed in earlier survives a sync without active calories', d.ActiveCal, 640);
  eq('no exercise session, so ExerciseCal stays blank', d.ExerciseCal, '');
}

console.log('\n=== the sync never writes ActiveCal, whatever arrives ===');
{
  // Samsung sends Health Connect no activity calories at all. What arrived in
  // their place was Health Sync's, it was never the number Samsung shows, and
  // a rule that tried to judge it froze a stale morning value on 6 of 8 days.
  // So the sync no longer writes the column.
  const w = world();
  call(w, payload({ active_calories: [activeDay(TODAY, 9, 13)] }));
  eq('active calories alone create nothing', row(w, TODAY), null);
  call(w, payload({ steps: [stepsDay(TODAY, 20, 5000)],
                    exercise: [session(TODAY, 18, 19)],
                    total_calories: [rawCal(TODAY, 18, 19, 535)],
                    active_calories: [activeDay(TODAY, 20, 610)] }));
  eq('with a real day around them, still not written', row(w, TODAY).ActiveCal, '');
  eq('while the rest of the day is', [row(w, TODAY).Steps, row(w, TODAY).ExerciseCal], [5000, 535]);
}

console.log('\n=== calorie records partly inside a session ===');
{
  const w = world();
  call(w, payload({ exercise: [session(TODAY, 18, 19)],
                    total_calories: [rawCal(TODAY, 17.5, 18.5, 400), rawCal(TODAY, 16, 18.25, 900)] }));
  eq('half inside counts half (200); 11% inside counts nothing', row(w, TODAY).ExerciseCal, 200);
}

console.log('\n=== old raw records are pruned ===');
{
  const w = world();
  call(w, payload({ steps: [rawSteps(shift(TODAY, -9), 9, 10, 500), rawSteps(TODAY, 9, 10, 600),
                            rawSteps(shift(TODAY, -40), 9, 10, 700)] }));
  eq('only the recent record is kept in the raw tab', rawKeys(w).length, 1);
  // a manual "Past 30 days" sync must be able to fill history, so a day up to
  // 35 days old is rebuilt even though its raw records are then pruned
  eq('a 9-day-old day IS rebuilt from a resend', row(w, shift(TODAY, -9)).Steps, 500);
  eq('a 40-day-old one is beyond any resend and left alone', row(w, shift(TODAY, -40)), null);
}

console.log('\n=== no exercise session: a workout-shaped calorie record stands in ===');
{
  // the real case: a 1:20 walk arrives as one 446 kcal record from each app,
  // with no exercise session, because that data type was not enabled
  const w = world();
  const r = call(w, payload({
    steps: [rawSteps(TODAY, 7, 22, 13430)],
    total_calories: [rawCal(TODAY, 21, 22.4, 446, SAMSUNG), rawCal(TODAY, 21, 22.4, 446, HSYNC)],
  }));
  eq('ExerciseCal filled from the workout record, counted once', row(w, TODAY).ExerciseCal, 446);
  eq('reported as inferred, not measured', r.days[TODAY].exerciseInferred, true);
}

console.log('\n=== an all-day calorie stream is not inferred as exercise ===');
{
  const w = world();
  const chunks = [];
  for (let h = 0; h < 18; h++) chunks.push(rawCal(TODAY, h, h + 1, 95));
  const r = call(w, payload({ total_calories: chunks }));
  eq('18 hourly chunks are a stream: ExerciseCal stays blank', row(w, TODAY), null);
  eq('nothing inferred', r.summary.indexOf('no daily totals changed') >= 0, true);
}

console.log('\n=== a real session still wins over the fallback ===');
{
  const w = world();
  call(w, payload({
    exercise: [session(TODAY, 18, 19)],
    total_calories: [rawCal(TODAY, 18, 19, 300), rawCal(TODAY, 12, 13.5, 700)],
  }));
  eq('only the session calories count, not the other bounded record', row(w, TODAY).ExerciseCal, 300);
}

console.log('\n=== a too-short calorie record is not a workout ===');
{
  const w = world();
  call(w, payload({ total_calories: [rawCal(TODAY, 12, 12.1, 40)] }));   // 6 minutes
  eq('ignored', row(w, TODAY), null);
}


console.log('\n=== a workout with no session record still has its steps taken out ===');
{
  // The 18 Sept walk arrived as a workout-shaped calorie record with no
  // session, because that data type was off. Its own span is the window.
  const w = world();
  call(w, payload({
    steps: [rawSteps(TODAY, 7, 22, 13564)],
    total_calories: [rawCal(TODAY, 21, 22.4, 446)],
  }));
  const d = row(w, TODAY);
  eq('the inferred workout ran 84 minutes', d.ExerciseMin, 84);
  eq('its steps estimated at the default 60/min, type unknown', d.WorkoutSteps, 5040);
  // 1672 + (446 - 1.16111 x 84) + (13564 - 5040) x 0.0004 x 75.9
  //  = 1672 + 348.47 + 258.79 = 2279.3
  eq('workout and outside steps are ADDED', d.TDEE, 2279);
}

console.log('\n=== THE POINT: 10,000 steps and a gym session are two activities ===');
{
  // A rest-of-day of walking plus a gym session. The old rule took the larger
  // of the two and threw the other away.
  const w = world();
  call(w, payload({
    steps: [rawSteps(TODAY, 0, 24, 10000, SAMSUNG)],
    exercise: [session(TODAY, 18, 19.25, SAMSUNG, 0)],                 // 75 min, "other workout"
    total_calories: [rawCal(TODAY, 18, 19.25, 535, SAMSUNG)],
  }));
  const d = row(w, TODAY);
  eq('75 minutes', d.ExerciseMin, 75);
  eq('no minute stream: gym at 13 steps a minute, 975 inside', d.WorkoutSteps, 975);
  // 1672 + (535 - 1.16111 x 75) + (10000 - 975) x 0.0004 x 75.9
  //  = 1672 + 447.92 + 274.00 = 2393.9
  eq('BMR + gym + the 9,025 steps outside it', d.TDEE, 2394);
  eq('which is more than either alone', d.TDEE > tdee(10000, 0, null, null) && d.TDEE > 1672 + 448, true);
}

console.log('\n=== a walk\'s own steps are not counted twice ===');
{
  // 21 Sept: a 72-minute walk put 6,609 of the day's steps inside it. Health
  // Sync's per-minute copy of the watch count shows exactly which.
  const w = world();
  const inWalk = minuteSteps(TODAY, 20.5, 21.5, 92);                   // 60 min x 92 = 5,520
  const before = minuteSteps(TODAY, 9, 10, 50);                        // 3,000 outside it
  call(w, payload({
    steps: [rawSteps(TODAY, 0, 24, 8520, SAMSUNG)].concat(before, inWalk),
    exercise: [session(TODAY, 20.5, 21.5, SAMSUNG, 79)],
    total_calories: [rawCal(TODAY, 20.5, 21.5, 360, SAMSUNG)],
  }));
  const d = row(w, TODAY);
  eq('the steps are Samsung\'s day total, not the minute copy added to it', d.Steps, 8520);
  eq('steps inside the walk are MEASURED from the minute stream', d.WorkoutSteps, 5520);
  // 1672 + (360 - 1.16111 x 60) + (8520 - 5520) x 0.0004 x 75.9
  //  = 1672 + 290.33 + 91.08 = 2053.4
  eq('the walk counts once, as the walk', d.TDEE, 2053);
}

console.log('\n=== a step stream that does not account for the day is not trusted ===');
{
  // The phone's own counter ran 84-93% of the watch's. Measuring a workout's
  // steps from it would take off steps the watch counted and the phone missed.
  const w = world();
  const phone = 'com.android.healthconnect.phone';
  call(w, payload({
    steps: [rawSteps(TODAY, 0, 24, 10000, SAMSUNG)].concat(minuteSteps(TODAY, 8, 22, 10, phone)),  // 8,400 = 84%
    exercise: [session(TODAY, 18, 19, SAMSUNG, 79)],
    total_calories: [rawCal(TODAY, 18, 19, 300, SAMSUNG)],
  }));
  eq('84% coverage: estimated at 90/min instead, 5,400', row(w, TODAY).WorkoutSteps, 5400);
}

console.log('\n=== the same workout from two apps is one workout ===');
{
  // Samsung and Health Sync both write the session; Health Sync sometimes
  // relabels it strength training. Minutes must not double.
  const w = world();
  call(w, payload({
    steps: [rawSteps(TODAY, 0, 24, 4000, SAMSUNG)],
    exercise: [session(TODAY, 17, 18.4, SAMSUNG, 0), session(TODAY, 17, 18.4, HSYNC, 70)],
    total_calories: [rawCal(TODAY, 17, 18.4, 529, SAMSUNG), rawCal(TODAY, 17, 18.4, 529, HSYNC)],
  }));
  const d = row(w, TODAY);
  eq('84 minutes, not 168', d.ExerciseMin, 84);
  eq('calories once, not twice', d.ExerciseCal, 529);
  eq('and Health Sync\'s label still makes it a gym day', d.GymDay, 'Yes');
}

console.log('\n=== a day recorded before minutes were keeps its old arithmetic ===');
{
  // History has ExerciseCal but no ExerciseMin. Reinterpreting it with guessed
  // minutes would quietly rewrite the past, so it keeps the old rule: the
  // larger of workout x 0.7 and every step.
  const w = world();
  // ActiveCal 700 is ABOVE the workout, so the old formula would have added
  // (700 - 529) x 0.5 = 85.5 for it. Only then can the test tell whether it
  // is really gone.
  w.sheets['Daily Log'].getRange(2, 1, 1, 14).setValues([[TODAY, '', 1900, '', '', '', 8098, 700, 529, 1672, '', '', '', '']]);
  call(w, payload({ steps: [stepsDay(TODAY, 23, 8098)] }));
  const d = row(w, TODAY);
  eq('no minutes on record', d.ExerciseMin, '');
  // max(529 x 0.7, 8098 x 0.0004 x 75.9) = max(370.3, 245.9) = 370.3
  eq('old rule without ActiveCal: 1672 + 370', d.TDEE, 2042);
  // the old formula: 1672 + 529 x 0.7 + (700 - 529) x 0.5 = 2127.8
  eq('ActiveCal 700 adds nothing: not the 2,128 it used to give', d.TDEE !== 2128, true);
}

console.log('\n=== steps are priced at the latest MORNING weigh-in ===');
{
  // Lost weight since the InBody: a step now costs less. An evening reading
  // carries the day's food, and one far from its neighbours is usually
  // someone else on the scale, so neither is used.
  const w = world();
  const ZEPP = 'com.xiaomi.hm.health';
  const days = [-6, -5, -4, -3, -2, -1].map(n => shift(TODAY, n));
  call(w, payload({
    weight: [
      { kilograms: 75.7, time: at(days[0], 8), metadata: md(ZEPP) },
      { kilograms: 75.6, time: at(days[1], 8), metadata: md(ZEPP) },
      { kilograms: 73.9, time: at(days[2], 8), metadata: md(ZEPP) },     // 1.7 below: someone else
      { kilograms: 75.5, time: at(days[3], 8), metadata: md(ZEPP) },
      { kilograms: 77.4, time: at(days[4], 23.5), metadata: md(ZEPP) },  // late evening only
      { kilograms: 75.4, time: at(days[5], 8), metadata: md(ZEPP) },
    ],
    steps: [stepsDay(TODAY, 20, 10000)],
  }));
  // 1672 + 10000 x 0.0004 x 75.4 = 1973.6
  eq('yesterday\'s 75.4 morning reading prices today\'s steps', row(w, TODAY).TDEE, 1974);
  eq('not the InBody\'s 75.9', row(w, TODAY).TDEE !== tdee(10000, 0), true);
}

console.log('\n=== the evening outlier is skipped for the step price ===');
{
  const w = world();
  const ZEPP = 'com.xiaomi.hm.health';
  call(w, payload({
    weight: [{ kilograms: 75.6, time: at(shift(TODAY, -2), 8), metadata: md(ZEPP) },
             { kilograms: 77.5, time: at(shift(TODAY, -1), 23.6), metadata: md(ZEPP) }],
    steps: [stepsDay(TODAY, 20, 10000)],
  }));
  // 77.5 is an evening reading, so 75.6 prices the steps: 1672 + 302.4
  eq('the morning 75.6 is used, not the evening 77.5', row(w, TODAY).TDEE, 1974);
}

console.log('\n=== an old sheet is brought up to date in place ===');
{
  const w = world();
  w.sheets['Daily Log'].getRange(2, 1, 1, 14).setValues([[YEST, 'Gym', 2000, 140, 85, 169, 13676, 421, 449, 1672, 2087, 87, 'Yes', 'kept']]);
  call(w, payload({ steps: [stepsDay(TODAY, 9, 1000)] }));
  const h = w.sheets['Daily Log']._grid[0];
  eq('Calories is now Cal_Eaten', h[2], 'Cal_Eaten');
  eq('TDEE_Target is now TDEE', h[10], 'TDEE');
  eq('two columns appended', [h[14], h[15]], ['ExerciseMin', 'WorkoutSteps']);
  eq('the sheet was widened to hold them', w.sheets['Daily Log']._maxCols, 16);
  const y = row(w, YEST);
  eq('existing data did not move', [y.Cal_Eaten, y.Steps, y.ExerciseCal, y.GymDay, y.Notes], [2000, 13676, 449, 'Yes', 'kept']);
  call(w, payload({ steps: [stepsDay(TODAY, 10, 1500)] }));
  eq('running it again changes nothing', w.sheets['Daily Log']._grid[0].slice(0, 16).join(','), DAILY_HDR.join(','));
}



console.log('\n=== the daily scale: weight and body fat land in their own tab ===');
{
  const w = world();
  const ZEPP = 'com.xiaomi.hm.health';
  const r = call(w, payload({
    weight: [{ kilograms: 76.4, time: at(YEST, 7.5), metadata: md(ZEPP) },
             { kilograms: 75.85, time: at(TODAY, 7.2), metadata: md(ZEPP) },
             { kilograms: 76.1, time: at(TODAY, 21), metadata: md(ZEPP) }],
    body_fat: [{ percentage: 22.9, time: at(TODAY, 7.2), metadata: md(ZEPP) }],
    lean_body_mass: [{ kilograms: 55.34, time: at(TODAY, 7.2), metadata: md(ZEPP) }],
    bone_mass: [{ kilograms: 2.96, time: at(TODAY, 7.2), metadata: md(ZEPP) }],
    bmi: [{ value: 23.6, time: at(TODAY, 7.2), metadata: md(ZEPP) }],
  }));
  const tab = w.sheets['Body Log'];
  const row = (d) => { const x = tab._grid.slice(1).find(v => String(v[0]).slice(0, 10) === d); const o = {};
    ['Date','Weight_kg','BodyFat_pct','LeanMass_kg','BoneMass_kg','BodyWater_kg','BMI','Source','Measured']
      .forEach((h, i) => o[h] = x ? x[i] : null); return o; };
  eq('a Body Log tab appears', !!tab, true);
  eq('THE POINT: the morning weigh-in is kept; the 21:00 one does not replace it', row(TODAY).Weight_kg, 75.85);
  eq('yesterday keeps its own reading', row(YEST).Weight_kg, 76.4);
  eq('body fat from the scale', row(TODAY).BodyFat_pct, 22.9);
  eq('lean mass and bone mass too', [row(TODAY).LeanMass_kg, row(TODAY).BoneMass_kg], [55.34, 2.96]);
  eq('BMI', row(TODAY).BMI, 23.6);
  eq('the source is recorded', row(TODAY).Source, ZEPP);
  eq('the reply says which day was weighed', Object.keys(r.body).indexOf(TODAY) >= 0, true);
  eq('and lists what the phone sent, so we can see what is switched on',
     r.sent.sort().join(','), 'bmi,body_fat,bone_mass,lean_body_mass,weight');
  eq('Baselines is untouched: the InBody stays the north star',
     w.sheets['Baselines']._grid.slice(1).filter(x => x[0]).length, 1);
}


console.log('\n=== an InBody scan is not a daily weigh-in ===');
{
  // The InBody app pushes each scan into Health Connect. Those measurements
  // are already in Baselines; repeating them as weigh-ins made two scans look
  // like a daily trend, and labelled them as coming from a scale.
  const INBODY = 'com.inbody2014.inbody', ZEPP = 'com.xiaomi.hm.health';
  const w = world();
  const r = call(w, payload({
    weight: [{ kilograms: 75.9, time: at(TODAY, 18.7), metadata: md(INBODY) }],
    body_fat: [{ percentage: 20.6, time: at(TODAY, 18.7), metadata: md(INBODY) }],
  }));
  eq('nothing written, so no Body Log tab is even created', !!w.sheets['Body Log'], false);
  eq('and the reply says there was no weigh-in', r.body, null);

  const w2 = world();
  call(w2, payload({
    weight: [{ kilograms: 75.9, time: at(TODAY, 18.7), metadata: md(INBODY) },
             { kilograms: 76.2, time: at(TODAY, 7.2), metadata: md(ZEPP) }],
  }));
  const row2 = w2.sheets['Body Log']._grid.slice(1).find(x => String(x[0]).slice(0, 10) === TODAY);
  eq('the real scale reading is kept, the scan ignored', [row2[1], row2[7]], [76.2, ZEPP]);
}

console.log('\n=== a scale reading does not disturb the daily log ===');
{
  const w = world();
  call(w, payload({
    steps: [stepsDay(TODAY, 12, 6000)],
    weight: [{ kilograms: 75.9, time: at(TODAY, 7), metadata: md('com.xiaomi.hm.health') }],
  }));
  eq('steps still land in Daily Log', row(w, TODAY).Steps, 6000);
  eq('and the weigh-in is in Body Log', w.sheets['Body Log']._grid.slice(1)[0][1], 75.9);
}


console.log('\n=== a strength session is a gym day; a walk is not ===');
{
  const w = world();
  call(w, payload({ exercise: [session(TODAY, 18, 19, SAMSUNG, 70)],       // strength training
                    total_calories: [rawCal(TODAY, 18, 19, 420)] }));
  eq('GymDay filled by the session type', row(w, TODAY).GymDay, 'Yes');

  const w2 = world();
  call(w2, payload({ exercise: [session(TODAY, 18, 19.4, SAMSUNG, 79)],    // a walk
                     total_calories: [rawCal(TODAY, 18, 19.4, 446)] }));
  eq('a walk leaves GymDay alone', row(w2, TODAY).GymDay, '');
  eq('but its calories still count as exercise', row(w2, TODAY).ExerciseCal, 446);
}


console.log('\n=== Samsung files gym sessions as "other workout" (type 0) ===');
{
  // 13 Sept: 97 minutes of type 0, on a day the sheet calls Gym
  const w = world();
  call(w, payload({ exercise: [session(TODAY, 13, 14.6, SAMSUNG, 0)],
                    total_calories: [rawCal(TODAY, 13, 14.6, 703)] }));
  eq('a long unlabelled workout is a gym day', row(w, TODAY).GymDay, 'Yes');

  // 19 Sept: 16 minutes of type 0 — too short to claim
  const w2 = world();
  call(w2, payload({ exercise: [session(TODAY, 22.6, 22.87, SAMSUNG, 0)],
                     total_calories: [rawCal(TODAY, 22.6, 22.87, 90)] }));
  eq('a short one is left unclaimed, not guessed', row(w2, TODAY).GymDay, '');

  // and a long walk is still just a walk
  const w3 = world();
  call(w3, payload({ exercise: [session(TODAY, 21, 22.4, SAMSUNG, 79)],
                     total_calories: [rawCal(TODAY, 21, 22.4, 446)] }));
  eq('83 minutes of walking is not a gym day', row(w3, TODAY).GymDay, '');
  eq('its calories are still exercise', row(w3, TODAY).ExerciseCal, 446);
}

console.log('\n=== an answer already in the sheet is never overwritten ===');
{
  const w = world();
  w.sheets['Daily Log'].getRange(2, 1, 1, 14).setValues([[TODAY, '', 1500, '', '', '', '', '', '', 1672, '', '', 'No', '']]);
  call(w, payload({ exercise: [session(TODAY, 18, 19, SAMSUNG, 70)],
                    total_calories: [rawCal(TODAY, 18, 19, 420)] }));
  eq('a "No" he or Claude wrote stands', row(w, TODAY).GymDay, 'No');
}

console.log('\n=== the app\'s Test Webhook button writes nothing ===');
{
  const w = world();
  const r = call(w, payload({ test: true, steps: [stepsDay(TODAY, 12, 8432)], active_calories: [activeDay(TODAY, 12, 512)] }));
  eq('replies ok and says it was a test', [r.ok, r.test, /Test received/.test(r.summary)], [true, true, true]);
  eq('no row written', row(w, TODAY), null);
  eq('no raw tab created', !!w.sheets['Activity Sync'], false);
}

console.log('\n=== bad requests ===');
{
  const w = world();
  eq('wrong token refused', call(w, payload({}), { token: 'nope' }).ok, false);
  const bad = call(w, 'not json');
  eq('non-JSON body refused with a clear message', [bad.ok, /JSON body/.test(bad.error)], [false, true]);
  const empty = call(w, payload({}));
  eq('empty payload is fine and changes nothing', [empty.ok, empty.received, row(w, TODAY)], [true, 0, null]);
}

console.log('\n' + '='.repeat(46));
console.log('  ' + pass + ' passed, ' + fail + ' failed');
console.log('='.repeat(46));
process.exit(fail ? 1 : 0);
