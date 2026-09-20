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

const DAILY_HDR = ['Date','DayType','Calories','Protein_g','Fat_g','Carbs_g','Steps',
  'ActiveCal','ExerciseCal','BMR','TDEE_Target','Deficit','GymDay','Notes'];
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
    getLastColumn: () => n,
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
  const sheets = { 'Daily Log': makeSheet('Daily Log', DAILY_HDR), 'Baselines': makeSheet('Baselines', BASE_HDR) };
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

/** the day's activity above resting: calorie figures, floored by steps */
const WEIGHT = 75.9;                       // the scan in world()
const activityBurn = (steps, ac, ex) =>
  Math.max(ex * 0.7 + Math.max(0, ac - ex) * 0.5, (steps || 0) * 0.0004 * WEIGHT);
const burn = (bmr, steps, ac, ex) => Math.round(bmr + activityBurn(steps || 0, ac || 0, ex || 0));

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
const session = (ymd, h1, h2, origin) => ({ type: '70', start_time: at(ymd, h1), end_time: at(ymd, h2), duration_seconds: (h2 - h1) * 3600, metadata: md(origin) });
const payload = (o) => Object.assign({ timestamp: new Date().toISOString(), app_version: '2.9.0' }, o);

const row = (w, date) => {
  const r = w.sheets['Daily Log']._grid.slice(1).find(x => String(x[0]).slice(0, 10) === date);
  if (!r) return null;
  const o = {}; DAILY_HDR.forEach((h, i) => o[h] = r[i]); return o;
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
  eq('active calories written (more than the workout, so all-day)', d.ActiveCal, 610);
  eq('exercise = the workout record only; the all-day total is not exercise', d.ExerciseCal, 350);
  eq('new row inherits BMR from the newest scan', d.BMR, 1672);
  eq('TDEE derived from the calorie figures, which beat 8,200 steps here', d.TDEE_Target, burn(1672, 8200, 610, 350));
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
  eq('active calories are the latest total, 205', d.ActiveCal, 205);
  eq('superseded totals are deleted from the raw tab', rawKeys(w).length, 2);
}

console.log('\n=== the same payload twice does not double anything ===');
{
  const w = world();
  const p = payload({ steps: [stepsDay(TODAY, 9, 1200)], active_calories: [activeDay(TODAY, 9, 90)] });
  call(w, p); call(w, p);
  eq('steps still 1200', row(w, TODAY).Steps, 1200);
  eq('active still 90', row(w, TODAY).ActiveCal, 90);
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
     [d.Calories, d.Protein_g, d.Fat_g, d.DayType, d.Notes], [1540, 147, 68, 'Busy', 'lunch at hawker']);
  eq('still one row for the date', w.sheets['Daily Log']._grid.filter(x => String(x[0]).slice(0, 10) === TODAY).length, 1);
  eq('deficit derived now that calories exist, steps included', d.Deficit, burn(1672, 9000, 0, 0) - 1540);
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

console.log('\n=== workout-only active calories are not passed off as all-day ===');
{
  const w = world();
  call(w, payload({ exercise: [session(TODAY, 18, 19)],
                    total_calories: [rawCal(TODAY, 18, 19, 380)],
                    active_calories: [activeDay(TODAY, 20, 300)] }));
  const d = row(w, TODAY);
  eq('ExerciseCal 380', d.ExerciseCal, 380);
  eq('ActiveCal 300 is below the workout, so left blank for Claude to ask', d.ActiveCal, '');
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
  call(w, payload({ steps: [rawSteps(shift(TODAY, -9), 9, 10, 500), rawSteps(TODAY, 9, 10, 600)] }));
  eq('only the recent record is kept', rawKeys(w).length, 1);
  eq('a 9-day-old record does not rewrite that old day', row(w, shift(TODAY, -9)), null);
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


console.log('\n=== a big walking day is not credited with nothing ===');
{
  // Samsung shares steps but no activity calories, so ActiveCal arrives barely
  // above the workout. Steps have to carry the day.
  const w = world();
  call(w, payload({
    steps: [rawSteps(TODAY, 7, 22, 13564)],
    active_calories: [rawCal(TODAY, 7, 22, 454)],
    total_calories: [rawCal(TODAY, 21, 22.4, 446)],
  }));
  const d = row(w, TODAY);
  const fromCals = 446 * 0.7 + Math.max(0, 454 - 446) * 0.5;      // 316
  const fromSteps = 13564 * 0.0004 * WEIGHT;                      // 412
  eq('steps carry it, and the two are never added', d.TDEE_Target, Math.round(1672 + Math.max(fromCals, fromSteps)));
  eq('which is more than the calorie figures alone would give', d.TDEE_Target > Math.round(1672 + fromCals), true);
  eq('ActiveCal itself is untouched, still what the phone sent', d.ActiveCal, 454);
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
  eq('THE POINT: the last weigh-in of the day wins, not the first or the sum', row(TODAY).Weight_kg, 76.1);
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
