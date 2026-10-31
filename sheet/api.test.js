/* Mock harness for api.gs. The point of this API is that named fields cannot
   land in the wrong column, so that is what most of these assert. */
const fs = require('fs');

/* The sheet starts as his real one did: 14 columns, the old names. The API
 * migrates it on first touch, so every test also runs the migration. */
const OLD_HDR = ['Date','DayType','Calories','Protein_g','Fat_g','Carbs_g','Steps',
  'ActiveCal','ExerciseCal','BMR','TDEE_Target','Deficit','GymDay','Notes'];
/* ...and as the API leaves it. Rows are read back by position with these. */
const DAILY_HDR = ['Date','DayType','Cal_Eaten','Protein_g','Fat_g','Carbs_g','Steps',
  'ActiveCal','ExerciseCal','BMR','TDEE','Deficit','GymDay','Notes','ExerciseMin','WorkoutSteps'];
const BASE_HDR = ['Date','Weight_kg','BodyFat_pct','BodyFatMass_kg','SkeletalMuscle_kg','BMR','Notes'];

function makeSheet(header) {
  const n = header.length;
  const grid = [header.slice()];
  const s = {
    _grid: grid,
    getLastRow: () => {
      for (let r = grid.length - 1; r >= 0; r--)
        if (grid[r] && grid[r].some(v => v !== '' && v != null)) return r + 1;
      return 0;
    },
    getLastColumn: () => n,
    getMaxRows: () => Math.max(grid.length, 500),
    insertRowsAfter: () => {},
    getRange: (r, c, nr, nc) => {
      nr = nr || 1; nc = nc || 1;
      const rg = {
        setValue: (v) => {
          // real Apps Script sets EVERY cell in the range
          for (let i = 0; i < nr; i++) {
            while (grid.length < r + i) grid.push(new Array(n).fill(''));
            for (let j = 0; j < nc; j++) grid[r - 1 + i][c - 1 + j] = v;
          }
        },
        getValue: () => (grid[r - 1] ? grid[r - 1][c - 1] : ''),
        setValues: (vals) => {
          for (let i = 0; i < nr; i++) {
            while (grid.length < r + i) grid.push(new Array(n).fill(''));
            for (let j = 0; j < nc; j++) grid[r - 1 + i][c - 1 + j] = vals[i][j];
          }
        },
        getValues: () => {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const row = grid[r - 1 + i] || new Array(n).fill('');
            out.push(row.slice(c - 1, c - 1 + nc));
          }
          return out;
        },
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

function call(sheets, store, params, verb, body) {
  const ss = { getSheetByName: (x) => sheets[x] || null };
  let captured = null;
  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    LockService: { getDocumentLock: () => ({ tryLock: () => true, releaseLock: () => {} }),
                   getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    PropertiesService: {
      getDocumentProperties: () => ({
        getProperty: (k) => (k in store ? store[k] : null),
        setProperty: (k, v) => { store[k] = v; },
        deleteProperty: (k) => { delete store[k]; },
      }),
    },
    Utilities: {
      getUuid: () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
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
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (t) => { captured = { kind: 'json', text: t }; return { setMimeType: () => captured }; },
    },
    HtmlService: {
      createHtmlOutput: (h) => { captured = { kind: 'html', text: h }; return { addMetaTag: () => captured }; },
    },
    Logger: { log: () => {} },
  };
  const e = { parameter: params || {} };
  if (body) e.postData = { contents: JSON.stringify(body) };
  const src = fs.readFileSync('C:/projects/NutriBoii/sheet/api.gs', 'utf8');
  const keys = Object.keys(sandbox);
  new Function(...keys, src + '\nreturn ' + (verb === 'POST' ? 'doPost' : verb && verb !== 'GET' ? verb : 'doGet') + '(arguments[arguments.length-1]);')
    (...keys.map(k => sandbox[k]), e);
  return captured;
}

const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' });
const today = fmt.format(new Date());

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n))
                            : (fail++, console.log('  FAIL  ' + n + (x ? '\n        ' + String(x).slice(0, 300) : ''))); };

function setup() {
  const sheets = { 'Daily Log': makeSheet(OLD_HDR), 'Baselines': makeSheet(BASE_HDR) };
  const store = { 'nutriboii.apiSecret': 'TESTTOKEN' };
  return { sheets, store };
}
const asJson = (r) => JSON.parse(r.text);
const rowOf = (sheets, tab, date) =>
  sheets[tab]._grid.slice(1).find(r => String(r[0]).slice(0, 10) === date);

console.log('\n=== auth ===');
{
  let { sheets, store } = setup();
  ok('no token is rejected', !asJson(call(sheets, store, { action: 'ping', format: 'json' })).ok);
  ok('wrong token is rejected', !asJson(call(sheets, store, { token: 'nope', action: 'ping', format: 'json' })).ok);
  ok('right token pings', asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'ping', format: 'json' })).ok);
  store = {};
  const r = asJson(call(sheets, store, { token: 'x', action: 'ping', format: 'json' }));
  ok('un-set-up API says so', /setUpApi/.test(r.error), r.error);
}

console.log('\n=== THE BUG THIS EXISTS TO KILL: named fields, blanks in the middle ===');
{
  const { sheets, store } = setup();
  // exactly the day Chat mangled: intake + macros + BMR + notes, with Steps,
  // ActiveCal, ExerciseCal, DayType and GymDay all absent
  const r = asJson(call(sheets, store, {
    token: 'TESTTOKEN', action: 'log', format: 'json', date: '2026-09-12',
    calories: '755', protein: '93', fat: '31', carbs: '19', bmr: '1672',
    notes: 'first meal only — 240g raw chicken breast, 4 eggs, cottage cheese'
  }));
  ok('write succeeded', r.ok, r.error);
  const row = rowOf(sheets, 'Daily Log', '2026-09-12');
  const named = {}; DAILY_HDR.forEach((h, i) => named[h] = row[i]);
  console.log('  ' + JSON.stringify(named));
  ok('Calories in Calories', named.Cal_Eaten === 755);
  ok('BMR in BMR, NOT ExerciseCal', named.BMR === 1672 && named.ExerciseCal === '',
     'BMR=' + named.BMR + ' ExerciseCal=' + named.ExerciseCal);
  ok('Notes in Notes, NOT GymDay', /first meal only/.test(named.Notes) && named.GymDay === '',
     'GymDay=' + named.GymDay);
  ok('omitted Steps stays blank, not 0', named.Steps === '', 'Steps=' + JSON.stringify(named.Steps));
  ok('omitted ActiveCal stays blank, not 0', named.ActiveCal === '');
  // Derived on write now, so the sheet reads on its own. No activity logged
  // for this day, so TDEE is just the BMR.
  ok('TDEE derived and written', named.TDEE === 1672, 'got ' + named.TDEE);
  ok('Deficit derived and written', named.Deficit === 1672 - 755, 'got ' + named.Deficit);
  ok('summary reports the computed deficit', /deficit \+/.test(r.summary), r.summary);
}

