/* Tests for action=sync: activity pushed from the phone by the Health Connect
 * Webhook app.   node sheet/api-sync.test.js
 *
 * The payload shape follows the app's documented schema: arrays of records per
 * type (steps[].count, active_calories[].calories, total_calories[].calories,
 * exercise[]), each with start_time / end_time in UTC and metadata.id /
 * metadata.data_origin. The app sends only NEW records per sync, so most of
 * these tests are about totals staying right across repeated payloads.
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
  return { sheets, store: { 'nutriboii.apiSecret': 'T' } };
}

function call(w, body, params) {
  const ss = {
    getSheetByName: (x) => w.sheets[x] || null,
    insertSheet: (x) => (w.sheets[x] = makeSheet(x, new Array(8).fill(''))),
  };
  let captured = null;
  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    LockService: { getDocumentLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    PropertiesService: { getDocumentProperties: () => ({ getProperty: (k) => (k in w.store ? w.store[k] : null), setProperty: () => {}, deleteProperty: () => {} }) },
    Utilities: {
      getUuid: () => 'x',
      formatDate: (d, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d),
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
/** ISO UTC instant for a Singapore wall-clock time. */
const at = (ymd, h) => {   // h may be fractional: 17.5 is 17:30 (Date.UTC would truncate it)
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + (h - 8) * 3600000).toISOString();
};

const SAMSUNG = 'com.sec.android.app.shealth', HSYNC = 'nl.appyhapps.healthsync';
const md = (id, origin) => ({ id, data_origin: origin || SAMSUNG });
const stepsRec = (id, ymd, h1, h2, count, origin) => ({ count, start_time: at(ymd, h1), end_time: at(ymd, h2), metadata: md(id, origin) });
const calRec = (id, ymd, h1, h2, calories, origin) => ({ calories, start_time: at(ymd, h1), end_time: at(ymd, h2), metadata: md(id, origin) });
const session = (id, ymd, h1, h2) => ({ type: 'strength_training', start_time: at(ymd, h1), end_time: at(ymd, h2), metadata: md(id) });
const payload = (o) => Object.assign({ timestamp: new Date().toISOString(), app_version: '1.2.3' }, o);

const row = (w, date) => {
  const r = w.sheets['Daily Log']._grid.slice(1).find(x => String(x[0]).slice(0, 10) === date);
  if (!r) return null;
  const o = {}; DAILY_HDR.forEach((h, i) => o[h] = r[i]); return o;
};

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok ? '' : '\n        want ' + JSON.stringify(want) + '\n        got  ' + JSON.stringify(got)));
};

console.log('\n=== a first sync builds the day ===');
{
  const w = world();
  const r = call(w, payload({
    steps: [stepsRec('s1', TODAY, 7, 8, 1200), stepsRec('s2', TODAY, 9, 10, 800)],
    active_calories: [calRec('a1', TODAY, 7, 10, 210)],
    exercise: [session('x1', TODAY, 18, 19)],
    total_calories: [calRec('t1', TODAY, 18, 19, 350), calRec('t2', TODAY, 10, 11, 90)],
  }));
  eq('ok', r.ok, true);
  const d = row(w, TODAY);
  eq('steps summed within one source', d.Steps, 2000);
  eq('active calories written', d.ActiveCal, 210);
  eq('exercise = calories inside the session only (90 kcal at 10am excluded)', d.ExerciseCal, 350);
  eq('new row inherits BMR from the newest scan', d.BMR, 1672);
  eq('TDEE derived', d.TDEE_Target, Math.round(1672 + 350 * 0.7 + Math.max(0, 210 - 350) * 0.5));
  eq('no calories eaten yet, so deficit stays blank', d.Deficit, '');
  eq('DayType untouched', d.DayType, '');
  eq('raw records kept in a hidden tab', [!!w.sheets['Activity Sync'], w.sheets['Activity Sync']._hidden], [true, true]);
}

console.log('\n=== the same payload twice does not double anything ===');
{
  const w = world();
  const p = payload({ steps: [stepsRec('s1', TODAY, 7, 8, 1200)], active_calories: [calRec('a1', TODAY, 7, 8, 90)] });
  call(w, p); call(w, p);
  eq('steps still 1200', row(w, TODAY).Steps, 1200);
  eq('active still 90', row(w, TODAY).ActiveCal, 90);
}

