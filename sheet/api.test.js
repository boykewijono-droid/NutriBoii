/* Mock harness for api.gs. The point of this API is that named fields cannot
   land in the wrong column, so that is what most of these assert. */
const fs = require('fs');

const DAILY_HDR = ['Date','DayType','Calories','Protein_g','Fat_g','Carbs_g','Steps',
  'ActiveCal','ExerciseCal','BMR','TDEE_Target','Deficit','GymDay','Notes'];
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
    LockService: { getDocumentLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
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
  new Function(...keys, src + '\nreturn ' + (verb === 'POST' ? 'doPost' : 'doGet') + '(arguments[arguments.length-1]);')
    (...keys.map(k => sandbox[k]), e);
  return captured;
}

const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' });
const today = fmt.format(new Date());

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n))
                            : (fail++, console.log('  FAIL  ' + n + (x ? '\n        ' + String(x).slice(0, 300) : ''))); };

function setup() {
  const sheets = { 'Daily Log': makeSheet(DAILY_HDR), 'Baselines': makeSheet(BASE_HDR) };
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
  ok('Calories in Calories', named.Calories === 755);
  ok('BMR in BMR, NOT ExerciseCal', named.BMR === 1672 && named.ExerciseCal === '',
     'BMR=' + named.BMR + ' ExerciseCal=' + named.ExerciseCal);
  ok('Notes in Notes, NOT GymDay', /first meal only/.test(named.Notes) && named.GymDay === '',
     'GymDay=' + named.GymDay);
  ok('omitted Steps stays blank, not 0', named.Steps === '', 'Steps=' + JSON.stringify(named.Steps));
  ok('omitted ActiveCal stays blank, not 0', named.ActiveCal === '');
  // Derived on write now, so the sheet reads on its own. No activity logged
  // for this day, so TDEE is just the BMR.
  ok('TDEE_Target derived and written', named.TDEE_Target === 1672, 'got ' + named.TDEE_Target);
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
  ok('fields overwritten', named.Calories === 1795 && named.Protein_g === 171);
  ok('DayType accepted', named.DayType === 'Busy');
  // the morning row had 755 kcal and no activity; the evening call adds both,
  // so the derived columns must be recomputed, not left at morning numbers
  const eTdee = Math.round(1672 + 410 * 0.7 + (700 - 410) * 0.5);
  ok('TDEE_Target refreshed on update', named.TDEE_Target === eTdee,
     'expected ' + eTdee + ' got ' + named.TDEE_Target);
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
  ok('kcal alias -> Calories', named.Calories === 1900);
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

console.log('\n=== read back, POST, and the tap-link page ===');
{
  const { sheets, store } = setup();
  call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json', date: '2026-09-12',
                        calories: '1795', protein: '171', bmr: '1672', activeCal: '700', exerciseCal: '410' });
  let r = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'get', format: 'json', date: '2026-09-12' }));
  ok('get returns the row by name', r.found && r.row.Calories === 1795);
  console.log('  summary: ' + r.summary);
  // derive the expectation from the agreed formula rather than a magic number
  const eTdee = Math.round(1672 + 410 * 0.7 + (700 - 410) * 0.5);   // 2104
  const eDef = eTdee - 1795;                                        // 309
  ok('summary computes TDEE + deficit per the formula',
     r.summary.indexOf('burn ' + eTdee) >= 0 && r.summary.indexOf('deficit +' + eDef) >= 0,
     'expected target ' + eTdee + ' / deficit +' + eDef + ', got: ' + r.summary);
  r = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'get', format: 'json', date: '2026-01-01' }));
  ok('missing day reports not found, no crash', r.ok && r.found === false);

  // POST with a JSON body
  const p = call(sheets, store, { }, 'POST',
    { token: 'TESTTOKEN', action: 'log', date: '2026-09-14', calories: 1700, protein: 165, dayType: 'Rest' });
  const pj = JSON.parse(p.text);
  ok('POST JSON body works', pj.ok && pj.row.Calories === 1700, p.text.slice(0, 160));
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
  ok('calories start at the meal', named.Calories === 250, 'got ' + named.Calories);
  ok('macros too', named.Protein_g === 8 && named.Fat_g === 14);
  ok('carbs untouched, not zeroed', named.Carbs_g === '', JSON.stringify(named.Carbs_g));

  const call2 = asJson(call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json',
    date: '2026-09-19', addCalories: '640', addProtein: '45', addFat: '22', addCarbs: '60',
    mealNote: 'chicken rice, no skin' }));
  named = {}; DAILY_HDR.forEach((h, i) => named[h] = rowOf(sheets, 'Daily Log', '2026-09-19')[i]);
  ok('THE POINT: the second meal ADDS, it does not replace', named.Calories === 890, 'got ' + named.Calories);
  ok('protein adds up', named.Protein_g === 53, 'got ' + named.Protein_g);
  ok('carbs start from blank and become 60', named.Carbs_g === 60, 'got ' + named.Carbs_g);
  ok('the reply reports what the totals became', call2.added && call2.added.Calories === 890,
     JSON.stringify(call2.added));

  const lines = String(named.Notes).split('\n');
  ok('each meal is its own line in Notes', lines.length === 2, JSON.stringify(named.Notes));
  ok('the food alone: no time, no title', lines[0] === 'home coffee + full cream milk', lines[0]);
  ok('second line is the second meal', lines[1] === 'chicken rice, no skin', lines[1]);
  ok('every reply carries the Singapore time',
     /^\d{4}-\d{2}-\d{2} \d{1,2}:\d{2} (AM|PM) SGT$/.test(call2.serverTime), call2.serverTime);
}

console.log('\n=== absolute values still correct a mistake ===');
{
  const { sheets, store } = setup();
  call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json', date: '2026-09-19', addCalories: '900' });
  call(sheets, store, { token: 'TESTTOKEN', action: 'log', format: 'json', date: '2026-09-19', calories: '1750' });
  const named = {}; DAILY_HDR.forEach((h, i) => named[h] = rowOf(sheets, 'Daily Log', '2026-09-19')[i]);
  ok('calories= sets the total outright', named.Calories === 1750, 'got ' + named.Calories);
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
  ok('the sheet stamps the Singapore time in front',
     /^\d{1,2}:\d{2} (AM|PM) office coffee$/.test(r.meal), r.meal);
}

console.log('\n' + '='.repeat(46));
console.log('  ' + pass + ' passed, ' + fail + ' failed');
console.log('='.repeat(46));
process.exit(fail ? 1 : 0);