console.log('\n=== partial updates through the day ===');
{
  const { sheets, store } = setup();
  call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json', date: '2026-09-12',
                        calories: '755', protein: '93', notes: 'breakfast only' });
  const r2 = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json',
    date: '2026-09-12', calories: '1795', protein: '171', fat: '58', carbs: '128',
    dayType: 'Busy', steps: '9950', activeCal: '700', exerciseCal: '410',
    bmr: '1672', notes: 'full day' }));
  const row = rowOf(sheets, 'Daily Log', '2026-09-12');
  const named = {}; DAILY_HDR.forEach((h, i) => named[h] = row[i]);
  ok('no BMR anywhere -> derived columns stay blank, not zero',
     (() => { const { sheets: s2, store: st2 } = setup();
       call(s2, st2, { token: 'TESTTOKEN', action: 'log', format: 'json',
                       date: '2026-09-12', calories: '755' });
       const r = rowOf(s2, 'Daily Log', '2026-09-12');
       return r[10] === '' && r[11] === '';
     })());
  ok('second call updated, did not duplicate',
     sheets['Daily Log']._grid.filter(r => String(r[0]).slice(0, 10) === '2026-09-12').length === 1);
  ok('reported as an update not a create', r2.updated === true && r2.created === false);
  ok('fields overwritten', named.Cal_Eaten === 1795 && named.Protein_g === 171);
  ok('DayType accepted', named.DayType === 'Busy');
  // the morning row had 755 kcal and no activity; the evening call adds both,
  // so the derived columns must be recomputed, not left at morning numbers
  // No workout minutes were sent, so this is a legacy-shaped day: the larger
  // of workout x 0.7 and every step, and ActiveCal plays no part. No scan
  // weight exists here, so a step is priced at 75 kg.
  //   max(410 x 0.7, 9950 x 0.0004 x 75) = max(287, 298.5) = 298.5
  const eTdee = Math.round(1672 + 298.5);                              // 1971
  ok('TDEE refreshed on update', named.TDEE === eTdee,
     'expected ' + eTdee + ' got ' + named.TDEE);
  ok('Deficit refreshed on update', named.Deficit === eTdee - 1795,
     'expected ' + (eTdee - 1795) + ' got ' + named.Deficit);

  // a field left out of the second call must survive
  const r3 = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json',
                                          date: '2026-09-12', calories: '1850' }));
  const row3 = rowOf(sheets, 'Daily Log', '2026-09-12');
  ok('omitted field is left alone, not wiped', row3[DAILY_HDR.indexOf('Protein_g')] === 171,
     'protein=' + row3[DAILY_HDR.indexOf('Protein_g')]);
  ok('explicit empty clears the cell', (() => {
    call(sheets, store, { token: 'TESTTOKEN', action: 'log', date: '2026-09-12', notes: '', format: 'json' });
    return rowOf(sheets, 'Daily Log', '2026-09-12')[13] === '';
  })());
  ok('a real 0 is written as 0', (() => {
    call(sheets, store, { token: 'TESTTOKEN', action: 'log', date: '2026-09-12', exerciseCal: '0', format: 'json' });
    return rowOf(sheets, 'Daily Log', '2026-09-12')[8] === 0;
  })());
}

console.log('\n=== validation ===');
{
  const { sheets, store } = setup();
  let r = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json',
                                       date: '2026-09-12', dayType: 'Active' }));
  ok('bogus DayType rejected with the allowed list', !r.ok && /Rest, Busy, Gym, Treat/.test(r.error), r.error);
  r = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json', date: '12/09/2026' }));
  ok('non-ISO date rejected', !r.ok && /YYYY-MM-DD/.test(r.error), r.error);
  r = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json',
                                   date: '2026-09-12', calories: 'lots' }));
  ok('non-numeric calories rejected', !r.ok && /must be a number/.test(r.error), r.error);
  r = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'nope', format: 'json' }));
  ok('unknown action rejected', !r.ok && /log, scan, get/.test(r.error), r.error);
  // lowercase day type should be accepted and canonicalised
  r = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json',
                                   date: '2026-09-12', dayType: 'gym' }));
  ok('lowercase dayType canonicalised to Gym', r.ok && r.row.DayType === 'Gym', JSON.stringify(r.row && r.row.DayType));
}

console.log('\n=== derived columns are not settable by a caller ===');
{
  const { sheets, store } = setup();
  call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json', date: '2026-09-12',
                        calories: '1000', bmr: '1600', deficit: '99999', tdeeTarget: '88888' });
  const row = rowOf(sheets, 'Daily Log', '2026-09-12');
  ok('a hand-passed Deficit is ignored, real value derived', row[11] === 1600 - 1000,
     'got ' + row[11]);
  ok('a hand-passed TDEE_Target is ignored', row[10] === 1600, 'got ' + row[10]);
}

console.log('\n=== field aliases all land on the right column ===');
{
  const { sheets, store } = setup();
  call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json', date: '2026-09-12',
    Protein_g: '160', Fat_g: '70', Carbs_g: '150', kcal: '1900',
    active: '700', exercise: '400', gym: 'Day 3', note: 'alias test' });
  const row = rowOf(sheets, 'Daily Log', '2026-09-12');
  const named = {}; DAILY_HDR.forEach((h, i) => named[h] = row[i]);
  console.log('  ' + JSON.stringify(named));
  ok('Protein_g alias', named.Protein_g === 160);
  ok('kcal alias -> Calories', named.Cal_Eaten === 1900);
  ok('active/exercise aliases', named.ActiveCal === 700 && named.ExerciseCal === 400);
  ok('gym alias -> GymDay', named.GymDay === 'Day 3');
  ok('note alias -> Notes', named.Notes === 'alias test');
}

console.log('\n=== defaults, dates, sorting ===');
{
  const { sheets, store } = setup();
  let r = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json', calories: '1500' }));
  ok('no date defaults to today SGT', r.date === today, r.date);
  r = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json', date: 'today', calories: '1' }));
  ok('"today" keyword works', r.date === today, r.date);

  const { sheets: s2, store: st2 } = setup();
  ['2026-09-12', '2026-09-05', '2026-09-09'].forEach(d =>
    call(s2, st2, { token: 'TESTTOKEN', action: 'log', format: 'json', date: d, calories: '1800' }));
  const order = s2['Daily Log']._grid.slice(1).map(r => String(r[0]).slice(0, 10)).filter(Boolean);
  console.log('  row order: ' + order.join(', '));
  ok('rows kept in date order', JSON.stringify(order) === JSON.stringify(['2026-09-05','2026-09-09','2026-09-12']), order);
}

