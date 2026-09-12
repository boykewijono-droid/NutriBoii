/**
 * NutriBoii — write API (Apps Script Web App).
 *
 * Exists because the Google Drive connector that Claude (chat and code) has is
 * file-level: it can create and rename a spreadsheet but cannot write a cell.
 * This endpoint closes that gap.
 *
 * Fields are addressed BY NAME, never by position. That is the whole point.
 * Pasting a tab-separated row breaks the moment a run of blank fields loses a
 * tab — which is exactly how BMR ended up in ExerciseCal and a note ended up
 * in GymDay. Named fields make that class of bug impossible.
 *
 * DEPLOY (once)
 *   1. Paste this into the Sheet's Apps Script project as a new file, "api".
 *   2. Run setUpApi. It prints a secret token in the Execution log. Copy it.
 *   3. Deploy -> New deployment -> type: Web app
 *        Description:   NutriBoii API
 *        Execute as:    Me
 *        Who has access: ANYONE  <- must be this, not "Anyone with
 *                        Google account". The latter bounces every
 *                        non-browser request to a Google login page, so
 *                        nothing programmatic can reach it. The token is
 *                        the access control here, not Google sign-in.
 *      Deploy, then copy the /exec URL.
 *   4. Test in a browser:  <URL>?token=<TOKEN>&action=ping
 *
 * RE-DEPLOY after editing this file: Deploy -> Manage deployments -> edit the
 * existing one -> Version: New version -> Deploy. Editing alone changes
 * nothing; the old version keeps serving until you publish a new one.
 *
 * USAGE
 *   Log or update today (absent fields are left alone, so partial logging
 *   through the day works):
 *     <URL>?token=T&action=log&date=2026-09-12&dayType=Gym&calories=1795
 *          &protein=171&fat=58&carbs=128&steps=9950&activeCal=700
 *          &exerciseCal=410&gymDay=Day%202&notes=clean%20day
 *
 *   An InBody scan:
 *     <URL>?token=T&action=scan&date=2026-09-12&weight=78.3&bodyFat=21.6
 *
 *   Read a day back:   <URL>?token=T&action=get&date=2026-09-12
 *
 *   Delete a row (confirm=yes is required):
 *     <URL>?token=T&action=delete&date=2026-09-12&confirm=yes
 *     add &tab=baselines to delete a scan instead of a daily row
 *
 *   GET returns a small confirmation page, so a link is tappable on a phone.
 *
 *   PROGRAMMATIC CALLERS MUST ADD &format=json. Apps Script does not serve
 *   HtmlService output directly: it serves a JavaScript shell that loads the
 *   real content into a sandboxed iframe. Anything fetching server-side runs
 *   no JavaScript and therefore receives an empty shell, which looks exactly
 *   like a missing row. &format=json (or POST, which always replies JSON)
 *   returns the data as plain JSON and sidesteps the wrapper entirely.
 *
 * BLANK IS NOT ZERO
 *   Omit a field and the cell is left as it is. Send it empty (notes=) and the
 *   cell is cleared. Send 0 and you get a real zero. The dashboard excludes
 *   blanks from every average and treats 0 as a measured value, so this
 *   distinction matters.
 */

var API_SECRET_PROP = 'nutriboii.apiSecret';
var DASHBOARD_URL = 'https://boykewijono-droid.github.io/NutriBoii/';

/** Run once. Generates and stores the token, then prints it. */
function setUpApi() {
  var props = PropertiesService.getDocumentProperties();
  var secret = props.getProperty(API_SECRET_PROP);
  if (!secret) {
    secret = Utilities.getUuid().replace(/-/g, '').slice(0, 24);
    props.setProperty(API_SECRET_PROP, secret);
    Logger.log('Generated a new API token.');
  } else {
    Logger.log('An API token already exists; reusing it.');
  }
  Logger.log('TOKEN: ' + secret);
  Logger.log('Next: Deploy -> New deployment -> Web app -> Execute as Me.');
  Logger.log('Then test: <YOUR_EXEC_URL>?token=' + secret + '&action=ping');
}

/** Forget the token and issue a new one. Old links stop working. */
function resetApiToken() {
  PropertiesService.getDocumentProperties().deleteProperty(API_SECRET_PROP);
  setUpApi();
}

