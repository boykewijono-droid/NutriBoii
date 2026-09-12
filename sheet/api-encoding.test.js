/* Regression: non-ASCII must survive the API response, not just the cell.
 *
 * Storage was always correct — an em dash written through the API landed in the
 * sheet as a real em dash. But the JSON response double-encoded it, so a caller
 * reading the reply saw mojibake, and the HTML confirmation page declared no
 * charset at all and left the browser to guess.
 *
 * Kept separate from api.test.js only because this file is full of escape
 * sequences and is easier to maintain on its own.
 */
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
      return {
        setValue: (v) => {
          while (grid.length < r) grid.push(new Array(n).fill(''));
          grid[r - 1][c - 1] = v;
        },
        getValue: () => (grid[r - 1] ? grid[r - 1][c - 1] : ''),
        getValues: () => {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const row = grid[r - 1 + i] || new Array(n).fill('');
            out.push(row.slice(c - 1, c - 1 + nc));
          }
          return out;
        },
        sort: () => {},
      };
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
      getUuid: () => 'x',
      formatDate: (d, tz) => new Intl.DateTimeFormat('en-CA',
        { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d),
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

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n))
                            : (fail++, console.log('  FAIL  ' + n + (x ? '\n        ' + x : ''))); };

const EM = '\u2014';          // em dash, as used throughout the sample notes
const EACUTE = '\u00e9';      // café
const NOTE = 'hawker night ' + EM + ' satay, caf' + EACUTE + ' kopi';

console.log('\n=== JSON response encoding ===');
{
  const sheets = { 'Daily Log': makeSheet(DAILY_HDR), 'Baselines': makeSheet(BASE_HDR) };
  const store = { 'nutriboii.apiSecret': 'T' };
  const r = call(sheets, store, { token: 'T', action: 'log', format: 'json',
                                  date: '2026-09-12', notes: NOTE });

  const nonAscii = r.text.match(/[^\x00-\x7F]/g);
  ok('response body is pure ASCII, so charset cannot corrupt it',
     nonAscii === null, 'found: ' + JSON.stringify(nonAscii));
  ok('the escape is a real JSON unicode escape',
     r.text.indexOf('\\u2014') >= 0, 'no \\u2014 in body');

  const parsed = JSON.parse(r.text);
  ok('em dash round-trips after parsing', parsed.row.Notes.indexOf(EM) >= 0,
     JSON.stringify(parsed.row.Notes));
  ok('accented character round-trips', parsed.row.Notes.indexOf(EACUTE) >= 0,
     JSON.stringify(parsed.row.Notes));
  ok('parsed note equals what was sent', parsed.row.Notes === NOTE,
     JSON.stringify(parsed.row.Notes));

  const cell = sheets['Daily Log']._grid
    .find(x => String(x[0]).slice(0, 10) === '2026-09-12')[13];
  ok('the cell stores the real characters, not escapes', cell === NOTE, JSON.stringify(cell));

  // ASCII must not be mangled on the way through the escaper
  const r2 = call(sheets, store, { token: 'T', action: 'log', format: 'json',
                                   date: '2026-09-13', notes: 'plain ascii note' });
  ok('plain ASCII is untouched', JSON.parse(r2.text).row.Notes === 'plain ascii note');
}

console.log('\n=== HTML confirmation page ===');
{
  const sheets = { 'Daily Log': makeSheet(DAILY_HDR), 'Baselines': makeSheet(BASE_HDR) };
  const store = { 'nutriboii.apiSecret': 'T' };
  call(sheets, store, { token: 'T', action: 'log', format: 'json', date: '2026-09-12', notes: NOTE });
  const h = call(sheets, store, { token: 'T', action: 'get', date: '2026-09-12' });

  ok('page declares utf-8', /<meta charset="utf-8">/.test(h.text));
  ok('charset comes before any content', h.text.indexOf('<meta charset="utf-8">') < h.text.indexOf('<div class="card">'));
  ok('page still carries the note', h.text.indexOf(EM) >= 0);
  ok('viewport tag kept', /width=device-width/.test(h.text));
}

console.log('\n' + '='.repeat(46));
console.log('  ' + pass + ' passed, ' + fail + ' failed');
console.log('='.repeat(46));
process.exit(fail ? 1 : 0);