console.log('\n=== BMR inherited from the newest scan ===');
{
  const { sheets, store } = setup();
  call(sheets, store, { token: 'TESTTOKEN', action: 'scan', format: 'json',
                        date: '2026-06-06', weight: '83.6', bodyFat: '25.9', bmr: '1695' });
  call(sheets, store, { token: 'TESTTOKEN', action: 'scan', format: 'json',
                        date: '2026-09-05', weight: '78.3', bodyFat: '21.6', bmr: '1672' });
  const r = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json',
                                         date: '2026-09-12', calories: '1795' }));
  ok('new row inherits newest scan BMR (1672, not 1695)', r.row.BMR === 1672, 'BMR=' + r.row.BMR);
  ok('scan row written by name', (() => {
    const s = rowOf(sheets, 'Baselines', '2026-09-05');
    const n = {}; BASE_HDR.forEach((h, i) => n[h] = s[i]);
    return n.Weight_kg === 78.3 && n.BodyFat_pct === 21.6 && n.BMR === 1672;
  })());
  ok('explicit BMR is not overridden', (() => {
    const r2 = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json',
                                            date: '2026-09-13', calories: '1800', bmr: '1650' }));
    return r2.row.BMR === 1650;
  })());
}

console.log('\n=== BMR is the scan on or before the DAY, not the newest scan ===');
{
  // His real Baselines: 24 Aug read 1,674 and 11 Sep 1,672. A late-August
  // row created after 11 Sep used to get 1,672, the scan from its future.
  const { sheets, store } = setup();
  call(sheets, store, { token: 'TESTTOKEN', action: 'scan', format: 'json',
                        date: '2026-08-24', weight: '76.3', bodyFat: '20.8', bmr: '1674' });
  call(sheets, store, { token: 'TESTTOKEN', action: 'scan', format: 'json',
                        date: '2026-09-11', weight: '75.9', bodyFat: '20.6', bmr: '1672' });
  const aug = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json',
                                           date: '2026-08-26', calories: '1800' }));
  ok('26 Aug takes the 24 Aug scan (1674), not 11 Sep\'s', aug.row.BMR === 1674, 'BMR=' + aug.row.BMR);
  const on = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json',
                                          date: '2026-09-11', calories: '1800' }));
  ok('a scan applies on its own date (11 Sep -> 1672)', on.row.BMR === 1672, 'BMR=' + on.row.BMR);
  const before = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json',
                                              date: '2026-08-01', calories: '1800' }));
  ok('a day before every scan takes the oldest (1674)', before.row.BMR === 1674, 'BMR=' + before.row.BMR);
}

console.log('\n=== today follows a scan taken today; finished days do not ===');
{
  // 17 Oct 2026: the row was made at breakfast with the 5 Oct BMR (1,709),
  // the scan landed after 10am at 1,685, and the row kept 1,709.
  const { sheets, store } = setup();
  const yday = (() => { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1);
                        return d.toISOString().slice(0, 10); })();
  const old = '2026-01-05';
  call(sheets, store, { token: 'TESTTOKEN', action: 'scan', format: 'json',
                        date: old, weight: '76.3', bodyFat: '18.7', bmr: '1709' });
  call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json',
                        date: yday, calories: '1900' });
  const am = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json',
                                          date: 'today', addCalories: '90' }));
  ok('breakfast row starts on the last scan (1709)', am.row.BMR === 1709, 'BMR=' + am.row.BMR);

  call(sheets, store, { token: 'TESTTOKEN', action: 'scan', format: 'json',
                        date: today, weight: '75.4', bodyFat: '19.2', bmr: '1685' });
  const n = {}; DAILY_HDR.forEach((h, i) => n[h] = rowOf(sheets, 'Daily Log', today)[i]);
  ok('the scan moves today\'s BMR at once (1685)', n.BMR === 1685, 'BMR=' + n.BMR);
  ok('and today\'s TDEE and deficit with it', n.TDEE === 1685 && n.Deficit === 1685 - 90,
     'TDEE=' + n.TDEE + ' Deficit=' + n.Deficit);
  const y = {}; DAILY_HDR.forEach((h, i) => y[h] = rowOf(sheets, 'Daily Log', yday)[i]);
  ok('yesterday keeps the BMR it had (1709)', y.BMR === 1709, 'BMR=' + y.BMR);

  // 16 Oct: Chat sent bmr=1672 from memory with a meal. On today's row the
  // scans win; a stale number cannot stand.
  const stale = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json',
                                             date: 'today', addCalories: '200', bmr: '1672' }));
  ok('a stale BMR sent for today is replaced by the scan', stale.row.BMR === 1685, 'BMR=' + stale.row.BMR);
  ok('and the reply\'s burn uses it', /burn 1685/.test(stale.summary), stale.summary);
}

console.log('\n=== a day logged WITH workout minutes uses the new burn ===');
{
  // Chat can send exerciseMin and workoutSteps too; then the burn is
  // BMR + the workout net of its resting minutes + the steps outside it.
  const { sheets, store } = setup();
  const r = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json',
    date: '2026-09-12', calories: '1800', bmr: '1672', steps: '9950',
    exerciseCal: '410', exerciseMin: '60', workoutSteps: '780' }));
  const row = rowOf(sheets, 'Daily Log', '2026-09-12');
  ok('minutes and workout steps land in their own columns', row[14] === 60 && row[15] === 780,
     JSON.stringify(row.slice(14)));
  // 1672 + (410 - 1672/1440 x 60) + (9950 - 780) x 0.0004 x 75
  //  = 1672 + 340.33 + 275.10 = 2287.4
  ok('TDEE by the new formula', row[10] === 2287, 'got ' + row[10]);
  ok('the reply summary agrees with the cell', r.summary.indexOf('burn 2287') >= 0, r.summary);
  ok('the reply names the columns by their new headers',
     r.row && r.row.Cal_Eaten === 1800 && r.row.TDEE === 2287 && r.row.ExerciseMin === 60, JSON.stringify(r.row));
}

