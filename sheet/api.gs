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
 *   Activity from the phone (Health Connect Webhook app, POST, JSON body):
 *     <URL>?token=T&action=sync
 *     Steps, active calories and exercise calories are rebuilt per day from
 *     the records received. See SYNC.md for the phone-side setup.
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
    else if (action === 'sync') out = hsSync(e);
    else throw new Error('Unknown action "' + action + '". Use log, scan, get, delete, sync or ping.');

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
/* ACTIVITY SYNC, pushed from the phone
 *
 * Samsung Health (or Health Sync) -> Health Connect -> the "Health Connect
 * Webhook" Android app -> POST <URL>?token=T&action=sync, JSON body.
 *
 * What the app actually sends (checked against its source, Sept 2026):
 *   - Steps and active calories default to a DAILY resolution: one running
 *     total per calendar day, from Health Connect's own aggregate (which
 *     already de-duplicates between apps). Each sync re-sends today as
 *     [midnight, now], so the 10:00 total must REPLACE the 09:00 one, never
 *     be added to it. These records carry no metadata at all.
 *   - Total calories and exercise sessions default to raw records, with
 *     metadata.data_origin but NO record id.
 *   - The very first sync, and a manual "Past 7 days" sync, starts its window
 *     part-way through the oldest day. That day's daily total covers only the
 *     tail of the day, so it is dropped rather than written as if complete.
 *
 * So records are stored in a hidden tab keyed by type, origin and time span,
 * and each day is rebuilt from them. Within one type and origin, overlapping
 * records are resolved newest first: a later running total supersedes an
 * earlier one and the superseded record is deleted. Records that do not
 * overlap (raw intervals, time buckets) are added up.
 *
 * Two apps can both write raw steps into Health Connect, Samsung Health and
 * Health Sync for example. Summing them would double the count, so for each
 * date and type only the ONE origin with the largest total is used.
 *
 * ExerciseCal is calories from records that sit mostly inside an exercise
 * session, pro rata by overlap, so an all-day calorie record is never counted
 * as exercise. ActiveCal is written only when active-calorie records arrive
 * AND add up to more than the exercise calories: Samsung Health does not share
 * its all-day activity calories with Health Connect, and workout-only active
 * calories written as ActiveCal would stop Claude asking for the real number.
 * A value that never arrived stays blank, not 0.
 *
 * Names are hs-prefixed: every .gs file in the project shares one scope.
 */
var HS_TAB = 'Activity Sync';
var HS_HEAD = ['Key', 'Type', 'Origin', 'Start', 'End', 'Value', 'Date', 'Received'];
var HS_KEEP_DAYS = 7;          // rebuild and keep this many days: covers a "Past 7 days" resend

function hsSync(e) {
  var body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || ''); }
  catch (err) { throw new Error('sync expects the JSON body sent by the Health Connect Webhook app.'); }
  if (!body || typeof body !== 'object') throw new Error('sync expects a JSON object body.');

  // The app's "Test Webhook" button sends made-up data flagged test:true.
  // Confirm the connection works, and write none of it.
  if (body.test === true) {
    return { ok: true, action: 'sync', test: true, received: 0,
             summary: 'Test received. The connection works; test data is not written to the sheet.' };
  }

  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) throw new Error('Sheet busy, try again.');
  try {
    var incoming = hsRecords(body);
    var raw = hsRawSheet();
    var store = hsLoad(raw);
    var now = new Date().toISOString();
    var touched = {};
    incoming.forEach(function (r) {
      r.received = now;
      store[r.key] = r;
      touched[r.date] = 1;
    });

    var cutoff = hsShift(todaySGT(), -HS_KEEP_DAYS);
    var sh = mustGet(DAILY);
    var days = {};
    Object.keys(touched).sort().forEach(function (date) {
      if (date < cutoff) return;       // older than the window worth rebuilding
      var t = hsRollup(store, date);
      t.superseded.forEach(function (k) { delete store[k]; });
      delete t.superseded;
      var p = {};
      if (t.steps != null) p.steps = t.steps;
      if (t.activeCal != null) p.activecal = t.activeCal;
      if (t.exerciseCal != null) p.exercisecal = t.exerciseCal;
      if (!Object.keys(p).length) return;
      var res = upsert(sh, DAILY_MAP, 14, date, p);
      if (res.created) {
        var bmr = latestScanBmr();
        if (bmr != null) sh.getRange(res.row, 10).setValue(bmr);
      }
      writeDerived(sh, findRow(sh, date));
      days[date] = t;
    });
    sortByDate(sh);

    // Keep the raw tab small. Anything older than a few days has already been
    // rolled up into the Daily Log.
    Object.keys(store).forEach(function (k) { if (store[k].date < cutoff) delete store[k]; });
    hsSave(raw, store);

    var updated = Object.keys(days);
    return {
      ok: true, action: 'sync', received: incoming.length,
      stored: Object.keys(store).length, days: days,
      summary: incoming.length + ' record' + (incoming.length === 1 ? '' : 's') + ' received; ' +
               (updated.length ? 'updated ' + updated.join(', ') : 'no daily totals changed')
    };
  } finally { lock.releaseLock(); }
}

