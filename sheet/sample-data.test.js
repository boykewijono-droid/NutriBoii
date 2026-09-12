/* Mock harness for sample-data.gs: proves seed writes the right rows with the
   right gaps, and that clear removes exactly those and nothing else. */
const fs = require('fs');

function makeSheet(name, nCols) {
  const grid = [];                      // grid[r][c], 0-indexed, row 0 = header
  const s = {
    getName: () => name,
    _grid: grid,
    getLastRow: () => {
      for (let r = grid.length - 1; r >= 0; r--)
        if (grid[r] && grid[r].some(v => v !== '' && v != null)) return r + 1;
      return 0;
    },
    getMaxColumns: () => nCols,
    deleteRow: (r) => { grid.splice(r - 1, 1); },
    getRange: (r, c, nr, nc) => {
      nr = nr || 1; nc = nc || 1;
      return {
        setValues: (vals) => {
          for (let i = 0; i < nr; i++) {
            const row = r - 1 + i;
            while (grid.length <= row) grid.push(new Array(nCols).fill(''));
            for (let j = 0; j < nc; j++) grid[row][c - 1 + j] = vals[i][j];
          }
        },
        getValues: () => {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const row = grid[r - 1 + i] || new Array(nCols).fill('');
            out.push(row.slice(c - 1, c - 1 + nc));
          }
          return out;
        },
      };
    },
  };
  grid.push(new Array(nCols).fill(''));  // header row placeholder
  return s;
}

function run(fnName, sheets, store, logs) {
  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    getId: () => 'MOCK',
  };
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
      formatDate: (d, tz, fmt) =>
        new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d),
    },
    Logger: { log: (m) => logs.push(String(m)) },
  };
  const src = fs.readFileSync('C:/projects/NutriBoii/sheet/sample-data.gs', 'utf8');
  const keys = Object.keys(sandbox);
  new Function(...keys, src + '\n' + fnName + '();')(...keys.map(k => sandbox[k]));
}

const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' });
const off = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return fmt.format(d); };

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n))
                            : (fail++, console.log('  FAIL  ' + n + (x ? '\n        ' + x : ''))); };

function fresh() {
  return { 'Daily Log': makeSheet('Daily Log', 14), 'Baselines': makeSheet('Baselines', 7) };
}

console.log('\n=== seed ===');
let sh = fresh(), store = {}, logs = [];
run('seedSampleData', sh, store, logs);
const daily = sh['Daily Log']._grid.slice(1).filter(r => r[0] !== '');
const base = sh['Baselines']._grid.slice(1).filter(r => r[0] !== '');
console.log('  ' + logs.join('\n  '));
ok('25 daily rows written', daily.length === 25, 'n=' + daily.length);
ok('4 scans written', base.length === 4, 'n=' + base.length);
ok('today is the last row', daily[daily.length - 1][0] === off(0), daily[daily.length - 1][0]);
ok('oldest row is -27', daily[0][0] === off(-27), daily[0][0]);

const haveDates = daily.map(r => r[0]);
ok('gap at -20 (no row)', haveDates.indexOf(off(-20)) === -1);
ok('gap at -19 (no row)', haveDates.indexOf(off(-19)) === -1);
ok('gap at -7  (no row)', haveDates.indexOf(off(-7)) === -1);
ok('dates strictly ascending, no dupes',
   haveDates.every((d, i) => i === 0 || d > haveDates[i - 1]));

ok('TDEE_Target left blank (dashboard computes)', daily.every(r => r[10] === ''));
ok('Deficit left blank (dashboard computes)', daily.every(r => r[11] === ''));
ok('BMR filled', daily.every(r => r[9] === 1672));
ok('every DayType is in the locked vocabulary',
   daily.every(r => ['Rest', 'Busy', 'Gym', 'Treat'].indexOf(r[1]) >= 0),
   JSON.stringify([...new Set(daily.map(r => r[1]))]));
ok('all 14 columns present per row', daily.every(r => r.length === 14));