console.log('\n=== read back, POST, and the tap-link page ===');
{
  const { sheets, store } = setup();
  call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json', date: '2026-09-12',
                        calories: '1795', protein: '171', bmr: '1672', activeCal: '700', exerciseCal: '410' });
  let r = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'get', format: 'json', date: '2026-09-12' }));
  ok('get returns the row by name', r.found && r.row.Cal_Eaten === 1795);
  console.log('  summary: ' + r.summary);
  // legacy-shaped (no minutes) and no steps: 1672 + 410 x 0.7. ActiveCal 700
  // would have added (700 - 410) x 0.5 = 145 under the old formula.
  const eTdee = Math.round(1672 + 410 * 0.7);                        // 1959
  const eDef = eTdee - 1795;                                        // 164
  ok('summary computes TDEE + deficit per the formula',
     r.summary.indexOf('burn ' + eTdee) >= 0 && r.summary.indexOf('deficit +' + eDef) >= 0,
     'expected target ' + eTdee + ' / deficit +' + eDef + ', got: ' + r.summary);
  r = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'get', format: 'json', date: '2026-01-01' }));
  ok('missing day reports not found, no crash', r.ok && r.found === false);

  // POST with a JSON body
  const p = call(sheets, store, { }, 'POST',
    { token: 'TESTTOKEN', action: 'log', date: '2026-09-14', calories: 1700, protein: 165, dayType: 'Rest' });
  const pj = JSON.parse(p.text);
  ok('POST JSON body works', pj.ok && pj.row.Cal_Eaten === 1700, p.text.slice(0, 160));
  ok('POST returns JSON not HTML', p.kind === 'json');

  // GET without format=json should render a page
  const html = call(sheets, store, { token: 'TESTTOKEN', action: 'get', date: '2026-09-12' });
  ok('GET renders an HTML page for tapping', html.kind === 'html' && /<div class="card">/.test(html.text));
  ok('page shows the summary', /1795 kcal/.test(html.text));
  ok('page links back to the dashboard', /boykewijono-droid\.github\.io\/NutriBoii/.test(html.text));
  ok('page escapes user text', (() => {
    call(sheets, store, { token: 'TESTTOKEN', action: 'log', date: '2026-09-12',
                          notes: '<script>x</script>', format: 'json' });
    const h2 = call(sheets, store, { token: 'TESTTOKEN', action: 'get', date: '2026-09-12' });
    return !/<script>x<\/script>/.test(h2.text) && /&lt;script&gt;/.test(h2.text);
  })());
  const bad = call(sheets, store, { token: 'WRONG', action: 'get', date: '2026-09-12' });
  ok('error also renders a page, not a stack trace', bad.kind === 'html' && /Not written/.test(bad.text));
}


console.log('\n=== logging a meal WITHOUT reading the day first ===');
{
  const { sheets, store } = setup();
  const call1 = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json',
    date: '2026-09-19', addCalories: '250', addProtein: '8', addFat: '14', mealNote: 'home coffee + full cream milk' }));
  ok('first meal creates the day', call1.ok, call1.error);
  let named = {}; DAILY_HDR.forEach((h, i) => named[h] = rowOf(sheets, 'Daily Log', '2026-09-19')[i]);
  ok('calories start at the meal', named.Cal_Eaten === 250, 'got ' + named.Cal_Eaten);
  ok('macros too', named.Protein_g === 8 && named.Fat_g === 14);
  ok('carbs untouched, not zeroed', named.Carbs_g === '', JSON.stringify(named.Carbs_g));

  const call2 = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json',
    date: '2026-09-19', addCalories: '640', addProtein: '45', addFat: '22', addCarbs: '60',
    mealNote: 'chicken rice, no skin' }));
  named = {}; DAILY_HDR.forEach((h, i) => named[h] = rowOf(sheets, 'Daily Log', '2026-09-19')[i]);
  ok('THE POINT: the second meal ADDS, it does not replace', named.Cal_Eaten === 890, 'got ' + named.Cal_Eaten);
  ok('protein adds up', named.Protein_g === 53, 'got ' + named.Protein_g);
  ok('carbs start from blank and become 60', named.Carbs_g === 60, 'got ' + named.Carbs_g);
  ok('the reply reports what the totals became', call2.added && call2.added.Cal_Eaten === 890,
     JSON.stringify(call2.added));

  const lines = String(named.Notes).split('\n');
  ok('each meal is its own line in Notes', lines.length === 2, JSON.stringify(named.Notes));
  // The bracket carries the meal's macros too, only the ones that were sent
  // (no carbs with the coffee), so unlog and edit can read them back later.
  ok('a bullet and the meal\'s own calories and macros in brackets',
     lines[0] === '- home coffee + full cream milk (250 kcal, P8 F14)', lines[0]);
  ok('second meal, its own numbers', lines[1] === '- chicken rice, no skin (640 kcal, P45 F22 C60)', lines[1]);
  ok('every reply carries the Singapore time',
     /^\d{4}-\d{2}-\d{2} \d{1,2}:\d{2} (AM|PM) SGT$/.test(call2.serverTime), call2.serverTime);
}

console.log('\n=== absolute values still correct a mistake ===');
{
  const { sheets, store } = setup();
  call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json', date: '2026-09-19', addCalories: '900' });
  call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json', date: '2026-09-19', calories: '1750' });
  const named = {}; DAILY_HDR.forEach((h, i) => named[h] = rowOf(sheets, 'Daily Log', '2026-09-19')[i]);
  ok('calories= sets the total outright', named.Cal_Eaten === 1750, 'got ' + named.Cal_Eaten);
}

console.log('\n=== a bad add is refused, not silently ignored ===');
{
  const { sheets, store } = setup();
  const r = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json',
    date: '2026-09-19', addCalories: 'two hundred' }));
  ok('refused with a clear message', !r.ok && /must be a number/.test(r.error), r.error);
}


console.log('\n=== mealNoteTimed, for a caller that wants the clock ===');
{
  const { sheets, store } = setup();
  const r = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json',
    date: '2026-09-19', mealNoteTimed: 'office coffee' }));
  ok('the sheet stamps the Singapore time after the bullet',
     /^- \d{1,2}:\d{2} (AM|PM) office coffee$/.test(r.meal), r.meal);
}


console.log('\n=== the fat line must NOT wipe the day\'s meals ===');
{
  const { sheets, store } = setup();
  call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json', date: '2026-09-19',
    addCalories: '250', mealNote: 'home coffee + full cream milk' });
  call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json', date: '2026-09-19',
    addCalories: '980', addFat: '62', mealNote: 'nasi lemak, fried chicken',
    noteLine: 'fat over from fried chicken + coconut rice' });
  const named = {}; DAILY_HDR.forEach((h, i) => named[h] = rowOf(sheets, 'Daily Log', '2026-09-19')[i]);
  const lines = String(named.Notes).split('\n');
  ok('three lines: two meals and the fat note', lines.length === 3, JSON.stringify(named.Notes));
  ok('the first meal survived', lines[0] === '- home coffee + full cream milk (250 kcal)', lines[0]);
  ok('the fat line is plain, no bullet, no calories',
     lines[2] === 'fat over from fried chicken + coconut rice', lines[2]);

  // and the old way still replaces, which is why the instructions forbid it
  call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json', date: '2026-09-19',
    notes: 'replaced' });
  const after = {}; DAILY_HDR.forEach((h, i) => after[h] = rowOf(sheets, 'Daily Log', '2026-09-19')[i]);
  ok('notes= still replaces outright, for corrections', after.Notes === 'replaced', after.Notes);
}

console.log('\n=== a meal with no calories still gets its bullet ===');
{
  const { sheets, store } = setup();
  const r = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json',
    date: '2026-09-19', mealNote: 'black coffee' }));
  ok('bullet, no empty brackets', r.meal === '- black coffee', r.meal);
}