/* ===================================================================== */

function doGet(e)  { return handle(e, 'GET'); }
function doPost(e) { return handle(e, 'POST'); }

function handle(e, verb) {
  var p = readParams(e);
  var asHtml = (verb === 'GET' && String(p.format || '').toLowerCase() !== 'json');
  try {
    var secret = PropertiesService.getDocumentProperties().getProperty(API_SECRET_PROP);
    if (!secret) throw new Error('API not set up. Run setUpApi in the script editor.');
    if (String(p.token || '') !== secret) throw new Error('Bad or missing token.');

    var action = String(p.action || 'ping').toLowerCase();
    var out;
    if (action === 'ping')      out = { ok: true, action: 'ping', summary: 'NutriBoii API is up. Token accepted.' };
    else if (action === 'log')  out = logDay(p);
    else if (action === 'scan') out = addScan(p);
    else if (action === 'get')  out = getDay(p);
    else if (action === 'delete') out = deleteDay(p);
    else throw new Error('Unknown action "' + action + '". Use log, scan, get, delete or ping.');

    return asHtml ? htmlReply(out) : jsonReply(out);
  } catch (err) {
    var bad = { ok: false, error: String(err && err.message || err) };
    return asHtml ? htmlReply(bad) : jsonReply(bad);
  }
}

/** Query string plus JSON body, with keys normalised so Protein_g,
 *  protein_g and protein all land on the same field. */
function readParams(e) {
  var raw = {};
  if (e && e.parameter) for (var k in e.parameter) raw[k] = e.parameter[k];
  if (e && e.postData && e.postData.contents) {
    try {
      var body = JSON.parse(e.postData.contents);
      for (var k2 in body) raw[k2] = body[k2];
    } catch (ignore) {}
  }
  var out = {};
  for (var k3 in raw) out[normKey(k3)] = raw[k3];
  // keep these readable for internal use
  out.token = raw.token != null ? raw.token : out.token;
  out.action = raw.action != null ? raw.action : out.action;
  out.format = raw.format != null ? raw.format : out.format;
  return out;
}
function normKey(k) { return String(k).toLowerCase().replace(/[^a-z0-9]/g, ''); }

/* ===================================================================== */

var DAILY = 'Daily Log';
var BASE  = 'Baselines';
var DAY_TYPES = ['Rest', 'Busy', 'Gym', 'Treat'];

/* normalised field name -> [column, isNumeric] */
var DAILY_MAP = {
  date:        [1,  false],
  daytype:     [2,  false], type: [2, false],
  calories:    [3,  true],  cal: [3, true], kcal: [3, true],
  protein:     [4,  true],  proteing: [4, true],
  fat:         [5,  true],  fatg: [5, true],
  carbs:       [6,  true],  carbsg: [6, true], carbohydrates: [6, true],
  steps:       [7,  true],
  activecal:   [8,  true],  active: [8, true], activecalories: [8, true],
  exercisecal: [9,  true],  exercise: [9, true], exercisecalories: [9, true],
  bmr:         [10, true],
  /* TDEE_Target and Deficit are derived on every write, so they are
     deliberately NOT settable through the API. */
  gymday:      [13, false], gym: [13, false], split: [13, false],
  notes:       [14, false], note: [14, false]
};

var BASE_MAP = {
  date:              [1, false],
  weightkg:          [2, true], weight: [2, true],
  bodyfatpct:        [3, true], bodyfat: [3, true], bf: [3, true], bfpct: [3, true],
  bodyfatmasskg:     [4, true], bodyfatmass: [4, true], fatmass: [4, true],
  skeletalmusclekg:  [5, true], skeletalmuscle: [5, true], muscle: [5, true],
  bmr:               [6, true],
  notes:             [7, false], note: [7, false]
};