/** Flatten the webhook payload into one list of records. */
function hsRecords(body) {
  var out = [];
  function add(type, list, valueOf) {
    (Array.isArray(list) ? list : []).forEach(function (rec) {
      if (!rec || !rec.start_time) return;
      var md = rec.metadata || {};
      // Daily totals and time buckets come with no metadata: they are
      // Health Connect aggregates, not one app's records.
      var origin = String(md.data_origin || md.dataOrigin || 'aggregate');
      var start = String(rec.start_time);
      var end = String(rec.end_time || rec.start_time);
      var a = Date.parse(start), b = Date.parse(end);
      if (isNaN(a) || isNaN(b)) return;
      var value = Number(valueOf(rec));
      if (isNaN(value)) return;
      if (!rec.metadata && type !== 'exercise' && hsClippedDay(a, b)) return;
      out.push({
        key: type + '|' + origin + '|' + (md.id ? String(md.id) : start + '|' + end),
        type: type, origin: origin, start: start, end: end, value: value,
        date: hsSgtDate(start)
      });
    });
  }
  add('steps', body.steps, function (r) { return r.count; });
  add('active', body.active_calories, function (r) { return r.calories; });
  add('total', body.total_calories, function (r) { return r.calories; });
  add('exercise', body.exercise || body.exercise_sessions || body.exercises, function () { return 0; });
  return out;
}

/** A daily total cut short by the start of the app's lookback window: it ends
 *  at a Singapore midnight but starts part-way through that day, at the exact
 *  instant the window opened (never on a whole minute). Writing it would put
 *  the last few hours of steps into the sheet as if they were the whole day. */
function hsClippedDay(a, b) {
  var DAY = 86400000, SGT = 8 * 3600000;
  var endsAtMidnight = (b + SGT) % DAY === 0;
  var startsAtMidnight = (a + SGT) % DAY === 0;
  return endsAtMidnight && !startsAtMidnight && a % 60000 !== 0;
}

/** One day's totals from every stored record for that date. Also returns the
 *  keys of records a newer overlapping record has superseded, for deletion. */