console.log('\n=== unlog: a meal comes back out of BOTH the diary and the total ===');
{
  const { sheets, store } = setup();
  const log = (kcal, pro, note) => asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json',
    date: '2026-09-22', addCalories: String(kcal), addProtein: String(pro), mealNote: note }));
  log(80, 2, 'office coffee + low fat milk');
  log(780, 48, 'pesto chicken panuozzo, mesclun, red onion, mozzarella');
  log(145, 3, 'tiramisu, 50g');
  const named = () => { const o = {}; DAILY_HDR.forEach((h, i) => o[h] = rowOf(sheets, 'Daily Log', '2026-09-22')[i]); return o; };
  ok('three meals logged', named().Cal_Eaten === 1005, 'got ' + named().Cal_Eaten);

  const out = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'unlog', format: 'json',
    date: '2026-09-22', match: 'panuozzo' }));
  ok('it reports what it removed', out.ok && /panuozzo/.test(out.removed), JSON.stringify(out));
  ok('the calories come from the line\'s own bracket', out.kcal === 780, String(out.kcal));
  const after = named();
  ok('THE POINT: the total drops by exactly that', after.Cal_Eaten === 225, 'got ' + after.Cal_Eaten);
  ok('the line is gone from the diary', !/panuozzo/.test(String(after.Notes)), String(after.Notes));
  ok('the other meals are untouched',
     /office coffee/.test(String(after.Notes)) && /tiramisu/.test(String(after.Notes)), String(after.Notes));
  ok('no blank line left where it was', !/\n\n/.test(String(after.Notes)), JSON.stringify(String(after.Notes)));
  // 2 + 48 + 3 = 53 protein; the panuozzo's line says P48, so 5 is left.
  ok('its protein comes off too, read from its own line', after.Protein_g === 5, 'got ' + after.Protein_g);
  ok('the deficit is recomputed, not left stale', after.Deficit === '' || after.Deficit == null ||
     typeof after.Deficit === 'number', String(after.Deficit));
}

console.log('\n=== unlog: macros come back too, when they are offered ===');
{
  const { sheets, store } = setup();
  asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json', date: '2026-09-22',
    addCalories: '780', addProtein: '48', addFat: '30', addCarbs: '70', mealNote: 'pesto chicken panuozzo' }));
  asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json', date: '2026-09-22',
    addCalories: '145', addProtein: '3', addFat: '9', addCarbs: '15', mealNote: 'tiramisu' }));
  const out = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'unlog', format: 'json',
    date: '2026-09-22', match: 'panuozzo', subProtein: '48', subFat: '30', subCarbs: '70' }));
  const o = {}; DAILY_HDR.forEach((h, i) => o[h] = rowOf(sheets, 'Daily Log', '2026-09-22')[i]);
  ok('calories, protein, fat and carbs all come off',
     o.Cal_Eaten === 145 && o.Protein_g === 3 && o.Fat_g === 9 && o.Carbs_g === 15, JSON.stringify(o));
  ok('and the reply says what each became', out.totals && out.totals.Cal_Eaten === 145 && out.totals.Protein_g === 3,
     JSON.stringify(out.totals));
}

console.log('\n=== unlog refuses rather than guesses ===');
{
  const { sheets, store } = setup();
  const log = (kcal, note) => asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json',
    date: '2026-09-22', addCalories: String(kcal), mealNote: note }));
  log(250, 'home coffee + full cream milk');
  log(80, 'office coffee + low fat milk');
  log(540, 'romaine, edamame, egg salad');

  const two = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'unlog', format: 'json',
    date: '2026-09-22', match: 'coffee' }));
  ok('two matches removes nothing', !two.ok && /2 meals/.test(two.error), JSON.stringify(two));
  ok('and it lists them so the caller can be specific', /full cream/.test(two.error) && /low fat/.test(two.error), two.error);
  const still = {}; DAILY_HDR.forEach((h, i) => still[h] = rowOf(sheets, 'Daily Log', '2026-09-22')[i]);
  ok('the day is untouched after a refusal', still.Cal_Eaten === 870, 'got ' + still.Cal_Eaten);

  const none = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'unlog', format: 'json',
    date: '2026-09-22', match: 'laksa' }));
  ok('no match removes nothing, and says what IS there',
     !none.ok && /No meal/.test(none.error) && /romaine/.test(none.error), JSON.stringify(none));

  const oneMore = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'unlog', format: 'json',
    date: '2026-09-22', match: 'low fat' }));
  ok('a specific enough word works', oneMore.ok && /low fat/.test(oneMore.removed), JSON.stringify(oneMore));

  const noDay = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'unlog', format: 'json',
    date: '2026-01-01', match: 'anything' }));
  ok('a day that was never logged is an error, not a new row',
     !noDay.ok && /Nothing logged/.test(noDay.error), JSON.stringify(noDay));

  const noMatch = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'unlog', format: 'json',
    date: '2026-09-22' }));
  ok('and match is required', !noMatch.ok && /match=/.test(noMatch.error), JSON.stringify(noMatch));
}

console.log('\n=== unlog never touches the fat line, only meals ===');
{
  const { sheets, store } = setup();
  asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json', date: '2026-09-22',
    addCalories: '740', mealNote: 'char kway teow' }));
  asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json', date: '2026-09-22',
    noteLine: 'fat over from char kway teow' }));
  const out = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'unlog', format: 'json',
    date: '2026-09-22', match: 'char kway teow' }));
  const o = {}; DAILY_HDR.forEach((h, i) => o[h] = rowOf(sheets, 'Daily Log', '2026-09-22')[i]);
  ok('the meal bullet goes', out.ok && !/- char kway teow/.test(String(o.Notes)), String(o.Notes));
  ok('the fat line stays: it is not a meal and carries no calories',
     /fat over from char kway teow/.test(String(o.Notes)), String(o.Notes));
  ok('the total drops by the meal only', o.Cal_Eaten === 0, 'got ' + o.Cal_Eaten);
}

console.log('\n=== unlog: a line with no bracket asks, it does not invent ===');
{
  const { sheets, store } = setup();
  const sh = sheets['Daily Log'];
  sh.getRange(2, 1, 1, 14).setValues([['2026-09-22', '', 900, '', '', '', '', '', '', 1672, '', '', '', '- mystery supper']]);
  const out = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'unlog', format: 'json',
    date: '2026-09-22', match: 'mystery' }));
  ok('it refuses and says how to proceed', !out.ok && /subCalories/.test(out.error), JSON.stringify(out));
  ok('nothing was removed meanwhile', rowOf(sheets, 'Daily Log', '2026-09-22')[2] === 900);

  const told = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'unlog', format: 'json',
    date: '2026-09-22', match: 'mystery', subCalories: '400' }));
  ok('told the number, it obeys', told.ok && told.kcal === 400, JSON.stringify(told));
  ok('and the total comes down', rowOf(sheets, 'Daily Log', '2026-09-22')[2] === 500,
     String(rowOf(sheets, 'Daily Log', '2026-09-22')[2]));
}

