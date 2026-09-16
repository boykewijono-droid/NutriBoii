/* ==========================================================================
   NutriBoii dashboard
   Reads the Google Sheet live on every load. No build step, no backend.

   Two rules that drive most of this file:
     1. The date axis is generated from the CALENDAR, then rows are matched
        onto it. A day with no row is "no data logged" — never zero.
     2. A blank cell parses to null, never 0. null is rendered as an em dash
        and is excluded from every average.
   ========================================================================== */
(function () {
'use strict';

var CFG = window.NUTRIBOII_CONFIG || {};
var TZ  = CFG.timezone || 'Asia/Singapore';
var LS_KEY = 'nutriboii.sheetId';

/* ======================================================================
   0. Small utilities
   ====================================================================== */

function $(sel, root) { return (root || document).querySelector(sel); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function nf(n, dp) {
  if (n == null || !isFinite(n)) return '—';
  return Number(n).toLocaleString('en-GB', {
    minimumFractionDigits: dp || 0, maximumFractionDigits: dp == null ? 0 : dp
  });
}
function signed(n, dp) {
  if (n == null || !isFinite(n)) return '—';
  return (n > 0 ? '+' : n < 0 ? '−' : '') + nf(Math.abs(n), dp);
}
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function mean(arr) {
  var v = arr.filter(function (x) { return x != null && isFinite(x); });
  return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : null;
}

/* --- dates: everything is a 'YYYY-MM-DD' string in SGT ----------------- */
var ymdFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
});
function todayYMD() { return ymdFmt.format(new Date()); }
function parseYMD(s) {
  var p = String(s).split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2]));
}
function toYMD(d) { return d.toISOString().slice(0, 10); }
function addDays(s, n) {
  var d = parseYMD(s); d.setUTCDate(d.getUTCDate() + n); return toYMD(d);
}
function daysBetween(a, b) {
  return Math.round((parseYMD(b) - parseYMD(a)) / 86400000);
}
/** The calendar axis: every date from `start` to `end`, gaps included. */
function calendarRange(start, end) {
  var out = [], d = start, guard = 0;
  while (d <= end && guard++ < 4000) { out.push(d); d = addDays(d, 1); }
  return out;
}
function fmtDay(s, opts) {
  var d = parseYMD(s);
  return new Intl.DateTimeFormat('en-GB', Object.assign(
    { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }, opts || {}
  )).format(d);
}
function relDay(s) {
  var t = todayYMD();
  if (s === t) return 'Today';
  if (s === addDays(t, -1)) return 'Yesterday';
  var n = daysBetween(s, t);
  return n > 0 ? n + ' days ago' : fmtDay(s);
}

/* ======================================================================
   1. CSV parsing + value coercion
   ====================================================================== */