console.log('\n=== incremental sync adds only the new record ===');
{
  const w = world();
  call(w, payload({ steps: [stepsRec('s1', TODAY, 7, 8, 1200)] }));
  call(w, payload({ steps: [stepsRec('s2', TODAY, 12, 13, 3000)] }));   // app sends only what is new
  eq('1200 + 3000, not overwritten by the second payload', row(w, TODAY).Steps, 4200);
}

console.log('\n=== Samsung updates its one daily step record in place ===');
{
  const w = world();
  call(w, payload({ steps: [stepsRec('daily', TODAY, 0, 24, 3000)] }));
  call(w, payload({ steps: [stepsRec('daily', TODAY, 0, 24, 5400)] }));
  eq('same id replaced, so 5400 not 8400', row(w, TODAY).Steps, 5400);
}

console.log('\n=== two apps writing steps are never added together ===');
{
  const w = world();
  call(w, payload({ steps: [stepsRec('sam', TODAY, 0, 24, 8000, SAMSUNG),
                            stepsRec('hs1', TODAY, 8, 12, 4100, HSYNC), stepsRec('hs2', TODAY, 12, 20, 4000, HSYNC)] }));
  eq('largest single source (8100), not 16100', row(w, TODAY).Steps, 8100);
}

console.log('\n=== days follow Singapore time, not UTC ===');
{
  const w = world();
  // 00:30 SGT today is still "yesterday" in UTC
  call(w, payload({ steps: [stepsRec('late', TODAY, 0.5, 1, 300), stepsRec('prev', YEST, 22, 23, 700)] }));
  eq('00:30 SGT counts for today', row(w, TODAY).Steps, 300);
  eq('22:00 SGT yesterday counts for yesterday', row(w, YEST).Steps, 700);
}

console.log('\n=== food logged by Claude is left alone ===');
{
  const w = world();
  w.sheets['Daily Log'].getRange(2, 1, 1, 14).setValues([[TODAY, 'Busy', 1540, 147, 68, 70, '', '', '', 1672, '', '', 'No', 'lunch at hawker']]);
  call(w, payload({ steps: [stepsRec('s1', TODAY, 7, 20, 9000)] }));
  const d = row(w, TODAY);
  eq('steps filled', d.Steps, 9000);
  eq('calories, protein, fat, day type and notes unchanged',
     [d.Calories, d.Protein_g, d.Fat_g, d.DayType, d.Notes], [1540, 147, 68, 'Busy', 'lunch at hawker']);
  eq('still one row for the date', w.sheets['Daily Log']._grid.filter(x => String(x[0]).slice(0, 10) === TODAY).length, 1);
  eq('deficit derived now that calories exist', d.Deficit, 1672 - 1540);
}

console.log('\n=== what does not arrive stays blank, never 0 ===');
{
  const w = world();
  w.sheets['Daily Log'].getRange(2, 1, 1, 14).setValues([[TODAY, '', 1500, '', '', '', '', 640, '', 1672, '', '', '', '']]);
  call(w, payload({ steps: [stepsRec('s1', TODAY, 7, 20, 7000)] }));
  const d = row(w, TODAY);
  eq('ActiveCal typed in earlier survives a sync without active calories', d.ActiveCal, 640);
  eq('no exercise session, so ExerciseCal stays blank', d.ExerciseCal, '');
}

console.log('\n=== a calorie record half inside a session counts half ===');
{
  const w = world();
  call(w, payload({ exercise: [session('x1', TODAY, 18, 19)], total_calories: [calRec('t1', TODAY, 17.5, 18.5, 400)] }));
  eq('200 of 400 kcal fall inside the session', row(w, TODAY).ExerciseCal, 200);
}

console.log('\n=== old raw records are pruned ===');
{
  const w = world();
  call(w, payload({ steps: [stepsRec('old', shift(TODAY, -9), 9, 10, 500), stepsRec('new', TODAY, 9, 10, 600)] }));
  const keys = w.sheets['Activity Sync']._grid.slice(1).map(x => x[0]).filter(Boolean);
  eq('only the recent record is kept', keys, ['steps|new']);
  eq('a 9-day-old record does not rewrite that old day', row(w, shift(TODAY, -9)), null);
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