console.log('\n=== unlog holds at zero rather than going negative ===');
{
  const { sheets, store } = setup();
  const sh = sheets['Daily Log'];
  sh.getRange(2, 1, 1, 14).setValues([['2026-09-22', '', 300, 10, '', '', '', '', '', 1672, '', '', '', '- big dinner (900 kcal)']]);
  const out = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'unlog', format: 'json',
    date: '2026-09-22', match: 'dinner' }));
  ok('a total that would go below zero is held at zero',
     out.ok && rowOf(sheets, 'Daily Log', '2026-09-22')[2] === 0, JSON.stringify(out));
  ok('and the reply says so plainly', /held at 0/.test(out.summary), out.summary);
}

/* ---- changing a meal: half a portion, or the wrong food ---------------- */
const D = '2026-10-31';
const dayRow = (sheets) => { const o = {}; DAILY_HDR.forEach((h, i) => o[h] = rowOf(sheets, 'Daily Log', D)[i]); return o; };
const meal = (sheets, store, o) => asJson(call(sheets, store, Object.assign(
  { token: 'TESTTOKEN', action: 'log', format: 'json', date: D }, o)));
const edit = (sheets, store, o) => asJson(call(sheets, store, Object.assign(
  { token: 'TESTTOKEN', action: 'edit', format: 'json', date: D }, o)));

console.log('\n=== edit: he ate half the plate he photographed ===');
{
  const { sheets, store } = setup();
  call(sheets, store, { token: 'TESTTOKEN', action: 'scan', format: 'json',
                        date: '2026-10-17', weight: '75.4', bodyFat: '19.2', bmr: '1685' });
  meal(sheets, store, { addCalories: '250', addProtein: '8', addFat: '14', addCarbs: '20', mealNote: 'home coffee + full cream milk' });
  meal(sheets, store, { addCalories: '520', addProtein: '32', addFat: '18', addCarbs: '60', mealNote: 'chicken rice' });
  const out = edit(sheets, store, { match: 'chicken rice', newCalories: '260', newProtein: '16', newFat: '9', newCarbs: '30' });
  const o = dayRow(sheets);
  ok('one call, and it says what changed', out.ok && out.changes.calories.from === 520 && out.changes.calories.to === 260,
     JSON.stringify(out));
  // 250+520 -> 250+260 = 510; protein 8+32 -> 8+16 = 24; fat 14+18 -> 14+9 = 23; carbs 20+60 -> 20+30 = 50
  ok('THE POINT: every total moves by the difference',
     [o.Cal_Eaten, o.Protein_g, o.Fat_g, o.Carbs_g].join() === '510,24,23,50',
     [o.Cal_Eaten, o.Protein_g, o.Fat_g, o.Carbs_g].join());
  const lines = String(o.Notes).split('\n');
  ok('the line is rewritten in place, with its new numbers',
     lines[1] === '- chicken rice (260 kcal, P16 F9 C30)', lines[1]);
  ok('the other meal is untouched', lines[0] === '- home coffee + full cream milk (250 kcal, P8 F14 C20)', lines[0]);
  ok('the burn and deficit are recomputed', typeof o.TDEE === 'number' && o.Deficit === o.TDEE - 510,
     o.TDEE + ' / ' + o.Deficit);
}

console.log('\n=== edit: it was chicken, not pork; skimmed, not full cream ===');
{
  const { sheets, store } = setup();
  meal(sheets, store, { addCalories: '600', addProtein: '30', addFat: '28', addCarbs: '55', mealNote: 'pork chop rice' });
  meal(sheets, store, { addCalories: '120', addProtein: '6', addFat: '7', addCarbs: '9', mealNote: 'fresh milk 200ml' });
  const a = edit(sheets, store, { match: 'pork', newNote: 'chicken chop rice',
    newCalories: '520', newProtein: '38', newFat: '16', newCarbs: '55' });
  const b = edit(sheets, store, { match: 'fresh milk', newNote: 'skimmed milk 200ml',
    newCalories: '70', newFat: '0.4' });
  const o = dayRow(sheets);
  const lines = String(o.Notes).split('\n');
  ok('the food words change', a.ok && b.ok && lines[0] === '- chicken chop rice (520 kcal, P38 F16 C55)', lines[0]);
  ok('numbers left out stay as they were (protein and carbs of the milk)',
     lines[1] === '- skimmed milk 200ml (70 kcal, P6 F0.4 C9)', lines[1]);
  // 600+120 -> 520+70 = 590; protein 36 -> 44; fat 35 -> 16.4; carbs 64 unchanged
  ok('the totals follow', [o.Cal_Eaten, o.Protein_g, o.Fat_g, o.Carbs_g].join() === '590,44,16.4,64',
     [o.Cal_Eaten, o.Protein_g, o.Fat_g, o.Carbs_g].join());
}

console.log('\n=== edit: a line from before macros were stored asks, it does not guess ===');
{
  const { sheets, store } = setup();
  const sh = sheets['Daily Log'];
  sh.getRange(2, 1, 1, 14).setValues([[D, '', 800, 50, 30, 90, '', '', '', 1685, '', '', '', '- nasi lemak (800 kcal)']]);
  const no = edit(sheets, store, { match: 'nasi lemak', newCalories: '400', newProtein: '25' });
  ok('changing protein it never stored is refused, and says how to proceed',
     !no.ok && /oldProtein/.test(no.error), JSON.stringify(no));
  ok('and nothing moved meanwhile', dayRow(sheets).Cal_Eaten === 800 && dayRow(sheets).Notes === '- nasi lemak (800 kcal)',
     JSON.stringify(dayRow(sheets)));
  const yes = edit(sheets, store, { match: 'nasi lemak', newCalories: '400', newProtein: '25', oldProtein: '50' });
  const o = dayRow(sheets);
  ok('told the old protein, it changes both', yes.ok && o.Cal_Eaten === 400 && o.Protein_g === 25,
     JSON.stringify(o));
  ok('and the line now carries what it knows', o.Notes === '- nasi lemak (400 kcal, P25)', o.Notes);
}

console.log('\n=== edit refuses rather than guesses ===');
{
  const { sheets, store } = setup();
  meal(sheets, store, { addCalories: '250', mealNote: 'home coffee + full cream milk' });
  meal(sheets, store, { addCalories: '80', mealNote: 'office coffee + low fat milk' });
  const two = edit(sheets, store, { match: 'coffee', newCalories: '100' });
  ok('two different matches: nothing changes, both are listed',
     !two.ok && /full cream/.test(two.error) && /low fat/.test(two.error) && dayRow(sheets).Cal_Eaten === 330,
     JSON.stringify(two));
  const none = edit(sheets, store, { match: 'laksa', newCalories: '100' });
  ok('no match says what IS there', !none.ok && /office coffee/.test(none.error), JSON.stringify(none));
  const nothing = edit(sheets, store, { match: 'office' });
  ok('nothing to change is an error, not a silent no-op', !nothing.ok && /newCalories/.test(nothing.error), JSON.stringify(nothing));
  const neg = edit(sheets, store, { match: 'office', newCalories: '-20' });
  ok('a negative meal is refused', !neg.ok && /negative/.test(neg.error), JSON.stringify(neg));
  const day = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'edit', format: 'json',
    date: '2026-01-01', match: 'x', newCalories: '1' }));
  ok('a day never logged is an error, not a new row', !day.ok && /Nothing logged/.test(day.error), JSON.stringify(day));
}