function logDay(p) {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) throw new Error('Sheet busy, try again.');
  try {
    var sh = mustGet(DAILY);
    var date = resolveDate(p.date);

    if (p.daytype != null && String(p.daytype) !== '') {
      var dt = canonDayType(p.daytype);
      if (!dt) throw new Error('DayType must be one of ' + DAY_TYPES.join(', ') +
                               ' (got "' + p.daytype + '").');
      p.daytype = dt;
    }

    var res = upsert(sh, DAILY_MAP, 14, date, p);

    // A brand-new row with no BMR given inherits the newest scan's BMR, so the
    // day's TDEE is frozen against the body composition that was current.
    if (res.created && (p.bmr == null || p.bmr === '')) {
      var bmr = latestScanBmr();
      if (bmr != null) sh.getRange(res.row, 10).setValue(bmr);
    }

    // Fill TDEE_Target and Deficit so the sheet reads sensibly on its own.
    // Recomputed on EVERY log call, so a morning row that only had breakfast
    // gets corrected when the evening totals arrive. The dashboard ignores
    // these and recomputes from source, so a later hand-edit cannot mislead it.
    writeDerived(sh, findRow(sh, date));

    sortByDate(sh);
    var row = readRow(sh, DAILY_MAP, 14, date);
    return {
      ok: true, action: 'log', date: date,
      created: res.created, updated: !res.created,
      wrote: res.wrote, row: row,
      summary: summarise(row)
    };
  } finally { lock.releaseLock(); }
}

function addScan(p) {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) throw new Error('Sheet busy, try again.');
  try {
    var sh = mustGet(BASE);
    var date = resolveDate(p.date);
    var res = upsert(sh, BASE_MAP, 7, date, p);
    sortByDate(sh);
    var row = readRow(sh, BASE_MAP, 7, date);
    return {
      ok: true, action: 'scan', date: date,
      created: res.created, updated: !res.created,
      wrote: res.wrote, row: row,
      summary: 'Scan ' + date + ': ' + (row.Weight_kg || '?') + ' kg, ' +
               (row.BodyFat_pct || '?') + '% body fat'
    };
  } finally { lock.releaseLock(); }
}

function getDay(p) {
  var date = resolveDate(p.date);
  var row = readRow(mustGet(DAILY), DAILY_MAP, 14, date);
  if (!row) return { ok: true, action: 'get', date: date, found: false,
                     summary: 'No row logged for ' + date + '.' };
  return { ok: true, action: 'get', date: date, found: true, row: row,
           summary: summarise(row) };
}

/** Remove one row outright. Needed because a mislogged date otherwise can
 *  only be fixed by hand in the sheet. Requires confirm=yes so a
 *  mis-generated link cannot quietly destroy a day. */
function deleteDay(p) {
  if (String(p.confirm || '').toLowerCase() !== 'yes') {
    throw new Error('Refusing to delete without confirm=yes.');
  }
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) throw new Error('Sheet busy, try again.');
  try {
    var which = String(p.tab || 'daily').toLowerCase();
    var onScans = (which === 'scan' || which === 'scans' || which === 'baselines');
    var sh = mustGet(onScans ? BASE : DAILY);
    var date = resolveDate(p.date);
    var row = findRow(sh, date);
    if (!row) {
      return { ok: true, action: 'delete', date: date, deleted: false,
               summary: 'No row for ' + date + ' in ' + sh.getName() + '. Nothing deleted.' };
    }
    sh.deleteRow(row);
    return { ok: true, action: 'delete', date: date, deleted: true,
             summary: 'Deleted ' + date + ' from ' + sh.getName() + '.' };
  } finally { lock.releaseLock(); }
}

/* ===================================================================== */

/** Write only the fields actually supplied. Absent leaves the cell alone;
 *  an empty string clears it; 0 writes a real zero. */
function upsert(sh, map, nCols, date, p) {
  var row = findRow(sh, date);
  var created = false;
  if (!row) {
    row = Math.max(sh.getLastRow() + 1, 2);
    if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 1);
    sh.getRange(row, 1).setValue(date);
    created = true;
  }

  var wrote = {};
  var seen = {};
  for (var key in p) {
    if (key === 'token' || key === 'action' || key === 'format' || key === 'date') continue;
    var spec = map[key];
    if (!spec) continue;
    var col = spec[0];
    if (seen[col]) continue;          // first alias wins
    seen[col] = 1;

    var v = p[key];
    var val;
    if (v == null || String(v).trim() === '') {
      val = '';                       // explicit clear
    } else if (spec[1]) {
      val = toNum(v);
      if (val == null) throw new Error('"' + key + '" must be a number (got "' + v + '").');
    } else {
      val = String(v).trim();
    }
    if (col <= nCols) {
      sh.getRange(row, col).setValue(val);
      wrote[headerName(sh, col)] = val === '' ? null : val;
    }
  }
  return { row: row, created: created, wrote: wrote };
}