/** RFC4180-ish parser: handles quoted fields containing commas/newlines. */
function parseCSV(text) {
  var rows = [], row = [], field = '', q = false, i = 0;
  text = text.replace(/^﻿/, '');
  while (i < text.length) {
    var c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        q = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { q = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
}

/** Header row -> array of objects, keyed by a normalised header name. */
function toObjects(rows) {
  if (!rows.length) return [];
  var head = rows[0].map(function (h) {
    return String(h).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  });
  return rows.slice(1).map(function (r) {
    var o = {};
    head.forEach(function (h, i) { if (h) o[h] = r[i] == null ? '' : String(r[i]).trim(); });
    return o;
  });
}

/** Blank -> null. Never 0. */
function num(v) {
  if (v == null) return null;
  var s = String(v).trim().replace(/,/g, '').replace(/[^0-9.\-+]/g, '');
  if (s === '' || s === '-' || s === '+' || s === '.') return null;
  var n = parseFloat(s);
  return isFinite(n) ? n : null;
}
function str(v) { var s = String(v == null ? '' : v).trim(); return s === '' ? null : s; }

/** Tolerant date coercion -> 'YYYY-MM-DD' or null. */
function coerceDate(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return null;
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
  m = s.match(/^Date\((\d+),(\d+),(\d+)/);                 // gviz native date
  if (m) return m[1] + '-' + pad(+m[2] + 1) + '-' + pad(m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);           // D/M/YYYY (sheet locale)
  if (m) return m[3] + '-' + pad(m[2]) + '-' + pad(m[1]);
  var d = new Date(s);
  return isNaN(d) ? null : ymdFmt.format(d);
}
function pad(n) { return String(n).padStart(2, '0'); }

/* ======================================================================
   2. Fetching the Sheet
   ====================================================================== */

function sheetId() {
  var url = new URLSearchParams(location.search).get('sheet');
  if (url) { try { localStorage.setItem(LS_KEY, url); } catch (e) {} return url.trim(); }
  if (CFG.sheetId) return String(CFG.sheetId).trim();
  try { return (localStorage.getItem(LS_KEY) || '').trim(); } catch (e) { return ''; }
}

function tabUrl(tabName, key) {
  var pub = CFG.publishedCsv && CFG.publishedCsv[key];
  if (pub) return pub + (pub.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now();
  return 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(sheetId()) +
         '/gviz/tq?tqx=out:csv&sheet=' + encodeURIComponent(tabName) + '&t=' + Date.now();
}

function fetchTab(tabName, key, required) {
  return fetch(tabUrl(tabName, key), { credentials: 'omit', cache: 'no-store' })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    })
    .then(function (t) {
      // gviz hands back HTML when the sheet isn't public, or when the tab is missing.
      if (/^\s*</.test(t)) throw new Error('not-public');
      if (/google\.visualization\.Query\.setResponse/.test(t)) throw new Error('bad-tab');
      return toObjects(parseCSV(t));
    })
    .catch(function (e) {
      if (required) throw e;
      return [];   // optional tabs degrade quietly to "use fallbacks"
    });
}

/* ======================================================================
   3. Model
   ====================================================================== */

var M = {          // the resolved model, rebuilt on every load
  days: {},        // ymd -> day object
  dates: [],       // sorted logged dates
  scans: [],       // InBody scans, ascending
  targets: {},
  first: null, last: null, today: todayYMD()
};

function resolveTargets(rows) {
  var t = Object.assign({}, CFG.targets || {});
  // Targets tab is a plain key/value table: Key | Value | Notes
  rows.forEach(function (r) {
    var k = (r.key || r.metric || r.setting || '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
    var v = num(r.value);
    if (k && v != null) t[k] = v;
  });
  return t;
}

function buildScans(rows) {
  return rows.map(function (r) {
    var date = coerceDate(r.date || r.scan_date);
    if (!date) return null;
    var weight = num(r.weight_kg || r.weight);
    var bf     = num(r.bodyfat_pct || r.body_fat_pct || r.bodyfat || r.body_fat);
    var fm     = num(r.bodyfatmass_kg || r.body_fat_mass_kg || r.fat_mass_kg || r.bodyfatmass);
    if (fm == null && weight != null && bf != null) fm = weight * bf / 100;
    if (bf == null && weight != null && fm != null && weight > 0) bf = fm / weight * 100;
    return {
      date: date, weight: weight, bf: bf, fatMass: fm,
      muscle: num(r.skeletalmuscle_kg || r.skeletal_muscle_kg || r.muscle_kg),
      bmr: num(r.bmr), notes: str(r.notes)
    };
  }).filter(Boolean).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
}

/** Foods that push fat up, most specific first so "olive oil" is claimed
 *  before "oil" and "carrot cake" before "cake". Any food may carry a "fried"
 *  prefix, so "fried carrot cake" is one item rather than two.
 *
 *  Matched on WORD boundaries: plain substring matching reported "oil" for
 *  boiled eggs and "nuts" for doughnuts. Weighted toward what is actually
 *  eaten here, since hawker food is where most of the hidden fat sits. */
var FAT_FOODS = [
  'char kway teow', 'nasi lemak', 'nasi goreng', 'mee goreng', 'roti prata', 'prata', 'murtabak',
  'carrot cake', 'chai tow kway', 'fried rice', 'curry puffs?', 'goreng pisang', 'banana fritters?',
  'you ?tiao', 'laksa', 'rendang', 'satay', 'peanut sauce', 'sambal oil', 'chill?i oil', 'sambal',
  'ikan bilis', 'otah', 'char si(?:u|ew)', 'siew yuk', 'roast pork', 'crispy pork', 'pork belly',
  'luncheon meat', 'spam', 'chicken skin', 'chicken thighs?', 'roast duck', 'duck', 'fried chicken',
  'coconut milk', 'coconut cream', 'santan', 'kaya butter', 'kaya toast', 'condensed milk',
  'peanut butter', 'olive oil', 'sesame oil', 'ice ?cream', 'chocolates?', 'cashews?', 'almonds?',
  'walnuts?', 'pistachios?', 'macadamias?', 'peanuts?', 'mixed nuts', 'nuts', 'doughnuts?', 'donuts?',
  'croissants?', 'pastry', 'pastries', 'cakes?', 'cookies?', 'biscuits?', 'chips', 'crisps', 'fries',
  'ghee', 'butter', 'cheese', 'cheddar', 'mozzarella', 'parmesan', 'cream', 'avocados?', 'bacon',
  'sausages?', 'salami', 'pepperoni', 'hot ?dogs?', 'mayo(?:nnaise)?', 'tahini', 'sesame', 'salmon',
  'egg yolks?', 'yolks?', 'fried eggs?', 'coconuts?', 'curry', 'oil', '(?:deep[- ])?fried'
];
// "-free", "-less" and "-off" negate: oil-free dressing, skin-off thigh.
var FAT_RES = FAT_FOODS.map(function (p) {
  return new RegExp('\\b(?:(?:deep[- ])?fried )?(?:' + p + ')\\b(?![- ]?(?:free|less|off)\\b)', 'g');
});

function escRe(t) { return String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
/** True when `word` sits inside `text` as a whole word or phrase. */
function wordIn(text, word) { return new RegExp('\\b' + escRe(word) + '\\b').test(text); }

/** Tidy one named item. Quantities and filler are stripped, so "2 tbsp olive
 *  oil" becomes "olive oil" instead of being discarded for starting with a digit. */
function cleanItem(t) {
  t = String(t || '').toLowerCase().replace(/\s+/g, ' ').trim();
  for (var i = 0; i < 3; i++) {
    t = t.replace(/^(?:~|about|approx\.?|around|roughly)\s*/, '')
         .replace(/^\d[\d.,\/]*\s*(?:g|gm|grams?|kg|ml|l|tbsps?|tsps?|cups?|pcs?|pieces?|slices?|servings?|scoops?|x)?\s+(?:of\s+)?/, '')
         .replace(/^(?:a|an|the|some|half|extra|one|two|three|four|little|bit of)\s+/, '')
         .trim();
  }
  t = t.replace(/\s*[x×]\s*\d+$/, '').replace(/\s*\([^)]*\)$/, '').replace(/[\s,;:]+$/, '').trim();
  return /[a-z]/.test(t) && t.length <= 32 ? t : '';
}

function fatDrivers(notes) {
  if (!notes) return [];
  var n = String(notes).toLowerCase();

  // 1. The note names the culprits itself: "fat over from chocolate + cashews",
  //    "fat near ceiling from x, y", "driven by: x, y". Those are the writer's
  //    own words, so they win outright.
  var m = n.match(/(?:\bdriven by\b|\bfat\b(?![- ]?free)[^.;|]*?\bfrom\b)\s*:?\s*([^.;|]+)/);
  if (m) {
    var named = [];
    m[1].split(/\s*(?:,|\+|&|\/|\band\b|\bwith\b)\s*/).forEach(function (part) {
      var item = cleanItem(part);
      if (item && named.indexOf(item) < 0) named.push(item);
    });
    if (named.length) return named.slice(0, 5);
  }

  // 2. Otherwise sweep for known fat sources, reported in the order written.
  //    "no butter" and "without oil" are skipped.
  var hits = [];
  FAT_RES.forEach(function (re) {
    re.lastIndex = 0;
    var mm;
    while ((mm = re.exec(n))) {
      var before = n.slice(Math.max(0, mm.index - 14), mm.index);
      if (/\b(?:no|without|skip(?:ped)?|zero|minus)\s+$/.test(before)) continue;
      var text = mm[0];
      if (hits.some(function (h) { return wordIn(h.text, text); })) continue;
      hits.push({ at: mm.index, text: text });
    }
  });
  return hits.sort(function (a, b) { return a.at - b.at; })
    .map(function (h) { return h.text; }).slice(0, 5);
}

function buildDays(rows, scans, targets, today) {
  var latestBMR = null;
  for (var i = scans.length - 1; i >= 0; i--) { if (scans[i].bmr != null) { latestBMR = scans[i].bmr; break; } }
  if (latestBMR == null) latestBMR = targets.bmr_fallback || null;

  var tf = CFG.tdee || {}, exF = tf.exerciseFactor == null ? 0.7 : tf.exerciseFactor,
      inF = tf.incidentalFactor == null ? 0.5 : tf.incidentalFactor;
  var map = {};

  rows.forEach(function (r) {
    var date = coerceDate(r.date);
    if (!date) return;
    var d = {
      date: date,
      dayType: normDayType(r.daytype || r.day_type),
      cal: num(r.calories), protein: num(r.protein_g), fat: num(r.fat_g), carbs: num(r.carbs_g),
      steps: num(r.steps), active: num(r.activecal || r.active_cal),
      exercise: num(r.exercisecal || r.exercise_cal),
      bmr: num(r.bmr), gym: str(r.gymday || r.gym_day), notes: str(r.notes),
      logged: true
    };
    if (d.bmr == null) d.bmr = latestBMR;

    // TDEE and Deficit are RECOMPUTED from source whenever the inputs exist,
    // and the Sheet's own columns are only a fallback. The API writes those
    // columns so the sheet reads sensibly on its own, but if a number is then
    // edited by hand the stored total goes stale — recomputing means the
    // dashboard is never wrong, whatever is sitting in those two cells.
    if (d.bmr != null) {
      var ex = d.exercise == null ? 0 : d.exercise;
      var ac = d.active   == null ? 0 : d.active;
      d.tdee = Math.round(d.bmr + ex * exF + Math.max(0, ac - ex) * inF);
    } else {
      d.tdee = num(r.tdee_target);
    }
    d.deficit = (d.tdee != null && d.cal != null)
      ? Math.round(d.tdee - d.cal)
      : num(r.deficit);

    // A day with no calories logged isn't a logged day for averaging purposes.
    d.hasIntake = d.cal != null;

    // Today is IN PROGRESS until activity is logged. Food is logged meal by
    // meal and the Samsung Health numbers arrive at night, so before then both
    // halves of the deficit are partial: intake is only what has been eaten so
    // far, and the target is resting burn alone. Treating that as a finished
    // day put a green "+900" in the hero after breakfast and inflated the
    // 7-day average. A past date is finished by definition.
    d.inProgress = date === today && d.active == null;
    d.countable  = d.hasIntake && !d.inProgress;

    // Fat has three states, not two. A hard line made 72g look as bad as
    // 118g, which trains you to ignore the colour. Amber is a heads-up
    // between the ceiling and the red threshold; red is a real overshoot.
    var ceil = targets.fat_ceiling_g, red = targets.fat_red_g;
    d.fatState = 'ok';
    if (d.fat != null && ceil != null) {
      if (red != null && d.fat > red) d.fatState = 'over';
      else if (d.fat > ceil) d.fatState = 'caution';
    }
    d.fatOver    = d.fatState === 'over';
    d.fatOverBy  = d.fatState === 'ok' || ceil == null ? null : Math.round(d.fat - ceil);
    d.proteinLow = d.protein != null && targets.protein_floor_g != null && d.protein < targets.protein_floor_g;
    // Low protein is only a WARNING once the day is done; at lunchtime it is
    // just protein still to eat. Fat stays live all day, because it only
    // ever goes up.
    d.proteinWarn = d.proteinLow && !d.inProgress;
    // Drivers are worth surfacing on amber too — that is the point at which
    // naming the foods can still change the day.
    d.drivers    = d.fatState === 'ok' ? [] : fatDrivers(d.notes);
    d.flagged    = d.fatOver || d.proteinWarn;    // amber is not a "flag"
    map[date] = d;
  });
  return map;
}

function normDayType(v) {
  var s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return null;
  var canon = CFG.dayTypes || ['Rest', 'Busy', 'Gym', 'Treat'];
  for (var i = 0; i < canon.length; i++) if (canon[i].toLowerCase() === s) return canon[i];
  return null;   // vocabulary is locked — anything else is not a day type
}

/** A placeholder for a calendar date with no row. Explicitly not zero. */
function voidDay(date) {
  return { date: date, logged: false, hasIntake: false, inProgress: false, countable: false,
           cal: null, protein: null, fat: null, carbs: null, steps: null, active: null,
           exercise: null, deficit: null, tdee: null, dayType: null, gym: null, notes: null,
           drivers: [], fatState: 'ok', proteinLow: false, proteinWarn: false, flagged: false };
}
function getDay(date) { return M.days[date] || voidDay(date); }

/** Whether he trained: 'yes', 'no', or null when not known.
 *  GymDay is written Yes / No, or occasionally as a split like "Day 2". The
 *  old check only excluded "None", so a "No" day was counted as a gym day. */
function gymState(d) {
  var g = d.gym == null ? '' : String(d.gym).trim().toLowerCase();
  if (g) return /^(?:no|n|none|false|0|rest|-|—)$/.test(g) ? 'no' : 'yes';
  return d.dayType === 'Gym' ? 'yes' : null;
}
/** What to display: the split name when there is one, otherwise Yes / No. */
function gymLabel(d) {
  var st = gymState(d);
  if (st === 'no') return 'No';
  if (st !== 'yes') return null;
  var g = d.gym == null ? '' : String(d.gym).trim();
  return g && !/^(?:yes|y|true|1)$/i.test(g) ? g : 'Yes';
}

/** Rolling average deficit over the last N calendar days, logged days only. */
function rollingDeficit(endDate, n) {
  var vals = [], span = calendarRange(addDays(endDate, -(n - 1)), endDate);
  span.forEach(function (d) {
    var day = M.days[d];
    if (day && day.deficit != null && day.countable) vals.push(day.deficit);
  });
  var end = M.days[endDate];
  return { avg: mean(vals), n: vals.length, of: n,
           pendingToday: !!(end && end.inProgress && end.hasIntake) };
}

/* --- the "why": projection to the body-fat goal ------------------------ */
function projection(targets) {
  var s = M.scans.filter(function (x) { return x.weight != null && x.fatMass != null; });
  if (s.length < 2) return { state: s.length ? 'need-more' : 'none', scans: s.length, latest: s[s.length - 1] || null };

  // Fit the rate over a recent TIME window, not a fixed number of scans.
  // Scans are irregular: with an 8-month gap in the record, 'the last four'
  // can span 41 weeks and average a period of gaining into what is supposed
  // to read as the current pace. Fall back to the last two if the window is
  // too sparse, and report the basis so a thin estimate is visibly thin.
  var win = CFG.projectionWindowDays || 120;
  var last = s[s.length - 1];
  var cutoff = addDays(last.date, -win);
  var recent = s.filter(function (x) { return x.date >= cutoff; });
  if (recent.length < 2) recent = s.slice(-2);
  var t0 = parseYMD(recent[0].date).getTime();
  var xs = recent.map(function (r) { return (parseYMD(r.date).getTime() - t0) / 604800000; }); // weeks
  var ys = recent.map(function (r) { return r.fatMass; });
  var mx = mean(xs), my = mean(ys), nume = 0, deno = 0;
  xs.forEach(function (x, i) { nume += (x - mx) * (ys[i] - my); deno += (x - mx) * (x - mx); });
  var slope = deno ? nume / deno : 0;              // kg of fat per week (negative = losing)
  var ratePerWeek = -slope;

  var cur = s[s.length - 1];
  var goalPct = targets.bodyfat_goal_pct == null ? 15 : targets.bodyfat_goal_pct;
  var lean = cur.weight - cur.fatMass;             // held constant: protein protects it
  var goalWeight = lean / (1 - goalPct / 100);
  var goalFat = goalWeight * goalPct / 100;
  var toLose = cur.fatMass - goalFat;

  if (cur.bf != null && cur.bf <= goalPct) return { state: 'reached', current: cur, goalPct: goalPct };
  var spanDays = daysBetween(recent[0].date, cur.date);
  if (ratePerWeek <= 0.005) {
    return { state: 'stalled', current: cur, goalPct: goalPct, toLose: toLose,
             ratePerWeek: ratePerWeek, used: recent.length, span: spanDays };
  }
  return {
    state: 'ok', current: cur, goalPct: goalPct, toLose: toLose,
    ratePerWeek: ratePerWeek, weeks: toLose / ratePerWeek,
    goalWeight: goalWeight, used: recent.length, span: spanDays,
    thin: recent.length < 3 || spanDays < 21
  };
}

/* ======================================================================
   4. Charts — hand-rolled SVG, measured and re-rendered on resize
   ====================================================================== */

var charts = [];
function mountChart(host, build) {
  if (!host) return;
  charts.push({ host: host, build: build });
  drawChart({ host: host, build: build });
}
function drawChart(c) {
  if (!c.host || !c.host.isConnected) return;
  var w = c.host.clientWidth;
  if (!w) return;
  try { c.host.innerHTML = c.build(w); }
  catch (e) { c.host.innerHTML = '<div class="void-note">Chart unavailable.</div>'; }
}
var rTimer;
window.addEventListener('resize', function () {
  clearTimeout(rTimer);
  rTimer = setTimeout(function () { charts.forEach(drawChart); }, 140);
});

var TIP = null;
function tipOn(e, html) {
  TIP = TIP || $('#tip');
  TIP.innerHTML = html;
  TIP.classList.add('on');
  var r = TIP.getBoundingClientRect();
  var x = clamp(e.clientX + 14, 8, window.innerWidth - r.width - 8);
  var y = e.clientY - r.height - 12;
  if (y < 8) y = e.clientY + 18;
  TIP.style.left = x + 'px'; TIP.style.top = y + 'px';
}
function tipOff() { if (TIP) TIP.classList.remove('on'); }
document.addEventListener('mouseleave', tipOff);

/** Round an axis to human steps so ticks read cleanly.
 *  Takes the RAW data min/max, never a pre-padded range: flooring a padded
 *  low to a multiple of a coarse step collapses the axis to zero and
 *  flattens everything worth seeing. The floor/ceil supply the headroom. */
function niceScale(lo, hi, ticks) {
  if (!(hi > lo)) { lo -= 1; hi += 1; }
  var raw = (hi - lo) / Math.max(1, ticks);
  var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
  var n = raw / mag;
  // a denser candidate set, so a range does not get forced onto a step
  // several times larger than it needs
  var cands = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10];
  var pick = cands[cands.length - 1];
  for (var i = 0; i < cands.length; i++) { if (n <= cands[i]) { pick = cands[i]; break; } }
  var step = pick * mag;
  return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step: step };
}

function svgOpen(w, h) { return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" role="img">'; }

/**
 * Line chart with real gaps.
 * pts: [{x01, y|null, label, tip}]  x01 is 0..1 along the axis.
 * Solid runs join consecutive logged points; a dotted segment bridges a gap;
 * unlogged dates get a dashed tick on the baseline and a "no data" tooltip.
 */
function lineChart(w, opts) {
  var h = opts.height || 210, padL = 44, padR = 12, padT = 14, padB = 26;
  var iw = Math.max(10, w - padL - padR), ih = h - padT - padB;
  var pts = opts.points;
  var vals = pts.map(function (p) { return p.y; }).filter(function (v) { return v != null; });
  if (opts.target != null) vals.push(opts.target);
  if (!vals.length) return emptyChart(w, h, opts.emptyText || 'No data logged yet');

  var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
  var ns = niceScale(lo, hi, 4);
  lo = ns.lo; hi = ns.hi;
  var X = function (p) { return padL + p.x01 * iw; };
  var Y = function (v) { return padT + ih - (v - lo) / (hi - lo) * ih; };

  var s = svgOpen(w, h);

  // horizontal grid + y labels
  for (var v = lo; v <= hi + ns.step * 0.001; v += ns.step) {
    var y = Y(v);
    s += '<line class="gridline" x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (w - padR) + '" y2="' + y.toFixed(1) + '"/>';
    s += '<text class="ax" x="' + (padL - 8) + '" y="' + (y + 3.2).toFixed(1) + '" text-anchor="end">' + (opts.fmtY ? opts.fmtY(v) : nf(v)) + '</text>';
  }
  if (opts.target != null) {
    s += '<line class="tgt" x1="' + padL + '" y1="' + Y(opts.target).toFixed(1) + '" x2="' + (w - padR) + '" y2="' + Y(opts.target).toFixed(1) + '"/>';
  }

  // split into runs of consecutive logged points. A pending point (today,
  // still being logged) never joins a solid run.
  var runs = [], run = [];
  pts.forEach(function (p) {
    if (p.y == null || p.pending) { if (run.length) { runs.push(run); run = []; } }
    else run.push(p);
  });
  if (run.length) runs.push(run);

  // dotted bridges across gaps
  for (var i = 1; i < runs.length; i++) {
    var a = runs[i - 1][runs[i - 1].length - 1], b = runs[i][0];
    s += '<path class="ser-gap" d="M' + X(a).toFixed(1) + ' ' + Y(a.y).toFixed(1) +
         ' L' + X(b).toFixed(1) + ' ' + Y(b.y).toFixed(1) + '"/>';
  }
  // solid runs
  runs.forEach(function (r) {
    if (r.length < 2) return;
    s += '<path class="ser" d="M' + r.map(function (p, i) {
      return (i ? 'L' : '') + X(p).toFixed(1) + ' ' + Y(p.y).toFixed(1);
    }).join(' ') + '"/>';
  });
  // A pending point gets a dashed lead-in from the last finished day, so a
  // half-logged today reads as provisional, not as a real drop in intake.
  pts.forEach(function (p, i) {
    if (!p.pending || p.y == null) return;
    for (var j = i - 1; j >= 0; j--) {
      if (pts[j].y != null && !pts[j].pending) {
        s += '<path class="ser-pend" d="M' + X(pts[j]).toFixed(1) + ' ' + Y(pts[j].y).toFixed(1) +
             ' L' + X(p).toFixed(1) + ' ' + Y(p.y).toFixed(1) + '"/>';
        break;
      }
    }
  });

  // missing-day ticks — a visible gap, never a zero
  pts.forEach(function (p) {
    if (p.y != null) return;
    s += '<line class="miss" x1="' + X(p).toFixed(1) + '" y1="' + (padT + ih - 9) + '" x2="' + X(p).toFixed(1) + '" y2="' + (padT + ih) + '"/>';
  });

  // points
  pts.forEach(function (p) {
    if (p.y == null) return;
    var cls = p.pending ? 'pt p' : p.flag ? 'pt f' : p.mark ? 'pt a' : 'pt';
    var r = pts.length > 20 ? 2.4 : 3.4;
    s += '<circle class="' + cls + '" cx="' + X(p).toFixed(1) + '" cy="' + Y(p.y).toFixed(1) + '" r="' + r + '"/>';
  });

  // x labels, thinned by PIXEL POSITION rather than by index. Index
  // thinning assumes even spacing; InBody scans are irregular, so evenly
  // numbered labels still overlapped wherever scans clustered.
  var minGap = 56, lastX = -1e9, keep = [];
  pts.forEach(function (p, i) {
    var x = X(p), isLast = (i === pts.length - 1);
    if (x - lastX >= minGap) { keep.push(p); lastX = x; return; }
    // the final date is the one worth keeping, so evict the label it crowds
    if (isLast) { keep.pop(); keep.push(p); lastX = x; }
  });
  keep.forEach(function (p) {
    s += '<text class="ax' + (p.y == null ? ' dim' : '') + '" x="' + X(p).toFixed(1) + '" y="' + (h - 8) + '" text-anchor="middle">' + esc(p.label) + '</text>';
  });

  // hit targets
  s += hitLayer(pts, X, padT, ih, iw / Math.max(1, pts.length - 1));
  return s + '</svg>';
}

function barChart(w, opts) {
  var h = opts.height || 190, padL = 44, padR = 12, padT = 14, padB = 26;
  var iw = Math.max(10, w - padL - padR), ih = h - padT - padB;
  var pts = opts.points;
  var vals = pts.map(function (p) { return p.y; }).filter(function (v) { return v != null; });
  if (!vals.length) return emptyChart(w, h, opts.emptyText || 'No data logged yet');

  var hi = Math.max.apply(null, vals.concat([0])), lo = Math.min.apply(null, vals.concat([0]));
  var ns = niceScale(lo, hi, 3);
  lo = ns.lo; hi = ns.hi;
  var Y = function (v) { return padT + ih - (v - lo) / (hi - lo) * ih; };
  var step = iw / pts.length, bw = Math.max(3, Math.min(30, step * 0.52));
  var zero = Y(0);

  var s = svgOpen(w, h);
  for (var v = lo; v <= hi + ns.step * 0.001; v += ns.step) {
    var y = Y(v);
    s += '<line class="gridline" x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (w - padR) + '" y2="' + y.toFixed(1) + '"/>';
    s += '<text class="ax" x="' + (padL - 8) + '" y="' + (y + 3.2).toFixed(1) + '" text-anchor="end">' + (opts.fmtY ? opts.fmtY(v) : nf(v)) + '</text>';
  }

  pts.forEach(function (p, i) {
    var cx = padL + step * (i + 0.5);
    if (p.pending) {
      // today's deficit is not known yet: a hollow marker, neither a bar nor a gap
      s += '<circle class="pt p" cx="' + cx.toFixed(1) + '" cy="' + zero.toFixed(1) + '" r="4"/>';
      return;
    }
    if (p.y == null) {
      s += '<line class="miss" x1="' + cx.toFixed(1) + '" y1="' + (zero - 8).toFixed(1) + '" x2="' + cx.toFixed(1) + '" y2="' + (zero + 8).toFixed(1) + '"/>';
      return;
    }
    var y = Y(p.y), top = Math.min(y, zero), hgt = Math.max(1.5, Math.abs(y - zero));
    s += '<rect class="bar ' + (p.y >= 0 ? 'pos' : 'neg') + '" x="' + (cx - bw / 2).toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hgt.toFixed(1) + '"/>';
  });
  s += '<line class="axline" x1="' + padL + '" y1="' + zero.toFixed(1) + '" x2="' + (w - padR) + '" y2="' + zero.toFixed(1) + '"/>';

  var every = Math.ceil(pts.length / Math.max(2, Math.floor(iw / 58)));
  pts.forEach(function (p, i) {
    if (i % every !== 0 && i !== pts.length - 1) return;
    s += '<text class="ax' + (p.y == null ? ' dim' : '') + '" x="' + (padL + step * (i + 0.5)).toFixed(1) + '" y="' + (h - 8) + '" text-anchor="middle">' + esc(p.label) + '</text>';
  });

  pts.forEach(function (p, i) {
    var x = padL + step * i;
    s += '<rect class="hit" x="' + x.toFixed(1) + '" y="' + padT + '" width="' + step.toFixed(1) + '" height="' + ih + '" data-tip="' + esc(p.tip) + '"/>' +
         '<rect class="hl-col" x="' + x.toFixed(1) + '" y="' + padT + '" width="' + step.toFixed(1) + '" height="' + ih + '"/>';
  });
  return s + '</svg>';
}

function hitLayer(pts, X, padT, ih, step) {
  var s = '';
  pts.forEach(function (p) {
    var x = X(p) - step / 2;
    s += '<rect class="hit" x="' + x.toFixed(1) + '" y="' + padT + '" width="' + Math.max(6, step).toFixed(1) + '" height="' + ih + '" data-tip="' + esc(p.tip) + '"/>' +
         '<rect class="hl-col" x="' + x.toFixed(1) + '" y="' + padT + '" width="' + Math.max(6, step).toFixed(1) + '" height="' + ih + '"/>';
  });
  return s;
}

function emptyChart(w, h, text) {
  return svgOpen(w, h) +
    '<line class="miss" x1="44" y1="' + (h / 2) + '" x2="' + (w - 12) + '" y2="' + (h / 2) + '"/>' +
    '<text class="ax dim" x="' + (w / 2) + '" y="' + (h / 2 - 12) + '" text-anchor="middle">' + esc(text) + '</text>' +
    '</svg>';
}

document.addEventListener('mouseover', function (e) {
  var t = e.target.closest && e.target.closest('.hit');
  if (t && t.dataset.tip) tipOn(e, t.dataset.tip); else tipOff();
});
document.addEventListener('mousemove', function (e) {
  var t = e.target.closest && e.target.closest('.hit');
  if (t && t.dataset.tip) tipOn(e, t.dataset.tip);
});

/** Tooltip body for one calendar date. */
function dayTip(d) {
  if (!d.logged) return '<b>' + esc(fmtDay(d.date)) + '</b><br><em>No data logged</em>';
  var s = '<b>' + esc(fmtDay(d.date)) + '</b>';
  if (d.dayType) s += ' <em>' + esc(d.dayType) + '</em>';
  if (d.inProgress) {
    s += '<br>' + (d.cal == null ? '<em>no intake logged</em>' : nf(d.cal) + ' kcal <em>so far</em>');
    s += '<br><em>deficit settles once activity is logged</em>';
  } else {
    s += '<br>' + (d.cal == null ? '<em>no intake logged</em>' : nf(d.cal) + ' kcal');
    if (d.tdee != null) s += ' <em>/ ' + nf(d.tdee) + '</em>';
    if (d.deficit != null) s += '<br>' + signed(d.deficit) + ' kcal ' + (d.deficit >= 0 ? 'deficit' : 'surplus');
  }
  if (d.protein != null) s += '<br>P ' + nf(d.protein) + 'g' +
    (d.proteinWarn ? ' <span class="w">low</span>' : d.proteinLow ? ' <em>so far</em>' : '');
  if (d.fat != null) s += ' &nbsp;F ' + nf(d.fat) + 'g' +
    (d.fatState === 'over' ? ' <span class="w">over</span>' : d.fatState === 'caution' ? ' <span class="c">high</span>' : '');
  return s;
}

/* ======================================================================
   5. Views
   ====================================================================== */

var VIEWS = [
  { id: 'today',   n: 'Today',   i: '01' },
  { id: 'week',    n: 'Week',    i: '02' },
  { id: 'trends',  n: 'Trends',  i: '03' },
  { id: 'history', n: 'History', i: '04' }
];
var current = 'today';

function buildNav() {
  $('#navRail').innerHTML = VIEWS.map(function (v) {
    return '<button type="button" data-view="' + v.id + '"><i>' + v.i + '</i>' + v.n + '</button>';
  }).join('');
  $('#navTabs').innerHTML = VIEWS.map(function (v) {
    return '<button type="button" data-view="' + v.id + '">' + v.n + '</button>';
  }).join('');
  markNav();
}
function markNav() {
  document.querySelectorAll('[data-view]').forEach(function (b) {
    b.setAttribute('aria-current', b.dataset.view === current ? 'true' : 'false');
  });
}
function go(id) {
  if (!VIEWS.some(function (v) { return v.id === id; })) id = 'today';
  current = id; markNav();
  VIEWS.forEach(function (v) { $('#view-' + v.id).classList.toggle('on', v.id === id); });
  var v = VIEWS.filter(function (x) { return x.id === id; })[0];
  $('#pageTitle').textContent = v.n;
  $('#pageWhen').textContent = pageWhen(id);
  if (location.hash.slice(1) !== id) history.replaceState(null, '', '#' + id);
  charts.forEach(drawChart);
  window.scrollTo(0, 0);
}
function pageWhen(id) {
  if (id === 'today') return fmtDay(M.today, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + ' · SGT';
  if (id === 'week') return 'Last ' + (CFG.weekDays || 7) + ' days to ' + fmtDay(M.today);
  if (id === 'trends') return M.scans.length + ' InBody scan' + (M.scans.length === 1 ? '' : 's') + ' · last ' + (CFG.trendDays || 30) + ' days of intake';
  var n = M.first ? daysBetween(M.first, M.today) + 1 : 0;
  return n ? n + ' days since ' + fmtDay(M.first, { weekday: undefined, day: 'numeric', month: 'short', year: 'numeric' }) : 'No days logged yet';
}

/* --- TODAY -------------------------------------------------------------- */
function renderToday() {
  var t = M.targets, d = getDay(M.today);
  var host = $('#view-today'), h = '';

  h += !(d.logged && d.hasIntake) ? heroVoid(d) : d.inProgress ? heroProgress(d, t) : heroSlab(d);

  // The two numbers that actually predict progress, given side by side.
  var roll = rollingDeficit(M.today, CFG.rollingWindowDays || 7);
  var proj = projection(t);
  h += '<div class="grid g2">' + rollingCell(roll) + projectionCell(proj, t) + '</div>';

  h += macroBlock(d, t);

  h += '<div class="sec"><div class="sec-head"><h2>Activity</h2><span class="lbl">Samsung Health</span></div>' +
       '<div class="grid g4">' +
         cell('Steps', d.steps == null ? null : nf(d.steps), null) +
         cell('Active', d.active == null ? null : nf(d.active), 'kcal') +
         cell('Exercise', d.exercise == null ? null : nf(d.exercise), 'kcal') +
         cell('Gym', gymLabel(d) == null ? null : esc(gymLabel(d)), null) +
       '</div></div>';

  if (d.notes) {
    h += '<div class="sec"><div class="note' + (d.flagged ? ' warn' : '') + '">' +
         '<span class="lbl">Note</span>' + esc(d.notes) + '</div></div>';
  }
  host.innerHTML = h;
}

function heroSlab(d) {
  var over = d.deficit != null && d.deficit < 0;
  var pct = d.tdee ? clamp(d.cal / d.tdee * 100, 0, 100) : 0;
  return '<div class="slab">' +
    '<div class="slab-top"><span class="lbl">' + esc(relDay(d.date)) + ' · intake</span>' +
      (d.dayType ? '<span class="chip ' + d.dayType + '">' + d.dayType + '</span>' : '') +
    '</div>' +
    '<div class="figs">' +
      '<div class="fig lead"><b>' + nf(d.cal) + '<span class="u">kcal</span></b>' +
        '<small>' + (d.tdee ? 'of ' + nf(d.tdee) + ' target' : 'no target — activity not logged') + '</small></div>' +
      (d.deficit == null ? '' :
      '<div class="fig ' + (over ? 'bad' : 'good') + '"><b>' + signed(d.deficit) + '<span class="u">kcal</span></b>' +
        '<small>' + (over ? 'surplus today' : 'deficit today') + '</small></div>') +
      (d.protein == null ? '' :
      '<div class="fig ' + (d.proteinWarn ? 'bad' : 'lead') + '"><b>' + nf(d.protein) + '<span class="u">g</span></b>' +
        '<small>protein' + (d.proteinWarn ? ' — under floor' : '') + '</small></div>') +
    '</div>' +
    (d.tdee ?
    '<div class="energy"><div class="energy-track">' +
      '<div class="energy-fill' + (over ? ' over' : '') + '" style="width:' + pct.toFixed(1) + '%"></div></div>' +
      '<div class="energy-marks"><span>0</span><span>' + nf(d.tdee) + ' kcal burned</span></div></div>' : '') +
  '</div>';
}

/** Today while it is still being logged. Shows what is actually known, intake
 *  and protein so far, and holds back the deficit, which cannot be known until
 *  tonight's activity is in. Resting burn is shown for context because it is
 *  the one part of the target that is already fixed. */
function heroProgress(d, t) {
  var floor = t.protein_floor_g;
  var toGo = d.protein != null && floor != null ? Math.max(0, Math.round(floor - d.protein)) : null;
  var bmr = d.bmr;
  var pct = bmr ? clamp(d.cal / bmr * 100, 0, 100) : 0;
  return '<div class="slab">' +
    '<div class="slab-top"><span class="lbl">Today · so far</span>' +
      (d.dayType ? '<span class="chip ' + d.dayType + '">' + d.dayType + '</span>' : '') +
    '</div>' +
    '<div class="figs">' +
      '<div class="fig lead"><b>' + nf(d.cal) + '<span class="u">kcal</span></b>' +
        '<small>eaten so far</small></div>' +
      (d.protein == null ? '' :
      '<div class="fig lead"><b>' + nf(d.protein) + '<span class="u">g</span></b>' +
        '<small>protein' + (toGo == null ? '' : toGo > 0 ? ' · ' + nf(toGo) + ' g to the floor' : ' · floor reached') +
        '</small></div>') +
    '</div>' +
    '<div class="energy">' +
      (bmr ?
      '<div class="energy-track"><div class="energy-fill" style="width:' + pct.toFixed(1) + '%"></div></div>' +
      '<div class="energy-marks"><span>0</span><span>' + nf(bmr) + ' kcal resting burn</span></div>' : '') +
      '<div class="energy-note">The deficit settles once tonight\'s activity is logged. ' +
        'Until then today stays out of the 7‑day average.</div>' +
    '</div>' +
  '</div>';
}

function heroVoid(d) {
  var last = M.dates.length ? M.dates[M.dates.length - 1] : null;
  var lastD = last ? M.days[last] : null;
  return '<div class="slab void">' +
    '<div class="slab-top"><span class="lbl">' + esc(fmtDay(M.today)) + ' · SGT</span></div>' +
    '<div class="figs"><div class="fig lead"><b style="font-size:clamp(30px,5.4vw,46px)">No data logged</b>' +
      '<small style="margin-top:12px">' + (d.logged
        ? 'A row exists for today, but no calories yet.'
        : 'Nothing written for today yet — talk to Claude and the row appears here straight away.') + '</small></div></div>' +
    (lastD ? '<div class="energy"><div class="energy-marks" style="border-top:1px solid rgba(244,241,232,.14);padding-top:12px">' +
      '<span>Last logged · ' + esc(fmtDay(last)) + '</span><span>' + nf(lastD.cal) + ' kcal · ' + signed(lastD.deficit) + '</span></div></div>' : '') +
  '</div>';
}

function rollingCell(r) {
  if (r.avg == null) {
    return '<div class="cell hl"><span class="lbl">' + r.of + '-day average deficit</span>' +
      '<span class="big none">—</span><span class="sub">' +
      (r.pendingToday ? 'Today is still in progress. It joins once activity is logged.'
                      : 'No finished days in the last ' + r.of + '.') + '</span></div>';
  }
  var good = r.avg >= 0;
  return '<div class="cell hl"><span class="lbl">' + r.of + '-day average deficit</span>' +
    '<span class="big ' + (good ? 'good' : 'bad') + '">' + signed(Math.round(r.avg)) + '<span class="u">kcal/day</span></span>' +
    '<span class="sub">Across ' + r.n + ' finished day' + (r.n === 1 ? '' : 's') + ' of the last ' + r.of + '. ' +
      (good ? '≈ ' + nf(r.avg * 7 / 7700, 2) + ' kg of fat per week.' : 'Currently in surplus.') +
      (r.pendingToday ? ' Today joins once activity is logged.' : '') +
    '</span></div>';
}

function projectionCell(p, t) {
  var goal = t.bodyfat_goal_pct == null ? 15 : t.bodyfat_goal_pct;
  var lbl = '<span class="lbl">Pace to ' + goal + '% body fat</span>';
  if (p.state === 'none')
    return '<div class="cell">' + lbl + '<span class="big none">—</span>' +
      '<span class="sub">No InBody scans in the Baselines tab yet.</span></div>';
  if (p.state === 'need-more')
    return '<div class="cell">' + lbl + '<span class="big none">1 scan</span>' +
      '<span class="sub">Currently ' + nf(p.latest.bf, 1) + '% body fat. A second scan sets the pace.</span></div>';
  if (p.state === 'reached')
    return '<div class="cell">' + lbl + '<span class="big good">Reached</span>' +
      '<span class="sub">' + nf(p.current.bf, 1) + '% at the last scan.</span></div>';
  if (p.state === 'stalled')
    return '<div class="cell">' + lbl + '<span class="big bad">Not yet</span>' +
      '<span class="sub">Fat mass is flat or rising across the last ' + p.used + ' scans (' +
      Math.round(p.span / 7) + ' weeks). ' +
      nf(p.toLose, 1) + ' kg of fat to lose from ' + nf(p.current.bf, 1) + '%.</span></div>';

  var wk = Math.round(p.weeks);
  var basis = p.used + ' scan' + (p.used === 1 ? '' : 's') + ' over ' +
    (p.span >= 14 ? Math.round(p.span / 7) + ' weeks' : p.span + ' days');
  return '<div class="cell hl">' + lbl +
    '<span class="big">~' + wk + '<span class="u">week' + (wk === 1 ? '' : 's') + '</span></span>' +
    '<span class="sub">At ' + nf(p.ratePerWeek, 2) + ' kg fat/week, from ' + nf(p.current.bf, 1) + '% today. ' +
    nf(p.toLose, 1) + ' kg to go, landing near ' + nf(p.goalWeight, 1) + ' kg.' +
    ' <em style="font-style:normal;color:var(--ink-dim)">Based on ' + basis +
    (p.thin ? ' — thin, another scan will sharpen it' : '') + '.</em></span></div>';
}

function cell(label, value, unit, cls, sub) {
  return '<div class="cell"><span class="lbl">' + esc(label) + '</span>' +
    '<span class="big ' + (value == null ? 'none' : (cls || '')) + '">' + (value == null ? '—' : value) +
    (value != null && unit ? '<span class="u">' + unit + '</span>' : '') + '</span>' +
    (sub ? '<span class="sub">' + esc(sub) + '</span>'
         : value == null ? '<span class="sub">Not logged</span>' : '') + '</div>';
}

function macroBlock(d, t) {
  if (!d.hasIntake) {
    return '<div class="sec"><div class="sec-head"><h2>Macros</h2></div>' +
      '<div class="void-note"><b>Nothing logged for this day</b>' +
      'Macro targets are not applied to days without an entry — this day is a gap in the record, not a zero.</div></div>';
  }
  var floor = t.protein_floor_g, goal = t.protein_goal_g, ceil = t.fat_ceiling_g;
  var h = '<div class="sec"><div class="sec-head"><h2>Macros</h2>' +
    '<span class="lbl">' + (d.inProgress ? 'So far today · ' : '') + 'Protein floor ' + nf(floor) + 'g · Fat amber ' + nf(ceil) + '+, red ' + nf(t.fat_red_g) + '+</span></div><div class="macros">';

  // Protein — under target is a warning state, same weight as fat over.
  var pMax = Math.max(goal * 1.25, d.protein || 0);
  h += '<div class="macro ' + (d.proteinWarn ? 'warn' : d.proteinLow ? 'pend' : 'ok') + '">' +
    '<div class="macro-top"><span class="macro-name">Protein</span>' +
    '<span class="macro-val"><b>' + nf(d.protein) + '</b> g · floor ' + nf(floor) + 'g</span></div>' +
    '<div class="track">' +
      '<div class="band" style="left:' + (floor / pMax * 100) + '%;width:' + ((goal - floor) / pMax * 100) + '%"></div>' +
      '<div class="fill" style="width:' + clamp((d.protein || 0) / pMax * 100, 0, 100) + '%"></div>' +
      '<div class="notch" style="left:' + (floor / pMax * 100) + '%"></div>' +
    '</div>';
  h += d.proteinWarn
    ? '<div class="macro-note">Protein under floor by ' + nf(floor - d.protein) + 'g — on a cut this is where muscle goes.</div>'
    : d.proteinLow
      ? '<div class="macro-foot">' + nf(floor - d.protein) + 'g to go to the ' + nf(floor) + 'g floor. The day is still in progress.</div>'
      : '<div class="macro-foot">In the ' + nf(floor) + '–' + nf(goal) + 'g band.</div>';
  h += '</div>';

  // Fat — three states. The amber band between the ceiling and the red
  // threshold is drawn on the track so the number has somewhere to sit.
  var red = t.fat_red_g == null ? ceil : t.fat_red_g;
  var fMax = Math.max(red * 1.4, d.fat || 0);
  h += '<div class="macro ' + (d.fatState === 'over' ? 'warn' : d.fatState === 'caution' ? 'caution' : 'ok') + '">' +
    '<div class="macro-top"><span class="macro-name">Fat</span>' +
    '<span class="macro-val"><b>' + nf(d.fat) + '</b> g · ceiling ' + nf(ceil) + 'g</span></div>' +
    '<div class="track">' +
      '<div class="band amber" style="left:' + (ceil / fMax * 100) + '%;width:' + ((red - ceil) / fMax * 100) + '%"></div>' +
      '<div class="fill" style="width:' + clamp((d.fat || 0) / fMax * 100, 0, 100) + '%"></div>' +
      '<div class="notch" style="left:' + (ceil / fMax * 100) + '%"></div>' +
      '<div class="notch red" style="left:' + (red / fMax * 100) + '%"></div>' +
    '</div>';
  if (d.fatState === 'over') {
    h += '<div class="macro-note">Fat over by ' + nf(d.fatOverBy) + 'g' +
      (d.drivers.length ? ' — driven by: ' + esc(d.drivers.join(', ')) : ' — no contributing foods named in the note') + '.</div>';
  } else if (d.fatState === 'caution') {
    h += '<div class="macro-note caution">' + nf(d.fatOverBy) + 'g over the ceiling, under the ' + nf(red) + 'g line' +
      (d.drivers.length ? ' — from: ' + esc(d.drivers.join(', ')) : '') + '.</div>';
  } else if (d.fat != null) {
    h += '<div class="macro-foot">' + nf(ceil - d.fat) + 'g under the ceiling.</div>';
  }
  h += '</div>';

  // Carbs — the remainder, shown without a target of its own.
  h += '<div class="macro"><div class="macro-top"><span class="macro-name">Carbs</span>' +
    '<span class="macro-val"><b>' + nf(d.carbs) + '</b> g</span></div>' +
    '<div class="track"><div class="fill" style="width:' + clamp((d.carbs || 0) / 260 * 100, 0, 100) + '%"></div></div>' +
    '<div class="macro-foot">No ceiling — carbs fill whatever calories protein and fat leave.</div></div>';

  return h + '</div></div>';
}

/* --- WEEK --------------------------------------------------------------- */
function renderWeek() {
  var n = CFG.weekDays || 7;
  var dates = calendarRange(addDays(M.today, -(n - 1)), M.today);
  var days = dates.map(getDay);
  var host = $('#view-week');

  // Averages use FINISHED days only. A half-logged today would drag average
  // intake down and push the average deficit up.
  var logged = days.filter(function (d) { return d.countable; });
  var pending = days.some(function (d) { return d.inProgress && d.hasIntake; });
  var avgCal = mean(logged.map(function (d) { return d.cal; }));
  var avgDef = mean(logged.map(function (d) { return d.deficit; }));
  var totSteps = days.reduce(function (a, d) { return a + (d.steps || 0); }, 0);
  var gyms = days.filter(function (d) { return gymState(d) === 'yes'; }).length;
  var notYet = pending ? 'Today not counted yet' : null;

  var h = '<div class="grid g4">' +
    cell('Days logged', logged.length + ' / ' + n, null, null, pending ? '+ today, in progress' : null) +
    cell('Avg intake', avgCal == null ? null : nf(Math.round(avgCal)), 'kcal', null, avgCal == null ? null : notYet) +
    cell('Avg deficit', avgDef == null ? null : signed(Math.round(avgDef)), 'kcal', avgDef >= 0 ? 'good' : 'bad', avgDef == null ? null : notYet) +
    cell('Gym days', gyms, null) +
  '</div>';

  h += '<div class="sec">' +
    '<div class="chart" id="cWeekCal"></div>' +
    '<div class="chart" id="cWeekDef"></div>' +
  '</div>';

  h += '<div class="sec"><div class="sec-head"><h2>Day by day</h2>' +
    '<span class="lbl">' + nf(totSteps) + ' steps this week</span></div>' + dayTable(days) + '</div>';

  host.innerHTML = h;

  mountChart($('#cWeekCal'), function (w) {
    return chartHead('Intake vs target',
        '<span><i class="key"></i>intake</span><span><i class="key t"></i>target</span><span><i class="key g"></i>gap in log</span>' +
        (pending ? '<span><i class="key p"></i>today, so far</span>' : '')) +
      lineChart(w, {
        target: mean(days.map(function (d) { return d.countable ? d.tdee : null; })),
        fmtY: function (v) { return nf(Math.round(v / 10) * 10); },
        points: days.map(function (d, i) {
          return { x01: i / Math.max(1, days.length - 1), y: d.cal, pending: d.inProgress, label: fmtDay(d.date, { weekday: 'short', day: 'numeric', month: undefined }), tip: dayTip(d), flag: d.flagged };
        })
      });
  });
  mountChart($('#cWeekDef'), function (w) {
    return chartHead('Daily deficit',
        '<span><i class="key a"></i>deficit</span><span><i class="key f"></i>surplus</span><span><i class="key g"></i>no data</span>' +
        (pending ? '<span><i class="key p"></i>today, pending</span>' : '')) +
      barChart(w, {
        height: 170,
        fmtY: function (v) { return signed(Math.round(v / 50) * 50); },
        points: days.map(function (d) {
          return { y: d.countable ? d.deficit : null, pending: d.inProgress && d.hasIntake, label: fmtDay(d.date, { weekday: 'short', day: undefined, month: undefined }), tip: dayTip(d) };
        })
      });
  });
}

function chartHead(title, legend) {
  return '<div class="chart-head"><h3>' + esc(title) + '</h3><div class="legend">' + legend + '</div></div>';
}

function dayTable(days) {
  var rows = days.slice().reverse().map(function (d) {
    if (!d.logged) {
      return '<tr class="void"><td>' + esc(fmtDay(d.date)) + '</td>' +
        '<td colspan="6" style="text-align:left">No data logged</td></tr>';
    }
    return '<tr class="day' + (d.date === M.today ? ' today' : '') + '" data-day="' + d.date + '" tabindex="0">' +
      '<td>' + esc(fmtDay(d.date)) + '</td>' +
      '<td>' + (d.dayType ? '<span class="dt ' + d.dayType + '">' + d.dayType + '</span>' : '<span class="dash">—</span>') + '</td>' +
      '<td><b>' + nf(d.cal) + '</b></td>' +
      (d.inProgress
        ? '<td><span class="dash">so far</span></td>'
        : '<td' + (d.deficit != null && d.deficit < 0 ? ' class="warn"' : '') + '>' + signed(d.deficit) + '</td>') +
      '<td' + (d.proteinWarn ? ' class="warn"' : '') + '>' + nf(d.protein) + '</td>' +
      '<td' + (d.fatState === 'over' ? ' class="warn"' : d.fatState === 'caution' ? ' class="caution"' : '') + '>' + nf(d.fat) + '</td>' +
      '<td>' + nf(d.steps) + '</td></tr>';
  }).join('');
  return '<div class="tw"><table><thead><tr>' +
    '<th>Date</th><th>Type</th><th>kcal</th><th>Deficit</th><th>Protein g</th><th>Fat g</th><th>Steps</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}

/* --- TRENDS ------------------------------------------------------------- */
function renderTrends() {
  var t = M.targets, host = $('#view-trends');
  var p = projection(t);
  var goal = t.bodyfat_goal_pct == null ? 15 : t.bodyfat_goal_pct;
  var cur = M.scans.length ? M.scans[M.scans.length - 1] : null;

  var h = '<div class="grid g4">' +
    cell('Weight', cur && cur.weight != null ? nf(cur.weight, 1) : null, 'kg') +
    cell('Body fat', cur && cur.bf != null ? nf(cur.bf, 1) : null, '%') +
    cell('Fat mass', cur && cur.fatMass != null ? nf(cur.fatMass, 1) : null, 'kg') +
    cell('Goal', goal + '%', null) +
  '</div>';

  h += '<div class="grid g2">' + projectionCell(p, t) + rollingCell(rollingDeficit(M.today, CFG.rollingWindowDays || 7)) + '</div>';

  h += '<div class="sec"><div class="sec-head"><h2>Body composition</h2>' +
    '<span class="lbl">' + M.scans.length + ' InBody scan' + (M.scans.length === 1 ? '' : 's') + '</span></div>' +
    '<div class="chart" id="cBf"></div><div class="chart" id="cWt"></div>' +
    '<div class="chart" id="cFm"></div></div>';

  h += '<div class="sec"><div class="sec-head"><h2>Intake, last ' + (CFG.trendDays || 30) + ' days</h2>' +
    '<span class="lbl">Calendar days · gaps are unlogged</span></div>' +
    '<div class="chart" id="cTrendCal"></div><div class="chart" id="cTrendRoll"></div></div>';

  if (M.scans.length) h += scanTable();
  host.innerHTML = h;

  var scans = M.scans.filter(function (s) { return s.bf != null; });
  // One shared time axis for every body-composition chart, so the scans line up.
  var all = M.scans;
  var t0 = all.length ? parseYMD(all[0].date) : 0;
  var span = all.length > 1 ? parseYMD(all[all.length - 1].date) - t0 : 1;
  var x01 = function (s) {
    return all.length < 2 ? 0.5 : (parseYMD(s.date) - t0) / span;
  };

  mountChart($('#cBf'), function (w) {
    return chartHead('Body fat %',
        '<span><i class="key"></i>measured</span><span><i class="key t"></i>' + goal + '% goal</span>') +
      lineChart(w, {
        target: goal,
        fmtY: function (v) { return nf(v, 1) + '%'; },
        emptyText: 'Add InBody scans to the Baselines tab',
        points: scans.map(function (s) {
          return { x01: x01(s), y: s.bf, mark: true,
            label: fmtDay(s.date, { weekday: undefined, day: 'numeric', month: 'short' }),
            tip: '<b>' + esc(fmtDay(s.date)) + '</b><br>' + nf(s.bf, 1) + '% body fat<br>' +
                 (s.weight != null ? nf(s.weight, 1) + ' kg · ' : '') + (s.fatMass != null ? nf(s.fatMass, 1) + ' kg fat' : '') };
        })
      });
  });

  var ws = M.scans.filter(function (s) { return s.weight != null; });
  mountChart($('#cWt'), function (w) {
    return chartHead('Weight',
        '<span><i class="key"></i>kg, each scan</span>') +
      lineChart(w, {
        height: 180, zeroFloor: false,
        fmtY: function (v) { return nf(v, 1); },
        emptyText: 'Add InBody scans to the Baselines tab',
        points: ws.map(function (s) {
          return { x01: x01(s), y: s.weight,
            label: fmtDay(s.date, { weekday: undefined, day: 'numeric', month: 'short' }),
            tip: '<b>' + esc(fmtDay(s.date)) + '</b><br>' + nf(s.weight, 1) + ' kg<br>' +
                 (s.fatMass != null ? nf(s.fatMass, 1) + ' kg fat mass' : '') };
        })
      });
  });

  // Fat mass gets its own chart rather than sharing the weight axis: the two
  // series differ by ~60kg, so one scale would flatten whichever lost.
  var fm = M.scans.filter(function (s) { return s.fatMass != null; });
  mountChart($('#cFm'), function (w) {
    return chartHead('Fat mass',
        '<span><i class="key"></i>kg, each scan</span><span><i class="key t"></i>at ' + goal + '%</span>') +
      lineChart(w, {
        height: 180,
        target: p.state === 'ok' ? p.current.fatMass - p.toLose : null,
        fmtY: function (v) { return nf(v, 1); },
        emptyText: 'Add InBody scans to the Baselines tab',
        points: fm.map(function (s) {
          return { x01: x01(s), y: s.fatMass, mark: true,
            label: fmtDay(s.date, { weekday: undefined, day: 'numeric', month: 'short' }),
            tip: '<b>' + esc(fmtDay(s.date)) + '</b><br>' + nf(s.fatMass, 1) + ' kg fat mass<br>' +
                 '<em>' + nf(s.bf, 1) + '% of ' + nf(s.weight, 1) + ' kg</em>' };
        })
      });
  });

  var n = CFG.trendDays || 30;
  var dates = calendarRange(addDays(M.today, -(n - 1)), M.today), days = dates.map(getDay);
  var pendingT = days.some(function (d) { return d.inProgress && d.hasIntake; });
  mountChart($('#cTrendCal'), function (w) {
    return chartHead('Intake vs target',
        '<span><i class="key"></i>intake</span><span><i class="key t"></i>avg target</span><span><i class="key g"></i>gap in log</span>' +
        (pendingT ? '<span><i class="key p"></i>today, so far</span>' : '')) +
      lineChart(w, {
        target: mean(days.map(function (d) { return d.countable ? d.tdee : null; })),
        fmtY: function (v) { return nf(Math.round(v / 100) * 100); },
        points: days.map(function (d, i) {
          return { x01: i / Math.max(1, days.length - 1), y: d.cal, flag: d.flagged, pending: d.inProgress,
            label: fmtDay(d.date, { weekday: undefined, day: 'numeric', month: undefined }), tip: dayTip(d) };
        })
      });
  });
  mountChart($('#cTrendRoll'), function (w) {
    return chartHead('Rolling ' + (CFG.rollingWindowDays || 7) + '-day average deficit',
        '<span><i class="key"></i>rolling average</span><span><i class="key t"></i>break-even</span>') +
      lineChart(w, {
        height: 180, target: 0,
        fmtY: function (v) { return signed(Math.round(v / 50) * 50); },
        points: days.map(function (d, i) {
          var r = rollingDeficit(d.date, CFG.rollingWindowDays || 7);
          return { x01: i / Math.max(1, days.length - 1), y: r.n >= 2 ? Math.round(r.avg) : null,
            label: fmtDay(d.date, { weekday: undefined, day: 'numeric', month: undefined }),
            tip: '<b>' + esc(fmtDay(d.date)) + '</b><br>' + (r.n >= 2
              ? signed(Math.round(r.avg)) + ' kcal/day<br><em>over ' + r.n + ' logged days</em>'
              : '<em>fewer than 2 logged days in window</em>') };
        })
      });
  });
}

function scanTable() {
  var rows = M.scans.slice().reverse().map(function (s, i, arr) {
    var prev = arr[i + 1];
    var dw = prev && s.weight != null && prev.weight != null ? s.weight - prev.weight : null;
    return '<tr><td>' + esc(fmtDay(s.date, { weekday: undefined, day: 'numeric', month: 'short', year: 'numeric' })) + '</td>' +
      '<td>' + nf(s.weight, 1) + '</td>' +
      '<td>' + nf(s.bf, 1) + '</td>' +
      '<td>' + nf(s.fatMass, 1) + '</td>' +
      '<td>' + nf(s.muscle, 1) + '</td>' +
      '<td>' + nf(s.bmr) + '</td>' +
      '<td>' + (dw == null ? '<span class="dash">—</span>' : signed(dw, 1)) + '</td></tr>';
  }).join('');
  return '<div class="sec"><div class="sec-head"><h2>Scan history</h2><span class="lbl">Baselines tab</span></div>' +
    '<div class="tw"><table><thead><tr><th>Date</th><th>Weight kg</th><th>Body fat %</th><th>Fat mass kg</th>' +
    '<th>Muscle kg</th><th>BMR</th><th>Δ weight</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
}

/* --- HISTORY ------------------------------------------------------------ */
var filter = { type: 'All', flagged: false };
function renderHistory() {
  var host = $('#view-history');
  if (!M.first) {
    host.innerHTML = '<div class="void-note"><b>No days logged yet</b>' +
      'Once Claude writes the first row to the Daily Log tab, every calendar day from that date onward appears here — including the days you skip.</div>';
    return;
  }
  var types = ['All'].concat(CFG.dayTypes || ['Rest', 'Busy', 'Gym', 'Treat']);
  var h = '<div class="sec-head"><div class="filters">' +
    types.map(function (t) {
      return '<button type="button" data-filter="' + t + '" aria-pressed="' + (filter.type === t) + '">' + t + '</button>';
    }).join('') +
    '<button type="button" data-flagged="1" aria-pressed="' + filter.flagged + '">Flagged only</button>' +
  '</div><span class="lbl" id="histCount"></span></div><div id="histBody"></div>';
  host.innerHTML = h;
  paintHistory();
}

function paintHistory() {
  var all = calendarRange(M.first, M.today).map(getDay);
  var rows = all.filter(function (d) {
    if (filter.flagged && !d.flagged) return false;
    if (filter.type !== 'All' && d.dayType !== filter.type) return false;
    return true;
  });
  var loggedN = rows.filter(function (d) { return d.logged; }).length;
  $('#histCount').textContent = loggedN + ' logged · ' + (rows.length - loggedN) + ' gaps';
  $('#histBody').innerHTML = rows.length
    ? dayTable(rows)
    : '<div class="void-note"><b>Nothing matches</b>No days match this filter yet.</div>';
}

/* --- day detail --------------------------------------------------------- */
var lastFocus = null;
function openDay(date) {
  var d = getDay(date), s = $('#daySheet');
  lastFocus = document.activeElement;
  var h = '<div class="sheet-top"><div><h2 id="dayTitle">' + esc(fmtDay(date, { weekday: 'long', day: 'numeric', month: 'long' })) + '</h2>' +
    '<span class="lbl">' + esc(relDay(date)) + (d.dayType ? ' · ' + d.dayType : '') + '</span></div>' +
    '<button type="button" data-act="closeDay" aria-label="Close">✕</button></div>';

  if (!d.logged) {
    h += '<div class="void-note"><b>No data logged</b>Nothing was written for this date. It is a gap in the record, not a zero-calorie day.</div>';
  } else {
    h += '<div class="rows"><h3>Energy' + (d.inProgress ? ' · so far' : '') + '</h3>' +
      row('Calories', d.cal, 'kcal') +
      (d.inProgress
        ? row('TDEE target', 'waiting on activity', '') + row('Deficit', 'waiting on activity', '')
        : row('TDEE target', d.tdee, 'kcal') +
          row('Deficit', d.deficit, 'kcal', d.deficit != null && d.deficit < 0)) +
      row('BMR', d.bmr, 'kcal') +
      '<h3>Macros</h3>' +
      row('Protein', d.protein, 'g', d.proteinWarn) +
      row('Fat', d.fat, 'g', d.fatState === 'over', d.fatState === 'caution') +
      row('Carbs', d.carbs, 'g') +
      '<h3>Activity</h3>' +
      row('Steps', d.steps, '') +
      row('Active calories', d.active, 'kcal') +
      row('Exercise calories', d.exercise, 'kcal') +
      row('Gym', gymLabel(d), '') +
      '</div>';
    if (d.fatState === 'over') {
      h += '<div class="note warn"><span class="lbl">Fat over target</span>Over by ' + nf(d.fatOverBy) + 'g' +
        (d.drivers.length ? ' — driven by: ' + esc(d.drivers.join(', ')) : '') + '.</div>';
    } else if (d.fatState === 'caution') {
      h += '<div class="note caution"><span class="lbl">Fat above the ceiling</span>' + nf(d.fatOverBy) + 'g over, ' +
        'still under the ' + nf(M.targets.fat_red_g) + 'g line' +
        (d.drivers.length ? ' — from: ' + esc(d.drivers.join(', ')) : '') + '.</div>';
    }
    if (d.proteinWarn) {
      h += '<div class="note warn"><span class="lbl">Protein under floor</span>' +
        nf(M.targets.protein_floor_g - d.protein) + 'g short of the ' + nf(M.targets.protein_floor_g) + 'g floor.</div>';
    } else if (d.proteinLow) {
      h += '<div class="note"><span class="lbl">Protein so far</span>' +
        nf(M.targets.protein_floor_g - d.protein) + 'g to go to the ' + nf(M.targets.protein_floor_g) + 'g floor.</div>';
    }
    if (d.notes) h += '<div class="note"><span class="lbl">Note</span>' + esc(d.notes) + '</div>';
  }
  s.innerHTML = h;
  s.hidden = false;
  requestAnimationFrame(function () { s.classList.add('on'); $('#scrim').classList.add('on'); });
  var btn = s.querySelector('[data-act="closeDay"]'); if (btn) btn.focus();
}
function row(label, v, unit, warn, caution) {
  var txt = v == null ? '—' : (typeof v === 'number' ? nf(v, v % 1 ? 1 : 0) + (unit ? ' ' + unit : '') : esc(v));
  var cls = warn ? 'warn' : caution ? 'caution' : v == null ? 'dash' : '';
  return '<div class="row"><span>' + esc(label) + '</span><b class="' + cls + '">' + txt + '</b></div>';
}
function closeDay() {
  var s = $('#daySheet');
  s.classList.remove('on'); $('#scrim').classList.remove('on');
  setTimeout(function () { s.hidden = true; }, 300);
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}

/* ======================================================================
   6. States + boot
   ====================================================================== */

function setSync(cls, text, showRefresh) {
  var s = $('#sync');
  s.className = 'sync' + (cls ? ' ' + cls : '');
  $('#syncText').textContent = text;
  $('#refreshBtn').hidden = !showRefresh;
}

function showLoading() {
  $('#view-today').innerHTML = '<div class="skl h1"></div><div class="grid g2">' +
    '<div class="cell"><div class="skl h2"></div></div><div class="cell"><div class="skl h2"></div></div></div>';
}

function showSetup(reason) {
  setSync('stale', 'Not connected', false);
  $('#pageTitle').textContent = 'Connect your Sheet';
  $('#pageWhen').textContent = 'One-time setup';
  $('#view-today').innerHTML =
    '<div class="state"><h2>Point this at your Google Sheet</h2>' +
    (reason ? '<p>' + esc(reason) + '</p>' : '') +
    '<p>Paste the spreadsheet ID — the long string in the Sheet URL between <code>/d/</code> and <code>/edit</code>. ' +
    'The Sheet must be shared as <b>Anyone with the link → Viewer</b>.</p>' +
    '<label class="lbl" for="sid">Spreadsheet ID or full URL</label>' +
    '<input id="sid" type="text" spellcheck="false" placeholder="1AbC…xYz" value="' + esc(sheetId()) + '">' +
    '<button type="button" class="go" data-act="saveSheet">Connect</button>' +
    '<p class="why">Saved in this browser only. To make it permanent for every device, set <code>sheetId</code> in <code>assets/config.js</code> and push.</p></div>';
  VIEWS.forEach(function (v) { $('#view-' + v.id).classList.toggle('on', v.id === 'today'); });
  var i = $('#sid'); if (i) i.focus();
}

function showError(e) {
  setSync('err', 'Could not load', true);
  var msg = String(e && e.message || e);
  var why = msg === 'not-public'
      ? 'The Sheet responded, but not with data. It is almost certainly not shared publicly yet.'
    : msg === 'bad-tab'
      ? 'The spreadsheet loaded but a tab name did not match. Check the tab is named exactly "' + esc(CFG.tabs.daily) + '".'
      : 'The request failed (' + esc(msg) + '). That is usually a wrong spreadsheet ID, or sharing not set to "Anyone with the link".';
  $('#view-today').innerHTML =
    '<div class="state err"><h2>Cannot read the Sheet</h2><p>' + why + '</p>' +
    '<ol><li>Open the Sheet → <b>Share</b> → General access → <b>Anyone with the link</b>, role <b>Viewer</b>.</li>' +
    '<li>Check the tabs are named <code>' + esc(CFG.tabs.daily) + '</code> and <code>' + esc(CFG.tabs.baselines) + '</code>.</li>' +
    '<li>Confirm the spreadsheet ID is right.</li></ol>' +
    '<button type="button" class="go" data-act="refresh">Try again</button> ' +
    '<button type="button" data-act="reconfigure" style="margin-left:14px;text-decoration:underline">Change Sheet</button></div>';
  go('today');
}

var loading = false, lastLoad = 0;

function load() {
  var id = sheetId();
  if (!id) { showSetup(); return Promise.resolve(); }
  if (loading) return Promise.resolve();
  loading = true;
  setSync('', 'Loading…', false);
  if (!M.dates.length) showLoading();

  var T = CFG.tabs || {};
  return Promise.all([
    fetchTab(T.daily     || 'Daily Log', 'daily', true),
    fetchTab(T.baselines || 'Baselines', 'baselines', false),
    fetchTab(T.targets   || 'Targets',   'targets', false)
  ]).then(function (res) {
    M.today   = todayYMD();
    M.targets = resolveTargets(res[2]);
    M.scans   = buildScans(res[1]);
    M.days    = buildDays(res[0], M.scans, M.targets, M.today);
    M.dates   = Object.keys(M.days).sort();
    M.first   = M.dates[0] || null;
    M.last    = M.dates[M.dates.length - 1] || null;

    charts.length = 0;
    renderToday(); renderWeek(); renderTrends(); renderHistory();
    go(current);

    lastLoad = Date.now();
    var t = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date());
    setSync('', 'Live · ' + t + ' SGT', true);
    $('#railStamp').textContent = M.dates.length + ' day' + (M.dates.length === 1 ? '' : 's') + ' logged';
    loading = false;
  }).catch(function (e) {
    loading = false;
    showError(e);
  });
}

/* --- events ------------------------------------------------------------- */
document.addEventListener('click', function (e) {
  var t = e.target.closest('[data-view],[data-act],[data-day],[data-filter],[data-flagged]');
  if (!t) return;
  if (t.dataset.view) return go(t.dataset.view);
  if (t.dataset.day) return openDay(t.dataset.day);
  if (t.dataset.filter) { filter.type = t.dataset.filter; return renderHistory(); }
  if (t.dataset.flagged) { filter.flagged = !filter.flagged; return renderHistory(); }
  switch (t.dataset.act) {
    case 'refresh': return load();
    case 'closeDay': return closeDay();
    case 'reconfigure': return showSetup('Currently reading: ' + (sheetId() || 'nothing') + '.');
    case 'saveSheet': {
      var raw = ($('#sid').value || '').trim();
      var m = raw.match(/\/d\/([a-zA-Z0-9-_]+)/);
      var id = m ? m[1] : raw;
      if (!id) return;
      try { localStorage.setItem(LS_KEY, id); } catch (err) {}
      CFG.sheetId = id;
      return load();
    }
  }
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && !$('#daySheet').hidden) closeDay();
  if (e.key === 'Enter' && e.target.dataset && e.target.dataset.day) openDay(e.target.dataset.day);
  if (e.key === 'Enter' && e.target.id === 'sid') {
    var b = document.querySelector('[data-act="saveSheet"]'); if (b) b.click();
  }
});
window.addEventListener('hashchange', function () { go(location.hash.slice(1) || 'today'); });

// Re-read the Sheet when returning to the tab — a row written minutes ago shows up.
document.addEventListener('visibilitychange', function () {
  if (!document.hidden && Date.now() - lastLoad > 60000 && sheetId()) load();
});

/* --- boot --------------------------------------------------------------- */
buildNav();
current = (location.hash.slice(1) || 'today');
if (!VIEWS.some(function (v) { return v.id === current; })) current = 'today';
markNav();
load();

})();