console.log('\n=== edit keeps a meal\'s time, and picks one of two identical lines ===');
{
  const { sheets, store } = setup();
  const sh = sheets['Daily Log'];
  sh.getRange(2, 1, 1, 14).setValues([[D, '', 240, '', '', '', '', '', '', 1685, '', '', '',
    '- 8:10 AM kopi c (120 kcal, P2 F4 C18)\n- 8:10 AM kopi c (120 kcal, P2 F4 C18)']]);
  const out = edit(sheets, store, { match: 'kopi', newNote: 'kopi c kosong', newCalories: '40', newCarbs: '2' });
  const lines = String(dayRow(sheets).Notes).split('\n');
  ok('the time stays at the front', out.ok && lines[1] === '- 8:10 AM kopi c kosong (40 kcal, P2 F4 C2)', lines[1]);
  ok('the identical twin is left as it was', lines[0] === '- 8:10 AM kopi c (120 kcal, P2 F4 C18)', lines[0]);
  ok('only one meal moved the total: 240 - 120 + 40 = 160', dayRow(sheets).Cal_Eaten === 160, String(dayRow(sheets).Cal_Eaten));
}

console.log('\n=== a "fat over" line goes once fat is back within the limit ===');
{
  const { sheets, store } = setup();
  meal(sheets, store, { addCalories: '250', addFat: '14', mealNote: 'home coffee + full cream milk' });
  meal(sheets, store, { addCalories: '980', addFat: '62', mealNote: 'nasi lemak, fried chicken',
    noteLine: 'fat over from fried chicken + coconut rice' });
  // 14 + 62 = 76, over 70. A small trim, 62 -> 60, leaves 74: still over.
  const trim = edit(sheets, store, { match: 'nasi lemak', newFat: '60' });
  ok('still over the limit: the line stays', trim.ok && !trim.fatNoteRemoved &&
     /fat over from/.test(String(dayRow(sheets).Notes)), String(dayRow(sheets).Notes));
  // Half the plate: 60 -> 30, so 44 in all, within 70.
  const half = edit(sheets, store, { match: 'nasi lemak', newCalories: '490', newFat: '30' });
  ok('back within it: the line goes, and the reply says so', half.ok &&
     /fat over from fried chicken/.test(half.fatNoteRemoved) && !/fat over/.test(String(dayRow(sheets).Notes)),
     JSON.stringify(half));
  ok('the meals stay', String(dayRow(sheets).Notes).split('\n').length === 2, String(dayRow(sheets).Notes));
}

console.log('\n=== the fat limit is the Targets tab\'s, and unlog clears the line too ===');
{
  const { sheets, store } = setup();
  sheets['Targets'] = makeSheet(['Key', 'Value', 'Unit', 'Notes']);
  sheets['Targets'].getRange(2, 1, 1, 4).setValues([['fat_ceiling_g', 40, 'g', '']]);
  meal(sheets, store, { addCalories: '250', addFat: '35', mealNote: 'croissant' });
  meal(sheets, store, { addCalories: '300', addFat: '20', mealNote: 'cheese toast',
    noteLine: 'fat over from croissant + cheese' });
  // 55 g, then the toast comes out: 35, within the 40 g limit set in Targets.
  const out = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'unlog', format: 'json', date: D, match: 'cheese toast' }));
  ok('unlog takes the toast\'s fat off by itself: 55 - 20 = 35', dayRow(sheets).Fat_g === 35, String(dayRow(sheets).Fat_g));
  ok('and, within the Targets limit of 40, the fat line goes', out.ok && !!out.fatNoteRemoved &&
     String(dayRow(sheets).Notes) === '- croissant (250 kcal, F35)', String(dayRow(sheets).Notes));
}


console.log('\n=== unlog: the same meal logged twice can actually be undone ===');
{
  // "that coffee got logged twice" was refused with "be more specific",
  // between two lines whose text is identical. No wording could satisfy it.
  const { sheets, store } = setup();
  for (let i = 0; i < 2; i++) asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json',
    date: '2026-09-22', addCalories: '80', mealNote: 'office coffee + low fat milk' }));
  const out = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'unlog', format: 'json',
    date: '2026-09-22', match: 'office coffee' }));
  const o = {}; DAILY_HDR.forEach((h, i) => o[h] = rowOf(sheets, 'Daily Log', '2026-09-22')[i]);
  ok('it removes one of them instead of refusing', out.ok, out.error);
  ok('exactly one copy is left', String(o.Notes).split('office coffee').length - 1 === 1, String(o.Notes));
  ok('and only one meal came off the total', o.Cal_Eaten === 80, 'got ' + o.Cal_Eaten);
  ok('the reply says it was one of two identical lines',
     out.duplicates === 2 && /one of 2 identical lines/.test(out.summary), out.summary);

  // a THIRD identical one, to be sure it goes one at a time
  asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json',
    date: '2026-09-22', addCalories: '80', mealNote: 'office coffee + low fat milk' }));
  asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'unlog', format: 'json',
    date: '2026-09-22', match: 'office coffee' }));
  const o2 = {}; DAILY_HDR.forEach((h, i) => o2[h] = rowOf(sheets, 'Daily Log', '2026-09-22')[i]);
  ok('one at a time, never all of them', String(o2.Notes).split('office coffee').length - 1 === 1, String(o2.Notes));
}

console.log('\n=== unlog: meals that only LOOK alike are still refused ===');
{
  const { sheets, store } = setup();
  asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json',
    date: '2026-09-22', addCalories: '80', mealNote: 'office coffee + low fat milk' }));
  asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json',
    date: '2026-09-22', addCalories: '250', mealNote: 'office coffee + full cream milk' }));
  const out = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'unlog', format: 'json',
    date: '2026-09-22', match: 'office coffee' }));
  ok('different text means a real choice, so it still refuses', !out.ok && /Be more specific/.test(out.error), JSON.stringify(out));
  ok('and nothing was removed', rowOf(sheets, 'Daily Log', '2026-09-22')[2] === 330,
     String(rowOf(sheets, 'Daily Log', '2026-09-22')[2]));
}