/** Compute TDEE_Target and Deficit into columns 11 and 12 for this row.
 *  Cleared rather than left stale when the inputs are not there. */
function writeDerived(sh, row) {
  if (!row) return;
  var v = sh.getRange(row, 1, 1, 12).getValues()[0];
  var cal = v[2], ac = v[7], ex = v[8], bmr = v[9];
  var haveNum = function (x) { return x !== '' && x != null && !isNaN(x); };
  if (!haveNum(bmr)) { sh.getRange(row, 11, 1, 2).setValue(''); return; }
  var tdee = Math.round(Number(bmr) +
    (haveNum(ex) ? Number(ex) : 0) * 0.7 +
    Math.max(0, (haveNum(ac) ? Number(ac) : 0) - (haveNum(ex) ? Number(ex) : 0)) * 0.5);
  sh.getRange(row, 11).setValue(tdee);
  sh.getRange(row, 12).setValue(haveNum(cal) ? tdee - Number(cal) : '');
}

function findRow(sh, date) {
  if (sh.getLastRow() < 2) return null;
  var col = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < col.length; i++) {
    if (cellDate(col[i][0]) === date) return i + 2;
  }
  return null;
}

function readRow(sh, map, nCols, date) {
  var r = findRow(sh, date);
  if (!r) return null;
  var vals = sh.getRange(r, 1, 1, nCols).getValues()[0];
  var out = {};
  for (var c = 1; c <= nCols; c++) {
    var v = vals[c - 1];
    out[headerName(sh, c)] = (v === '' || v == null) ? null
                           : (c === 1 ? cellDate(v) : v);
  }
  return out;
}

function headerName(sh, col) {
  return String(sh.getRange(1, col).getValue()).trim() || ('col' + col);
}

/** Keep the sheet readable: rows in date order, blanks pushed to the bottom. */
function sortByDate(sh) {
  var n = sh.getLastRow() - 1;
  if (n > 1) sh.getRange(2, 1, n, sh.getLastColumn()).sort({ column: 1, ascending: true });
}

function mustGet(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Tab "' + name + '" not found. Run setUpNutriBoii first.');
  return sh;
}

function resolveDate(v) {
  if (v == null || String(v).trim() === '') return todaySGT();
  var s = String(v).trim();
  if (/^today$/i.test(s)) return todaySGT();
  if (/^yesterday$/i.test(s)) {
    var d = new Date(); d.setDate(d.getDate() - 1);
    return Utilities.formatDate(d, 'Asia/Singapore', 'yyyy-MM-dd');
  }
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) throw new Error('date must be YYYY-MM-DD (got "' + s + '").');
  return m[1] + '-' + pad2(m[2]) + '-' + pad2(m[3]);
}
function todaySGT() { return Utilities.formatDate(new Date(), 'Asia/Singapore', 'yyyy-MM-dd'); }
function pad2(n) { n = String(n); return n.length < 2 ? '0' + n : n; }

function cellDate(v) {
  if (v === '' || v == null) return '';
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Singapore', 'yyyy-MM-dd');
  return String(v).trim().slice(0, 10);
}

function toNum(v) {
  var s = String(v).trim().replace(/,/g, '').replace(/[^0-9.\-+]/g, '');
  if (s === '' || s === '-' || s === '+' || s === '.') return null;
  var n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function canonDayType(v) {
  var s = String(v).trim().toLowerCase();
  for (var i = 0; i < DAY_TYPES.length; i++) {
    if (DAY_TYPES[i].toLowerCase() === s) return DAY_TYPES[i];
  }
  return null;
}

function latestScanBmr() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BASE);
  if (!sh || sh.getLastRow() < 2) return null;
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();
  var best = null, bestDate = '';
  for (var i = 0; i < vals.length; i++) {
    var d = cellDate(vals[i][0]);
    var b = vals[i][5];
    if (d && b !== '' && b != null && d >= bestDate) { bestDate = d; best = b; }
  }
  return best;
}