function hsRollup(store, date) {
  var all = Object.keys(store).map(function (k) { return store[k]; })
    .filter(function (r) { return r.date === date; });

  // Within one type and origin, some overlapping records are versions of the
  // same thing, such as today's running total at 09:00 and again at 10:00.
  // Keep the newest; on a tie, the one covering more time, then the later end.
  // For aggregates (no origin) any overlap means a newer version. One app's
  // own records can overlap legitimately, a day's calorie total and a
  // workout's inside it, so there only a record re-sent from the SAME start
  // with a later end counts as a newer version.
  var groups = {}, recs = [], superseded = [];
  all.forEach(function (r) {
    var g = r.type + '|' + r.origin;
    (groups[g] = groups[g] || []).push({ r: r, a: Date.parse(r.start), b: Date.parse(r.end) });
  });
  Object.keys(groups).forEach(function (g) {
    var accepted = [];
    groups[g].sort(function (x, y) {
      if (x.r.received !== y.r.received) return x.r.received < y.r.received ? 1 : -1;
      if (x.b - x.a !== y.b - y.a) return (y.b - y.a) - (x.b - x.a);
      if (x.b !== y.b) return y.b - x.b;
      return y.r.value - x.r.value;
    }).forEach(function (x) {
      var clash = accepted.some(function (y) {
        var overlap = x.a < y.b && y.a < x.b;
        return x.r.origin === 'aggregate' ? overlap : overlap && x.a === y.a;
      });
      if (clash) { superseded.push(x.r.key); return; }
      accepted.push(x);
      recs.push(x.r);
    });
  });

  var sessions = recs.filter(function (r) { return r.type === 'exercise'; })
    .map(function (r) { return [Date.parse(r.start), Date.parse(r.end)]; });

  // Share of a record's time span inside an exercise session. A record that is
  // mostly outside every session (an all-day total, a walk) counts for nothing.
  function sessionShare(r) {
    var a = Date.parse(r.start), b = Date.parse(r.end);
    if (!(b > a)) return 0;
    var covered = 0;
    sessions.forEach(function (w) { covered += Math.max(0, Math.min(b, w[1]) - Math.max(a, w[0])); });
    var share = Math.min(1, covered / (b - a));
    return share >= 0.5 ? share : 0;
  }

  // total per origin, then the single largest origin, never the sum of origins
  function best(type, weight) {
    var sums = {};
    recs.forEach(function (r) {
      if (r.type !== type) return;
      var w = weight ? weight(r) : 1;
      if (!w) return;
      sums[r.origin] = (sums[r.origin] || 0) + r.value * w;
    });
    var top = null;
    Object.keys(sums).forEach(function (o) {
      if (!top || sums[o] > top.value) top = { value: sums[o], origin: o };
    });
    return top ? { value: Math.round(top.value), origin: top.origin } : null;
  }

  var steps = best('steps');
  // Samsung Health maps a workout's calories to total-calorie records spanning
  // the session. Active-calorie records inside sessions are the fallback.
  // With no sessions at all, a workout-shaped calorie record stands in.
  var exercise = sessions.length
    ? (best('total', sessionShare) || best('active', sessionShare))
    : hsWorkoutFallback(recs);
  var active = best('active');
  if (active && exercise && active.value <= exercise.value) active = null;   // workout-only, not all-day
  return {
    superseded: superseded,
    steps: steps ? steps.value : null,
    activeCal: active ? active.value : null,
    exerciseCal: exercise ? exercise.value : null,
    sessions: sessions.length,
    exerciseInferred: !!(exercise && exercise.inferred),
    origins: {
      steps: steps ? steps.origin : null,
      activeCal: active ? active.origin : null,
      exerciseCal: exercise ? exercise.origin : null
    }
  };
}

/** No exercise session arrived, but Samsung Health writes one total-calorie
 *  record per workout: a bounded span of 10 minutes to 4 hours, one or two a
 *  day. Those are the workout, so they fill ExerciseCal.
 *
 *  The guard is the record COUNT per origin. An app that streams calories in
 *  hourly chunks would otherwise have its whole day counted as exercise, so
 *  more than three qualifying records means it is a stream, not workouts, and
 *  nothing is inferred. Records this rule cannot read stay blank rather than
 *  becoming a guess. */
function hsWorkoutFallback(recs) {
  var byOrigin = {};
  recs.forEach(function (r) {
    if (r.type !== 'total') return;
    var mins = (Date.parse(r.end) - Date.parse(r.start)) / 60000;
    if (!(mins >= 10 && mins <= 240)) return;
    (byOrigin[r.origin] = byOrigin[r.origin] || []).push(r);
  });
  var top = null;
  Object.keys(byOrigin).forEach(function (o) {
    if (byOrigin[o].length > 3) return;
    var sum = byOrigin[o].reduce(function (s, r) { return s + r.value; }, 0);
    if (!top || sum > top.value) top = { value: Math.round(sum), origin: o, inferred: true };
  });
  return top;
}

function hsSgtDate(iso) {
  return Utilities.formatDate(new Date(iso), 'Asia/Singapore', 'yyyy-MM-dd');
}

function hsShift(ymd, n) {
  var p = String(ymd).split('-');
  return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n)).toISOString().slice(0, 10);
}

function hsRawSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(HS_TAB);
  if (!sh) {
    sh = ss.insertSheet(HS_TAB);
    sh.getRange(1, 1, 1, HS_HEAD.length).setValues([HS_HEAD]);
    try { sh.hideSheet(); } catch (ignore) {}
  }
  return sh;
}

function hsLoad(sh) {
  var store = {};
  var n = sh.getLastRow() - 1;
  if (n < 1) return store;
  sh.getRange(2, 1, n, HS_HEAD.length).getValues().forEach(function (v) {
    if (!v[0]) return;
    store[String(v[0])] = {
      key: String(v[0]), type: String(v[1]), origin: String(v[2]),
      start: String(v[3]), end: String(v[4]), value: Number(v[5]),
      date: cellDate(v[6]), received: String(v[7])
    };
  });
  return store;
}

function hsSave(sh, store) {
  var old = sh.getLastRow() - 1;
  if (old > 0) sh.getRange(2, 1, old, HS_HEAD.length).clearContent();
  var rows = Object.keys(store).sort().map(function (k) {
    var r = store[k];
    return [r.key, r.type, r.origin, r.start, r.end, r.value, r.date, r.received];
  });
  if (!rows.length) return;
  if (sh.getMaxRows() < rows.length + 1) sh.insertRowsAfter(sh.getMaxRows(), rows.length + 1 - sh.getMaxRows());
  // Plain text, so Sheets never turns ISO timestamps or dates into something else.
  sh.getRange(2, 1, rows.length, HS_HEAD.length).setNumberFormat('@').setValues(rows);
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
  var cal = v[2], steps = v[6], ac = v[7], ex = v[8], bmr = v[9];
  var haveNum = function (x) { return x !== '' && x != null && !isNaN(x); };
  if (!haveNum(bmr)) { sh.getRange(row, 11, 1, 2).setValue(''); return; }
  var tdee = Math.round(Number(bmr) + activityBurn(
    haveNum(steps) ? Number(steps) : 0,
    haveNum(ac) ? Number(ac) : 0,
    haveNum(ex) ? Number(ex) : 0));
  sh.getRange(row, 11).setValue(tdee);
  sh.getRange(row, 12).setValue(haveNum(cal) ? tdee - Number(cal) : '');
}

/** The day's activity calories above resting. Steps put a FLOOR under it:
 *  Samsung Health shares its step count with Health Connect but not its
 *  activity calories, so ActiveCal comes from whichever app will estimate it,
 *  and has come back barely above the workout on a 13,500-step day. Whichever
 *  of the two is larger wins; they are never added together.
 *
 *  Keep this in step with buildDays() in assets/app.js — the dashboard
 *  recomputes from source and these two must agree. */
function activityBurn(steps, activeCal, exerciseCal) {
  var fromCals = exerciseCal * 0.7 + Math.max(0, activeCal - exerciseCal) * 0.5;
  var fromSteps = steps * 0.0004 * (latestScanWeight() || 75);
  return Math.max(fromCals, fromSteps);
}

/** Weight from the newest scan that has one, for the step rate. */
function latestScanWeight() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BASE);
  if (!sh || sh.getLastRow() < 2) return null;
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  var best = null, bestDate = '';
  for (var i = 0; i < vals.length; i++) {
    var d = cellDate(vals[i][0]), kg = vals[i][1];
    if (d && kg !== '' && kg != null && !isNaN(kg) && d >= bestDate) { bestDate = d; best = Number(kg); }
  }
  return best;
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
    var tdee = Math.round(bmr + activityBurn(row.Steps || 0, ac || 0, ex || 0));
    bits.push('burn ' + tdee);
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
  '.lbl{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:#68645B;margin-bottom:14px}' +
  '.sum{background:#16150F;color:#B4D336;padding:14px 16px;margin:16px 0;font-size:13px;word-break:break-word}' +
  '.err{background:#16150F;color:#E8836B;padding:14px 16px;margin:16px 0;font-size:13px}' +
  'table{border-collapse:collapse;width:100%;font-size:12px;margin-top:8px}' +
  'td{padding:7px 0;border-bottom:1px solid #E0DACB}' +
  'td:first-child{color:#68645B;width:45%}td:last-child{text-align:right;font-weight:500}' +
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