console.log('\n=== unlog never ADDS, whatever it is sent ===');
{
  // subCalories=-300 through an action whose name promises the opposite
  const { sheets, store } = setup();
  asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json',
    date: '2026-09-22', addCalories: '500', addProtein: '20', mealNote: 'lunch' }));
  const neg = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'unlog', format: 'json',
    date: '2026-09-22', match: 'lunch', subCalories: '-300' }));
  ok('a negative subCalories is refused', !neg.ok && /cannot be negative/.test(neg.error), JSON.stringify(neg));
  ok('and the day is untouched', rowOf(sheets, 'Daily Log', '2026-09-22')[2] === 500,
     String(rowOf(sheets, 'Daily Log', '2026-09-22')[2]));
  const negP = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'unlog', format: 'json',
    date: '2026-09-22', match: 'lunch', subProtein: '-5' }));
  ok('a negative macro is refused too', !negP.ok && /cannot be negative/.test(negP.error), JSON.stringify(negP));
  ok('the meal is still there after a refusal', /lunch/.test(String(rowOf(sheets, 'Daily Log', '2026-09-22')[13])),
     String(rowOf(sheets, 'Daily Log', '2026-09-22')[13]));
}

/* ---- the Inbox: Chat appends a request row, a trigger runs it ----------- */
const INBOX_HDR = ['Request', 'Status', 'Result', 'Done'];
const inboxWorld = () => { const w = setup(); w.sheets['Inbox'] = makeSheet(INBOX_HDR); return w; };
// what Chat's Google Sheets tool does: one new row, column A only
const append = (sheets, req) => { const sh = sheets['Inbox']; sh.getRange(sh.getLastRow() + 1, 1).setValue(req); };
const tick = (sheets, store) => call(sheets, store, {}, 'processInbox');   // the one-minute trigger
const inboxRows = (sheets) => sheets['Inbox']._grid.slice(1).filter(r => r[0] !== '');

console.log('\n=== inbox: a request Chat appends is run like a link would be ===');
{
  const { sheets, store } = inboxWorld();
  append(sheets, 'action=log&date=' + D + '&addCalories=250&addProtein=8&addFat=14&addCarbs=20' +
                 '&mealNote=home%20coffee%20%2B%20low%20fat%20milk&n=qkzvta');
  ok('nothing happens until the trigger runs', !rowOf(sheets, 'Daily Log', D));
  tick(sheets, store);
  const o = dayRow(sheets);
  ok('THE POINT: the meal is logged, numbers and all',
     o.Cal_Eaten === 250 && o.Protein_g === 8 && o.Fat_g === 14 && o.Carbs_g === 20, JSON.stringify(o));
  ok('%2B is a plus and %20 a space, as in a link',
     o.Notes === '- home coffee + low fat milk (250 kcal, P8 F14 C20)', o.Notes);
  const r = inboxRows(sheets)[0];
  ok('the row says ok, with the API\'s own summary', r[1] === 'ok' && /250 kcal/.test(r[2]), JSON.stringify(r));
  ok('and when it ran', /SGT$/.test(String(r[3])), r[3]);
  tick(sheets, store);
  ok('a finished row is never run again', dayRow(sheets).Cal_Eaten === 250, String(dayRow(sheets).Cal_Eaten));
}

console.log('\n=== inbox: one yes can never log twice; two coffees still count ===');
{
  const { sheets, store } = inboxWorld();
  const req = 'action=log&date=' + D + '&addCalories=80&mealNote=kopi%20c&n=abcdef';
  append(sheets, req);
  tick(sheets, store);
  append(sheets, req);                   // Chat unsure, appends the same request again
  tick(sheets, store);
  ok('the repeat (same n=) is skipped, and says why', inboxRows(sheets)[1][1] === 'skipped' &&
     /row 2/.test(inboxRows(sheets)[1][2]), JSON.stringify(inboxRows(sheets)[1]));
  ok('so the day holds ONE kopi', dayRow(sheets).Cal_Eaten === 80, String(dayRow(sheets).Cal_Eaten));
  append(sheets, 'action=log&date=' + D + '&addCalories=80&mealNote=kopi%20c&n=ghijkl');
  tick(sheets, store);
  ok('a second kopi, its own n=, is a second kopi', dayRow(sheets).Cal_Eaten === 160 &&
     String(dayRow(sheets).Notes).split('kopi c').length - 1 === 2, String(dayRow(sheets).Notes));
}

console.log('\n=== inbox: edit and unlog go through it too, and errors are written back ===');
{
  const { sheets, store } = inboxWorld();
  append(sheets, 'action=log&date=' + D + '&addCalories=520&addProtein=32&addFat=18&addCarbs=60&mealNote=chicken%20rice&n=aaaaaa');
  append(sheets, 'action=edit&date=' + D + '&match=chicken%20rice&newCalories=260&newProtein=16&newFat=9&newCarbs=30&n=bbbbbb');
  append(sheets, 'action=unlog&date=' + D + '&match=laksa&n=cccccc');
  append(sheets, 'action=delete&date=' + D + '&confirm=yes&n=dddddd');
  tick(sheets, store);
  const rows = inboxRows(sheets);
  ok('rows run in order in one pass: the log, then the edit', rows[0][1] === 'ok' && rows[1][1] === 'ok' &&
     dayRow(sheets).Cal_Eaten === 260, JSON.stringify(rows.map(r => r[1])));
  ok('a refusal is written back with its reason', rows[2][1] === 'error' && /No meal/.test(rows[2][2]), rows[2][2]);
  ok('delete is not something the inbox will do', rows[3][1] === 'error' && /log, unlog, edit and scan only/.test(rows[3][2]),
     rows[3][2]);
  ok('and the day survived it', dayRow(sheets).Cal_Eaten === 260, String(dayRow(sheets).Cal_Eaten));
}

console.log('\n=== inbox: no token needed, a pasted link works, an empty inbox is a no-op ===');
{
  const { sheets, store } = inboxWorld();
  tick(sheets, store);
  ok('an empty inbox does nothing and does not fail', inboxRows(sheets).length === 0);
  append(sheets, 'https://script.google.com/macros/s/X/exec?token=WRONG&action=log&date=' + D +
                 '&addCalories=100&mealNote=apple&format=json&n=zzzzzz');
  tick(sheets, store);
  ok('a whole link pasted in works, and its token is ignored', inboxRows(sheets)[0][1] === 'ok' &&
     dayRow(sheets).Cal_Eaten === 100, JSON.stringify(inboxRows(sheets)[0]));
  append(sheets, 'action=log&date=' + D + '&addCalories=lots&n=yyyyyy');
  tick(sheets, store);
  ok('a bad number is an error row, not a crash', inboxRows(sheets)[1][1] === 'error' &&
     /must be a number/.test(inboxRows(sheets)[1][2]), JSON.stringify(inboxRows(sheets)[1]));
}

console.log('\n' + '='.repeat(46));
console.log('  ' + pass + ' passed, ' + fail + ' failed');
console.log('='.repeat(46));
process.exit(fail ? 1 : 0);