const fatOver = daily.filter(r => r[4] > 70);
const named = fatOver.filter(r => /chocolate|cashew|oil|cheese|satay|laksa|cake|fried/i.test(r[13]));
console.log('  fat-over days: ' + fatOver.length + ', of which name foods: ' + named.length);
ok('has fat-over days above the 70g ceiling', fatOver.length >= 5, 'n=' + fatOver.length);
ok('most fat-over days name their foods', named.length >= 5, 'named=' + named.length);
ok('exactly one fat-over day names none, to show the fallback wording',
   fatOver.length - named.length === 1,
   JSON.stringify(fatOver.filter(r => !named.includes(r)).map(r => [r[0], r[4], r[13]])));
ok('no fat-over day is only marginally over (would read as noise)',
   fatOver.every(r => r[4] >= 75), JSON.stringify(fatOver.map(r => r[4]).filter(f => f < 75)));
// Treat days are realistically low-protein AND high-fat at once; that is not
// a data problem. What matters is that at least one day shows the protein
// flag on its own, so the two warning states can be told apart on screen.
ok('at least one day is protein-low WITHOUT being fat-over',
   daily.some(r => r[3] < 150 && r[4] <= 70),
   JSON.stringify(daily.filter(r => r[3] < 150).map(r => [r[0], r[3], r[4]])));
ok('has a protein-low day (<150g)', daily.some(r => r[3] < 150));
ok('has a real surplus day (Treat)', daily.some(r => r[1] === 'Treat' && r[2] > 2500));
ok('scans trend downward in fat mass',
   base.every((r, i) => i === 0 || r[3] < base[i - 1][3]));
ok('sample range recorded in properties', !!store['nutriboii.sampleDates']);

console.log('\n=== clear removes exactly the sample rows ===');
logs = [];
run('clearSampleData', sh, store, logs);
console.log('  ' + logs.join('\n  '));
ok('Daily Log emptied', sh['Daily Log'].getLastRow() <= 1, 'lastRow=' + sh['Daily Log'].getLastRow());
ok('Baselines emptied', sh['Baselines'].getLastRow() <= 1, 'lastRow=' + sh['Baselines'].getLastRow());
ok('property cleared', !store['nutriboii.sampleDates']);

console.log('\n=== clear leaves REAL rows alone ===');
sh = fresh(); store = {}; logs = [];
run('seedSampleData', sh, store, logs);
// a genuine row on a date the seeder deliberately skipped
sh['Daily Log'].getRange(27, 1, 1, 14).setValues([[off(-7), 'Rest', 1777, 155, 60, 130, 5000, 300, 0, 1672, '', '', 'None', 'MY REAL DAY']]);
logs = [];
run('clearSampleData', sh, store, logs);
const left = sh['Daily Log']._grid.slice(1).filter(r => r[0] !== '');
console.log('  rows left: ' + JSON.stringify(left.map(r => [r[0], r[13]])));
ok('the real row survived', left.length === 1 && left[0][13] === 'MY REAL DAY', JSON.stringify(left));

console.log('\n=== seed refuses to clobber unknown data ===');
sh = fresh(); store = {}; logs = [];
sh['Daily Log'].getRange(2, 1, 1, 14).setValues([[off(-1), 'Gym', 1900, 160, 60, 140, 9000, 700, 500, 1672, '', '', 'Day 1', 'REAL']]);
run('seedSampleData', sh, store, logs);
console.log('  ' + logs.join('\n  '));
const after = sh['Daily Log']._grid.slice(1).filter(r => r[0] !== '');
ok('refused, left the single real row untouched', after.length === 1 && after[0][13] === 'REAL',
   JSON.stringify(after.map(r => r[13])));
ok('said why', logs.some(l => /not sample data/i.test(l)), logs.join(' | '));

console.log('\n' + '='.repeat(46));
console.log('  ' + pass + ' passed, ' + fail + ' failed');
console.log('='.repeat(46));
process.exit(fail ? 1 : 0);
