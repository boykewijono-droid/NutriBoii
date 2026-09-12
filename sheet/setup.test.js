/* Minimal SpreadsheetApp mock, just enough to prove setUpNutriBoii builds a
   correct header row from a fresh sheet AND repairs a drifted one. */
const fs = require('fs');

function makeSheet(name, cols, rows, row1) {
  const s = {
    _name: name, _cols: cols, _rows: rows,
    _row1: row1 ? row1.slice() : new Array(cols).fill(''),
    getName: () => s._name,
    getMaxColumns: () => s._cols,
    getMaxRows: () => s._rows,
    getLastRow: () => (s._row1.some(v => v !== '') ? 1 : 0),
    setFrozenRows: () => s,
    insertRowsAfter: (after, n) => { s._rows += n; return s; },
    insertColumnsAfter: (after, n) => {
      for (let i = 0; i < n; i++) s._row1.splice(after + i, 0, '');
      s._cols += n; return s;
    },
    deleteColumns: (pos, n) => {
      if (pos + n - 1 > s._cols) throw new Error(
        `deleteColumns out of range: pos=${pos} n=${n} cols=${s._cols}`);
      s._row1.splice(pos - 1, n);
      s._cols -= n; return s;
    },
    setColumnWidth: () => s,
    getRange: (r, c, nr, nc) => {
      nr = nr || 1; nc = nc || 1;
      const rg = {
        setValues: (vals) => {
          if (c - 1 + nc > s._cols) throw new Error(
            `setValues past last column: writing ${nc} at col ${c}, sheet has ${s._cols}`);
          if (r === 1) for (let i = 0; i < nc; i++) s._row1[c - 1 + i] = vals[0][i];
          return rg;
        },
        setNote: () => rg, setWrap: () => rg, setFontFamily: () => rg,
        setFontSize: () => rg, setFontWeight: () => rg, setBackground: () => rg,
        setFontColor: () => rg, setVerticalAlignment: () => rg,
        setNumberFormat: () => rg, setHorizontalAlignment: () => rg,
        setDataValidation: (v) => { s._validation = v; return rg; },
        getBandings: () => [], applyRowBanding: () => rg,
      };
      return rg;
    },
  };
  return s;
}

function makeSS(sheets) {
  const ss = {
    _sheets: sheets,
    getId: () => 'MOCK_ID',
    getSheets: () => ss._sheets.slice(),
    getSheetByName: (n) => ss._sheets.find(x => x.getName() === n) || null,
    insertSheet: (n) => { const sh = makeSheet(n, 26, 1000); ss._sheets.push(sh); return sh; },
    deleteSheet: (sh) => { ss._sheets = ss._sheets.filter(x => x !== sh); },
    setSpreadsheetTimeZone: () => ss,
  };
  return ss;
}

function run(ss) {
  const sandbox = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      newDataValidation: () => {
        const b = { requireValueInList: () => b, setAllowInvalid: () => b,
                    setHelpText: () => b, build: () => ({ _dv: true }) };
        return b;
      },
      BandingTheme: { LIGHT_GREY: 'grey' },
    },
    LockService: { getDocumentLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Logger: { log: () => {} },
  };
  const src = fs.readFileSync('C:/projects/NutriBoii/sheet/setup.gs', 'utf8');
  const keys = Object.keys(sandbox);
  new Function(...keys, src + '\nsetUpNutriBoii();')(...keys.map(k => sandbox[k]));
}

const EXPECT_DAILY = ['Date','DayType','Calories','Protein_g','Fat_g','Carbs_g','Steps',
  'ActiveCal','ExerciseCal','BMR','TDEE_Target','Deficit','GymDay','Notes'];
const EXPECT_BASE = ['Date','Weight_kg','BodyFat_pct','BodyFatMass_kg','SkeletalMuscle_kg','BMR','Notes'];
const EXPECT_TGT  = ['Key','Value','Unit','Notes'];

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n))
                            : (fail++, console.log('  FAIL  ' + n + (x ? '\n        ' + x : ''))); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function check(label, ss) {
  console.log('\n=== ' + label + ' ===');
  const d = ss.getSheetByName('Daily Log');
  const b = ss.getSheetByName('Baselines');
  const t = ss.getSheetByName('Targets');
  console.log('  tabs      : ' + ss.getSheets().map(s => s.getName()).join(', '));
  console.log('  Daily row1: ' + JSON.stringify(d._row1));
  ok('Daily Log header exactly right', eq(d._row1, EXPECT_DAILY), JSON.stringify(d._row1));
  ok('Daily Log is 14 columns wide', d._cols === 14, 'cols=' + d._cols);
  ok('Notes present in Daily Log', d._row1.indexOf('Notes') === 13);
  ok('Date is column A', d._row1[0] === 'Date');
  ok('Baselines header right', eq(b._row1, EXPECT_BASE), JSON.stringify(b._row1));
  ok('Targets header right', eq(t._row1, EXPECT_TGT), JSON.stringify(t._row1));
  ok('DayType validation applied', !!d._validation);
  ok('blank default tab removed', !ss.getSheetByName('Sheet1'));
  ok('exactly 3 tabs', ss.getSheets().length === 3, 'n=' + ss.getSheets().length);
}

// A. fresh spreadsheet, one blank Sheet1 (what Drive created)
let ss = makeSS([makeSheet('Sheet1', 26, 1000)]);
run(ss);
check('A. fresh sheet', ss);

// B. re-run on the already-built sheet (idempotence)
run(ss);
check('B. re-run, idempotent', ss);

// C. THE REAL BUG: Daily Log drifted left, Date wrapped to the end, Notes gone
const drifted = makeSheet('Daily Log', 14, 1000,
  ['','DayType','Calories','Protein_g','Fat_g','Carbs_g','Steps','ActiveCal',
   'ExerciseCal','BMR','TDEE_Target','Deficit','GymDay','Date']);
ss = makeSS([drifted, makeSheet('Baselines',7,1000,EXPECT_BASE), makeSheet('Targets',4,1000,EXPECT_TGT)]);
run(ss);
check('C. repairs the drifted header row', ss);

// D. sheet narrower than the schema — setValues used to throw here
ss = makeSS([makeSheet('Daily Log', 5, 1000, ['Date','DayType','Calories','Protein_g','Fat_g'])]);
run(ss);
check('D. widens a too-narrow sheet', ss);

console.log('\n' + '='.repeat(46));
console.log('  ' + pass + ' passed, ' + fail + ' failed');
console.log('='.repeat(46));
process.exit(fail ? 1 : 0);