/** Recompute TDEE and deficit for the reply. Never written to the sheet —
 *  the dashboard owns that arithmetic. */
function summarise(row) {
  if (!row) return '';
  var bmr = row.BMR, ac = row.ActiveCal, ex = row.ExerciseCal, cal = row.Calories;
  var bits = [];
  bits.push(cal == null ? 'no intake logged' : cal + ' kcal');
  if (bmr != null) {
    var tdee = Math.round(bmr + (ex || 0) * 0.7 + Math.max(0, (ac || 0) - (ex || 0)) * 0.5);
    bits.push('target ' + tdee);
    if (cal != null) {
      var def = tdee - cal;
      bits.push((def >= 0 ? 'deficit +' : 'surplus ') + def);
    }
  }
  if (row.Protein_g != null) bits.push('P ' + row.Protein_g + 'g');
  if (row.Fat_g != null) bits.push('F ' + row.Fat_g + 'g');
  return bits.join(' · ');
}

/* ===================================================================== */

function jsonReply(o) {
  // Escape every non-ASCII character to \uXXXX. Valid JSON, and it makes the
  // body charset-independent: without this an em dash in a note comes back
  // double-encoded even though the cell itself holds it correctly.
  var s = JSON.stringify(o, null, 2).replace(/[\u007f-\uffff]/g, function (c) {
    return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
  });
  return ContentService.createTextOutput(s)
    .setMimeType(ContentService.MimeType.JSON);
}

/** A tapped link deserves a page, not raw JSON. */
function htmlReply(o) {
  var ok = !!o.ok;
  var rows = '';
  if (o.row) {
    for (var k in o.row) {
      if (o.row[k] == null) continue;
      rows += '<tr><td>' + esc(k) + '</td><td>' + esc(o.row[k]) + '</td></tr>';
    }
  }
  var h =
  '<!doctype html><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>NutriBoii</title><style>' +
  'body{margin:0;background:#E9E4D8;color:#16150F;font:14px/1.55 ui-monospace,Menlo,monospace;padding:28px 20px}' +
  '.card{max-width:520px;margin:0 auto;background:#F4F1E8;border:1px solid #D6CFBE;padding:24px}' +
  'h1{font:600 22px/1.1 Georgia,serif;margin:0 0 4px;letter-spacing:-.01em}' +
  '.lbl{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:#7C7768;margin-bottom:14px}' +
  '.sum{background:#16150F;color:#B4D336;padding:14px 16px;margin:16px 0;font-size:13px;word-break:break-word}' +
  '.err{background:#16150F;color:#E8836B;padding:14px 16px;margin:16px 0;font-size:13px}' +
  'table{border-collapse:collapse;width:100%;font-size:12px;margin-top:8px}' +
  'td{padding:7px 0;border-bottom:1px solid #E0DACB}' +
  'td:first-child{color:#7C7768;width:45%}td:last-child{text-align:right;font-weight:500}' +
  'a{display:inline-block;margin-top:20px;background:#16150F;color:#F4F1E8;padding:11px 20px;text-decoration:none;font-size:12px;letter-spacing:.04em}' +
  '</style><div class="card">' +
  '<h1>' + (ok ? headingFor(o) : 'Not written') + '</h1>' +
  '<div class="lbl">' + esc(o.date || o.action || '') + (ok ? '' : ' · error') + '</div>' +
  (ok ? (o.summary ? '<div class="sum">' + esc(o.summary) + '</div>' : '')
      : '<div class="err">' + esc(o.error) + '</div>') +
  (rows ? '<table>' + rows + '</table>' : '') +
  '<a href="' + DASHBOARD_URL + '">Open the dashboard</a>' +
  '</div>';
  return HtmlService.createHtmlOutput(h)
    .addMetaTag('viewport', 'width=device-width,initial-scale=1');
}

function headingFor(o) {
  if (o.action === 'ping') return 'API is up';
  if (o.action === 'get')  return o.found ? 'NutriBoii' : 'Nothing logged';
  if (o.action === 'scan') return o.created ? 'Scan saved' : 'Scan updated';
  if (o.action === 'delete') return o.deleted ? 'Deleted' : 'Nothing to delete';
  return o.created ? 'Logged' : 'Updated';
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
