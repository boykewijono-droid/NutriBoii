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

var DEFAULT_SHEET = CFG.sheetId ? String(CFG.sheetId).trim() : '';
function savedSheet() { try { return (localStorage.getItem(LS_KEY) || '').trim(); } catch (e) { return ''; } }

/** Where the sheet ID comes from, in order: a ?sheet= link, a choice saved in
 *  this browser, then the default in config.js. The saved choice used to lose
 *  to config.js, so "Sheet settings" quietly reverted on the next reload. */
function sheetId() {
  var url = new URLSearchParams(location.search).get('sheet');
  if (url) { try { localStorage.setItem(LS_KEY, url.trim()); } catch (e) {} return url.trim(); }
  return savedSheet() || DEFAULT_SHEET;
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
   Theme: Auto (follows the phone), Light, Dark, and Night (dark between
   the Singapore hours in config.nightHours). The <head> of index.html
   applies the same choice before first paint, so there is no light flash.
   ====================================================================== */
var THEME_KEY = 'nutriboii.theme';
var THEMES = ['system', 'light', 'dark', 'night'];
var THEME_NAMES = { system: 'Auto', light: 'Light', dark: 'Dark', night: 'Night' };
var themeMemory = null;           // used when localStorage is unavailable

function themeMode() {
  var m = themeMemory;
  try { m = localStorage.getItem(THEME_KEY) || m; } catch (e) {}
  return THEMES.indexOf(m) >= 0 ? m : 'system';
}
function sgtClock() {
  var parts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date());
  var get = function (t) { return +(parts.filter(function (p) { return p.type === t; })[0] || { value: 0 }).value; };
  return { h: get('hour'), m: get('minute') };
}
function isNight() {
  var nh = CFG.nightHours || [19, 7], h = sgtClock().h;
  return nh[0] > nh[1] ? (h >= nh[0] || h < nh[1]) : (h >= nh[0] && h < nh[1]);
}
function applyTheme() {
  var m = themeMode();
  var dark = m === 'dark' ? true : m === 'light' ? false : m === 'night' ? isNight()
           : !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  var root = document.documentElement, next = dark ? 'dark' : 'light';
  if (root.getAttribute('data-theme') !== next) root.setAttribute('data-theme', next);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#121210' : '#E9E4D8');
  var nh = CFG.nightHours || [19, 7];
  var label = $('#themeText'), btn = $('#themeBtn');
  if (label) label.textContent = THEME_NAMES[m];
  if (btn) {
    var what = m === 'night' ? 'Night: dark from ' + nh[0] + ':00 to ' + nh[1] + ':00 Singapore time'
             : m === 'system' ? 'Auto: follows your phone' : THEME_NAMES[m];
    btn.title = what;
    btn.setAttribute('aria-label', 'Theme ' + what + '. Tap to change.');
  }
}
function cycleTheme() {
  var next = THEMES[(THEMES.indexOf(themeMode()) + 1) % THEMES.length];
  themeMemory = next;
  try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
  applyTheme();
}
if (window.matchMedia) {
  var darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  if (darkQuery.addEventListener) darkQuery.addEventListener('change', applyTheme);
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

  // Steps set a floor under the day's activity. Samsung Health shares its step
  // count with Health Connect but NOT its activity calories, so ActiveCal
  // arrives from whichever app is willing to estimate it — and on a 13,500-step
  // day that came to 8 kcal above the workout, which is nonsense. Steps are the
  // number that matches the phone exactly, so when walking accounts for more
  // than the calorie figures do, walking wins. Neither is added to the other.
  var latestWeight = null;
  for (var w = scans.length - 1; w >= 0; w--) { if (scans[w].weight != null) { latestWeight = scans[w].weight; break; } }
  var perStep = (tf.stepKcalPerKg == null ? 0.0004 : tf.stepKcalPerKg) * (latestWeight || 75);
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
    var ex = d.exercise == null ? 0 : d.exercise;
    var ac = d.active   == null ? 0 : d.active;
    d.fromCals  = ex * exF + Math.max(0, ac - ex) * inF;
    d.fromSteps = d.steps == null ? 0 : d.steps * perStep;
    d.activity  = Math.max(d.fromCals, d.fromSteps);
    d.stepFloor = d.fromSteps > d.fromCals;
    if (d.bmr != null) {
      d.tdee = Math.round(d.bmr + d.activity);
    } else {
      d.tdee = num(r.tdee_target);
    }
    d.deficit = (d.tdee != null && d.cal != null)
      ? Math.round(d.tdee - d.cal)
      : num(r.deficit);

    // A day with no calories logged isn't a logged day for averaging purposes.
    d.hasIntake = d.cal != null;

    // Today is open until midnight, full stop. Nothing to close by hand.
    //
    // It used to close when the day type was logged, which meant a day nobody
    // labelled stayed "open" for ever and never reached the 7-day average —
    // and it made a label into a chore. The clock is the honest signal: while
    // the date is today, food is still arriving meal by meal and activity
    // every hour, so both halves of the deficit are partial. At midnight the
    // day is done and counts with whatever was logged; a late meal logged
    // after midnight still lands on its own date and corrects it.
    d.inProgress = date === today;
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
           activity: 0, fromCals: 0, fromSteps: 0, stepFloor: false,
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
/** The day's type, worked out when nobody wrote one. Gym only if training was
 *  logged — that is the one thing the numbers cannot tell. Otherwise it
 *  follows the activity level, and `Treat` is left alone: a deliberate
 *  higher-calorie day is a decision, not something to infer from a big
 *  dinner. Returns {type, auto}. */
function dayType(d) {
  if (d.dayType) return { type: d.dayType, auto: false };
  if (gymState(d) === 'yes') return { type: 'Gym', auto: true };
  var a = activityLevel(d);
  if (!a) return null;
  return { type: a.level === 'Low' ? 'Rest' : 'Busy', auto: true };
}
/** Just the label, for filters and tooltips. */
function dayTypeName(d) { var x = dayType(d); return x && x.type; }

/** What to display: the split name when there is one, otherwise Yes / No. */
function gymLabel(d) {
  var st = gymState(d);
  if (st === 'no') return 'No';
  if (st !== 'yes') return null;
  var g = d.gym == null ? '' : String(d.gym).trim();
  return g && !/^(?:yes|y|true|1)$/i.test(g) ? g : 'Yes';
}

/* --- the calorie target ------------------------------------------------ */
/** The planned deficit as a share of the day's burn, from the Targets tab
 *  (deficit_goal_pct). A percentage rather than a flat number: a flat 500
 *  put the target below BMR on an ordinary 2,100 kcal day, and a gym day's
 *  bigger burn deserves more food, not the same cut. */
function deficitPct(t) { return t.deficit_goal_pct == null ? 15 : t.deficit_goal_pct; }

/** Calories a day burns. A finished day's is known.
 *
 *  Today's is a forecast, and it has to hold two things at once: activity
 *  already earned never disappears, and the hours left can still add more.
 *  So it is today's own activity plus a shrinking share of what a usual day
 *  adds, which means the forecast converges on today's real burn as the day
 *  ends. Taking the bigger of "today so far" and "a usual day" instead left
 *  the target sitting on last week's average at 11pm, ignoring a long walk. */
function expectedBurn(d) {
  if (!d.inProgress) return d.tdee;
  if (d.bmr == null) return d.tdee;
  var vals = [];
  for (var i = 1; i <= 14; i++) {
    var p = M.days[addDays(d.date, -i)];
    if (p && p.countable && p.tdee != null && p.bmr != null && (p.active != null || p.exercise != null)) {
      vals.push(p.tdee - p.bmr);            // that day's activity, above resting
    }
  }
  var soFar = d.tdee != null ? d.tdee - d.bmr : 0;
  // Without a few days of history there is no honest forecast: resting burn
  // alone would set a target hundreds of calories too low.
  if (vals.length < 3) return (d.active != null || d.exercise != null) ? d.tdee : null;
  var c = sgtClock(), left = 1 - (c.h * 60 + c.m) / 1440;
  var more = Math.max(0, mean(vals) - soFar) * left;
  return Math.round((d.bmr + soFar + more) / 10) * 10;
}
/** What to eat to hit the deficit goal: the burn less deficit_goal_pct, and
 *  never below the day's BMR. */
function calorieTarget(d, t) {
  var burn = expectedBurn(d);
  if (burn == null) return null;
  var target = Math.round(burn * (1 - deficitPct(t) / 100));
  return d.bmr != null ? Math.max(target, Math.round(d.bmr)) : target;
}
/** The deficit that target stands for, in kcal: normally 15% of the burn,
 *  smaller on a low-burn day where the BMR floor holds the target up. */
function deficitGoal(d, t) {
  var burn = expectedBurn(d), target = calorieTarget(d, t);
  return burn == null || target == null ? null : Math.max(0, Math.round(burn - target));
}
/** One line saying how the target is set, for notes and legends. */
function targetRule(t) {
  return (100 - deficitPct(t)) + '% of burn, never below BMR';
}

/** Where THIS day's target came from, in a few words: the percentage of the
 *  burn, or the BMR floor when that is what set it. Without this a target
 *  that lands near the BMR reads as if it were the BMR. */
function targetBasis(d, t) {
  var burn = expectedBurn(d), target = calorieTarget(d, t);
  if (burn == null || target == null) return null;
  return Math.round(burn * (1 - deficitPct(t) / 100)) >= target
    ? (100 - deficitPct(t)) + '% of ' + (d.inProgress ? '~' : '') + nf(burn) + ' burn'
    : 'your BMR, the floor';
}

/* --- how active the day was ------------------------------------------- */
/** High / Medium / Low from what the day actually holds, so nobody has to
 *  answer a question about it. A real workout (or a logged gym day) is High;
 *  an out-and-about day is Medium; a desk day at home is Low. Thresholds sit
 *  in config.activityLevels. Returns null when nothing is known — a day with
 *  no activity logged is not a "Low" day, it is an unknown one. */
function activityLevel(d) {
  var L = CFG.activityLevels || {};
  var hEx = L.highExerciseCal == null ? 300 : L.highExerciseCal;
  var hAc = L.highActiveCal == null ? 700 : L.highActiveCal;
  var mEx = L.medExerciseCal == null ? 100 : L.medExerciseCal;
  var mAc = L.medActiveCal == null ? 400 : L.medActiveCal;
  var mSt = L.medSteps == null ? 7000 : L.medSteps;
  var gym = gymState(d) === 'yes';
  if (d.exercise == null && d.active == null && d.steps == null && !gym) return null;

  var why = [];
  if (gym) why.push(gymLabel(d) === 'Yes' ? 'gym' : String(gymLabel(d)).toLowerCase());
  if (d.exercise) why.push(nf(d.exercise) + ' kcal exercise');
  if (d.steps != null) why.push(nf(d.steps) + ' steps');
  if (d.active != null && !d.exercise) why.push(nf(d.active) + ' kcal active');

  var high = gym || (d.exercise != null && d.exercise >= hEx) || (d.active != null && d.active >= hAc);
  var med  = (d.exercise != null && d.exercise >= mEx) || (d.active != null && d.active >= mAc) ||
             (d.steps != null && d.steps >= mSt);
  return { level: high ? 'High' : med ? 'Medium' : 'Low', why: why.join(' · ') };
}

/** Rolling average deficit over the last N calendar days, logged days only. */
function rollingDeficit(endDate, n) {
  var vals = [], goals = [], span = calendarRange(addDays(endDate, -(n - 1)), endDate);
  span.forEach(function (d) {
    var day = M.days[d];
    if (day && day.deficit != null && day.countable) {
      vals.push(day.deficit);
      goals.push(deficitGoal(day, M.targets));
    }
  });
  var end = M.days[endDate];
  return { avg: mean(vals), goal: mean(goals), n: vals.length, of: n,
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
  if (!pts.some(function (p) { return p.y != null; })) return emptyChart(w, h, opts.emptyText || 'No data logged yet');

  // The scale follows finished days and targets. A half-logged today would
  // otherwise drag the axis down and flatten every finished day; it is clamped
  // onto the chart instead, with a caret when its real value is off-scale.
  var vals = [];
  pts.forEach(function (p) {
    if (p.y != null && !p.pending) vals.push(p.y);
    if (p.tgt != null) vals.push(p.tgt);
  });
  if (opts.target != null) vals.push(opts.target);
  if (!vals.length) pts.forEach(function (p) { if (p.y != null) vals.push(p.y); });

  var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
  var ns = niceScale(lo, hi, 4);
  lo = ns.lo; hi = ns.hi;
  var X = function (p) { return padL + p.x01 * iw; };
  var Y = function (v) { return padT + ih - (v - lo) / (hi - lo) * ih; };
  var yv = function (p) { return p.pending ? clamp(p.y, lo, hi) : p.y; };
  var half = pts.length > 1 ? iw / (pts.length - 1) / 2 : 8;

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
  // Each day's OWN target as a step line. A single averaged line hid that a
  // gym day's target is 400+ kcal higher than a rest day's, so a dot above
  // the old line did not actually mean a surplus that day.
  var steps = [], run0 = [];
  pts.forEach(function (p) {
    if (p.tgt == null) { if (run0.length) { steps.push(run0); run0 = []; } }
    else run0.push(p);
  });
  if (run0.length) steps.push(run0);
  steps.forEach(function (r) {
    var d = '';
    r.forEach(function (p, i) {
      var x1 = Math.max(padL, X(p) - half), x2 = Math.min(w - padR, X(p) + half), y = Y(p.tgt).toFixed(1);
      d += (i ? ' L' : 'M') + x1.toFixed(1) + ' ' + y + ' L' + x2.toFixed(1) + ' ' + y;
    });
    s += '<path class="tgt" d="' + d + '"/>';
  });

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
             ' L' + X(p).toFixed(1) + ' ' + Y(yv(p)).toFixed(1) + '"/>';
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
    var r = pts.length > 20 ? 2.4 : 3.4, cy = Y(yv(p)), cx = X(p);
    s += '<circle class="' + cls + '" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + r + '"/>';
    // off-scale: a caret pointing the way the real value lies
    if (p.pending && p.y < lo) {
      s += '<path class="caret" d="M' + (cx - 4).toFixed(1) + ' ' + (cy + 7).toFixed(1) + ' L' + (cx + 4).toFixed(1) + ' ' +
           (cy + 7).toFixed(1) + ' L' + cx.toFixed(1) + ' ' + (cy + 11).toFixed(1) + ' Z"/>';
    } else if (p.pending && p.y > hi) {
      s += '<path class="caret" d="M' + (cx - 4).toFixed(1) + ' ' + (cy - 7).toFixed(1) + ' L' + (cx + 4).toFixed(1) + ' ' +
           (cy - 7).toFixed(1) + ' L' + cx.toFixed(1) + ' ' + (cy - 11).toFixed(1) + ' Z"/>';
    }
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
  keep.forEach(function (p, k) {
    var txt = p.labelFull && (k === 0 || p.mkey !== keep[k - 1].mkey) ? p.labelFull : p.label;
    s += '<text class="ax' + (p.y == null ? ' dim' : '') + '" x="' + X(p).toFixed(1) + '" y="' + (h - 8) + '" text-anchor="middle">' + esc(txt) + '</text>';
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
    s += '<rect class="hit" x="' + x.toFixed(1) + '" y="' + padT + '" width="' + step.toFixed(1) + '" height="' + ih + '" data-tip="' + esc(p.tip) + '"' +
         (p.date ? ' data-day="' + p.date + '"' : '') + '/>' +
         '<rect class="hl-col" x="' + x.toFixed(1) + '" y="' + padT + '" width="' + step.toFixed(1) + '" height="' + ih + '"/>';
  });
  return s + '</svg>';
}

function hitLayer(pts, X, padT, ih, step) {
  var s = '';
  pts.forEach(function (p) {
    var x = X(p) - step / 2;
    s += '<rect class="hit" x="' + x.toFixed(1) + '" y="' + padT + '" width="' + Math.max(6, step).toFixed(1) + '" height="' + ih + '" data-tip="' + esc(p.tip) + '"' +
         (p.date ? ' data-day="' + p.date + '"' : '') + '/>' +
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
  if (dayTypeName(d)) s += ' <em>' + esc(dayTypeName(d)) + '</em>';
  var target = calorieTarget(d, M.targets);
  if (d.inProgress) {
    s += '<br>' + (d.cal == null ? '<em>no food logged yet</em>' : nf(d.cal) + ' kcal <em>so far</em>');
    if (target != null) s += ' <em>· target ~' + nf(target) + '</em>';
    s += '<br><em>day still open, deficit not final</em>';
  } else {
    s += '<br>' + (d.cal == null ? '<em>no food logged</em>' : nf(d.cal) + ' kcal');
    if (target != null) s += ' <em>· target ' + nf(target) + '</em>';
    if (d.deficit != null) s += '<br>' + signed(d.deficit) + ' kcal ' + (d.deficit >= 0 ? 'deficit' : 'surplus') +
      (d.tdee != null ? ' <em>· burned ' + nf(d.tdee) + '</em>' : '');
  }
  if (d.protein != null) s += '<br>P ' + nf(d.protein) + 'g' +
    (d.proteinWarn ? ' <span class="w">short</span>' : d.proteinLow ? ' <em>so far</em>' : '');
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
/** keepScroll: a background refresh re-renders the current view in place, so
 *  it must not throw the page back to the top. Only a real change of view
 *  scrolls. */
function go(id, keepScroll) {
  if (!VIEWS.some(function (v) { return v.id === id; })) id = 'today';
  var changed = id !== current;
  current = id; markNav();
  VIEWS.forEach(function (v) { $('#view-' + v.id).classList.toggle('on', v.id === id); });
  var v = VIEWS.filter(function (x) { return x.id === id; })[0];
  $('#pageTitle').textContent = v.n;
  $('#pageWhen').textContent = pageWhen(id);
  if (location.hash.slice(1) !== id) history.replaceState(null, '', '#' + id);
  charts.forEach(drawChart);
  if (changed && !keepScroll) window.scrollTo(0, 0);
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

  // Today is always the running card: it closes itself at midnight, so the
  // "complete" version could never appear here. A row holding only synced
  // activity still gets it; only a missing row falls back to the void card.
  h += d.logged ? heroProgress(d, t) : heroVoid(d);

  // The finished day, in one line, so closing the day still feels like
  // something. Tapping it opens that day in full.
  h += lastDayStrip(t);

  // The two numbers that actually predict progress, given side by side.
  var roll = rollingDeficit(M.today, CFG.rollingWindowDays || 7);
  var proj = projection(t);
  h += '<div class="grid g2">' + rollingCell(roll) + projectionCell(proj, t) + '</div>';

  h += macroBlock(d, t);

  h += '<div class="sec"><div class="sec-head"><h2>Activity</h2><span class="lbl">Samsung Health</span></div>' +
       '<div class="grid g4">' +
         cell('Steps', d.steps == null ? null : nf(d.steps), null, null, d.inProgress && d.steps != null ? 'so far today' : null) +
         cell('Active', d.active == null ? null : nf(d.active), 'kcal', null, d.inProgress && d.active != null ? 'so far today' : null) +
         cell('Exercise', d.exercise == null ? null : nf(d.exercise), 'kcal', null,
              d.exercise != null && d.inProgress ? 'so far today' : null) +
         (function () {
           var a = activityLevel(d);
           return cell('Activity', a && a.level, null, a && a.level === 'High' ? 'good' : '',
                       a ? (d.inProgress ? 'So far today · ' : '') + a.why : null);
         })() +
       '</div></div>';

  if (d.notes) {
    h += '<div class="sec"><div class="note' + (d.flagged ? ' warn' : '') + '">' +
         '<span class="lbl">Note</span>' + noteHtml(d.notes) + '</div></div>';
  }
  host.innerHTML = h;
  paintHero(host);
}

/** The day-type chip, dotted when it was worked out rather than logged. */
function chip(d) {
  var x = dayType(d);
  if (!x) return '';
  return '<span class="chip ' + x.type + (x.auto ? ' auto' : '') + '"' +
    (x.auto ? ' title="Worked out from the day&#39;s activity"' : '') + '>' + x.type + '</span>';
}

/** The last finished day, as one tappable line: its deficit against that
 *  day's goal, and what it took. The Today card can no longer show a finished
 *  day, because midnight rolls it over into the next one. */
function lastDayStrip(t) {
  var date = null;
  for (var i = M.dates.length - 1; i >= 0; i--) {
    if (M.dates[i] < M.today && M.days[M.dates[i]].hasIntake) { date = M.dates[i]; break; }
  }
  if (!date) return '';
  var p = M.days[date], goal = deficitGoal(p, t), target = calorieTarget(p, t);
  var cls = p.deficit == null ? '' : p.deficit < 0 ? 'bad' : goal == null || p.deficit >= goal ? 'good' : 'caution';
  var bits = [];
  if (p.cal != null) bits.push(nf(p.cal) + ' eaten');
  if (p.tdee != null) bits.push(nf(p.tdee) + ' burned');
  if (target != null) bits.push('target ' + nf(target));
  if (goal != null) bits.push('goal ' + signed(goal));
  return '<div class="lastday" data-day="' + date + '" tabindex="0" role="button">' +
    '<span class="lbl">' + esc(relDay(date)) + (dayTypeName(p) ? ' \u00b7 ' + esc(dayTypeName(p)) : '') + ' \u00b7 done</span>' +
    '<b class="' + cls + '">' + signed(p.deficit) + '<span class="u">kcal</span></b>' +
    '<span class="sub">' + esc(bits.join(' \u00b7 ')) + '</span></div>';
}

/** Today while it is still open. Shows what is actually known: what has been
 *  eaten against today's calorie target, an estimate of what has been burned
 *  up to now, and protein and fat with their balance. The day's deficit is
 *  held back until it is closed. */
function heroProgress(d, t) {
  var burned = burnedSoFar(d);
  var synced = d.active != null || d.exercise != null;
  var target = calorieTarget(d, t), burn = expectedBurn(d);
  // Intake stays white: the bar and the line under it already say where it
  // sits against the target, and the deficit beside it is what should catch
  // the eye.
  // The running deficit is the number worth watching: what you have burned so
  // far, less what you have eaten. It is the whole point of the dashboard, so
  // it sits beside the intake rather than being held back until midnight.
  var run = burned != null && d.cal != null ? burned - d.cal : null;
  return '<div class="slab">' +
    '<div class="slab-top"><span class="lbl">Today · so far</span>' +
      chip(d) +
    '</div>' +
    '<div class="figs">' +
      (d.cal == null
        ? '<div class="fig lead"><b class="words">No food yet</b><small>nothing eaten logged today</small></div>'
        : '<div class="fig lead"><b>' + nf(d.cal) + '<span class="u">kcal</span></b><small>eaten so far</small></div>') +
      (run == null ? '' :
      // Resting burn accrues by the minute while food arrives in lumps, so a
      // breakfast puts this number below zero every morning. That is not a
      // surplus — the day has barely started. Early on it reads as being
      // ahead of the burn, in amber; only later in the day is a negative
      // number a real surplus.
      (function () {
        var early = dayFraction() < 0.6;
        var cls = run >= 0 ? 'good' : early ? 'caution' : 'bad';
        var label = run >= 0 ? 'deficit so far today'
                  : early ? 'eaten ahead of burn so far' : 'surplus so far today';
        return '<div class="fig big-deficit ' + cls + '"><b><span data-count="' + run + '">' +
          signed(run) + '</span><span class="u">kcal</span></b><small>' + label + '</small></div>';
      })()) +
    '</div>' +
    (d.cal == null
      ? (target == null ? '' : '<div class="energy"><div class="energy-bal">Today\'s target ~' + nf(target) + ' kcal</div></div>')
      : energyBar(d.cal, target, burn, true, targetBasis(d, t))) +
    (burned == null ? '' :
      '<div class="burn-line">≈' + nf(burned) + ' kcal burned so far · ' +
        (synced ? 'resting burn to now + activity' : 'resting burn to now') +
        (burn != null && burn > burned ? ' · on pace for ~' + nf(burn) + ' by midnight' : '') + '</div>') +
    macroStats(d, t) +
    '<div class="energy-note">Today counts in the 7‑day average from midnight, when the day is done. ' +
      'Nothing to close by hand.' +
      (target == null ? ''
        : burn != null && Math.round(burn * (1 - deficitPct(t) / 100)) < target
          ? ' The target is normally ' + (100 - deficitPct(t)) + '% of the day\'s burn, but today it is held at your ' +
            nf(target) + ' kcal BMR: a ' + deficitPct(t) + '% deficit on a day this quiet would mean eating below it.'
          : ' The target is ' + (100 - deficitPct(t)) + '% of the day\'s burn, a ' + deficitPct(t) +
            '% deficit, and never below your BMR.') + '</div>' +
  '</div>';
}

/** Lime at or under the target; amber over it but still under the burn, so
 *  still a deficit, just a smaller one; red past the burn, a surplus. */
function energyClass(eaten, target, burn) {
  if (target == null) return burn != null && eaten > burn ? 'bad' : '';
  return eaten <= target ? 'good' : burn != null && eaten <= burn ? 'caution' : 'bad';
}

/** Eaten against the calorie target, with the balance said in words. The
 *  track runs to the burn (today's is a forecast), so the gap between the
 *  target mark and the end is the deficit goal. Only a finished day labels
 *  the burn: today's forecast is already in the note below. */
function energyBar(eaten, target, burn, open, basis) {
  if (eaten == null || (target == null && burn == null)) return '';
  var top = Math.max(burn || 0, target || 0, eaten) * (burn == null ? 1.15 : 1);
  var cls = energyClass(eaten, target, burn);
  var bal = '';
  if (target != null) {
    var diff = Math.round(target - eaten), tl = (open ? '~' : '') + nf(target);
    bal = diff >= 0
      ? nf(diff) + ' kcal ' + (open ? 'left of' : 'under') + ' ' + (open ? 'today\'s' : 'your') + ' ' + tl + ' kcal target'
      : nf(-diff) + ' kcal over ' + (open ? 'today\'s' : 'your') + ' ' + tl + ' kcal target';
    // Say where the target came from. Without it, a target near the BMR reads
    // as if it WERE the BMR, and nothing on screen says otherwise.
    if (basis) bal += ' · ' + basis;
  }
  return '<div class="energy"><div class="energy-track">' +
      '<div class="energy-fill ' + cls + '" style="width:0%" data-w="' + clamp(eaten / top * 100, 0, 100).toFixed(1) + '"></div>' +
      (target != null ? '<s style="left:' + clamp(target / top * 100, 0, 100).toFixed(1) + '%"></s>' : '') +
    '</div>' +
    (bal ? '<div class="energy-bal ' + cls + '">' + bal + '</div>' : '') +
    (burn != null && !open ? '<div class="energy-marks"><span>eaten</span><span>' +
      (target != null ? 'target ' + nf(target) + ' · ' : '') + nf(burn) + ' kcal burned</span></div>' : '') +
  '</div>';
}

/** Estimated calories burned from midnight until now: resting burn for the
 *  share of the day that has passed, plus the activity synced so far, using
 *  the same weights as the daily target. */
/** How much of the Singapore day has passed, 0 to 1. */
function dayFraction() {
  var c = sgtClock();
  return (c.h * 60 + c.m) / 1440;
}

function burnedSoFar(d) {
  if (d.bmr == null) return null;
  // Resting burn for the share of the day that has passed, plus every
  // activity calorie earned so far — the same activity figure the day's
  // total uses, steps floor and all.
  return Math.round(d.bmr * dayFraction() + (d.activity || 0));
}

/** Protein and fat at a glance, the balance said in plain words: "57 g short
 *  of your 150 g target" rather than "under floor", which only makes sense if
 *  you already know what the floor is. */
function macroStats(d, t) {
  var out = '';
  var target = t.protein_floor_g, limit = t.fat_ceiling_g;
  var red = t.fat_red_g == null ? limit : t.fat_red_g;
  if (d.protein != null && target != null) {
    var diff = Math.round(d.protein - target);
    // still to eat is amber, a heads-up; short on a finished day is red
    var pCls = diff >= 0 ? 'good' : d.inProgress ? 'caution' : 'bad';
    var pBal = diff >= 0 ? nf(diff) + ' g above your ' + nf(target) + ' g target'
             : nf(-diff) + ' g ' + (d.inProgress ? 'to go to' : 'short of') + ' your ' + nf(target) + ' g target';
    var pMax = Math.max(target * 1.25, d.protein);
    out += stat('Protein', d.protein, pCls, pBal, d.protein / pMax, target / pMax);
  }
  if (d.fat != null && limit != null) {
    var left = Math.round(limit - d.fat);
    var fCls = d.fatState === 'over' ? 'bad' : d.fatState === 'caution' ? 'caution' : 'good';
    var fBal = left >= 0 ? nf(left) + ' g left before your ' + nf(limit) + ' g limit'
             : nf(-left) + ' g over your ' + nf(limit) + ' g limit';
    var fMax = Math.max(red * 1.3, d.fat);
    out += stat('Fat', d.fat, fCls, fBal, d.fat / fMax, limit / fMax);
  }
  return out ? '<div class="stats">' + out + '</div>' : '';
}
function stat(name, value, cls, balance, frac, mark) {
  return '<div class="stat ' + (cls || '') + '"><span class="k">' + name + '</span>' +
    '<b class="v">' + nf(value) + '<span class="u">g</span></b>' +
    '<div class="mini"><i style="width:' + clamp(frac * 100, 0, 100).toFixed(1) + '%"></i>' +
      '<s style="left:' + clamp(mark * 100, 0, 100).toFixed(1) + '%"></s></div>' +
    '<span class="bal">' + esc(balance) + '</span></div>';
}

/* --- the one bit of motion in the whole page ---------------------------
   The deficit is the number this exists to move, so on paint it counts up
   and the energy bar fills. Only when the value has actually changed, so a
   background refresh every ten minutes does not keep replaying it, and never
   when the reader has asked for reduced motion. */
var lastCounted = null;
function paintHero(root) {
  if (!root || !root.querySelectorAll) return;
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var raf = window.requestAnimationFrame;

  var bar = root.querySelector('.energy-fill[data-w]');
  if (bar) {
    var w = bar.getAttribute('data-w') + '%';
    if (reduce || !raf) bar.style.width = w;
    else raf(function () { bar.style.width = w; });
  }

  var el = root.querySelector('[data-count]');
  if (!el) { lastCounted = null; return; }
  var to = Number(el.getAttribute('data-count'));
  var end = el.textContent;
  if (!isFinite(to) || reduce || !raf || lastCounted === to) return;
  lastCounted = to;
  var t0 = null, dur = 850;
  raf(function step(ts) {
    if (t0 == null) t0 = ts;
    var k = Math.min(1, (ts - t0) / dur);
    if (k >= 1) { el.textContent = end; return; }
    el.textContent = signed(Math.round(to * (1 - Math.pow(1 - k, 3))));
    raf(step);
  });
}

/** Notes are a food diary now: one timestamped line per meal, written by the
 *  API with the sheet's own clock. Keep the lines apart on screen. */
function noteHtml(t) { return esc(t).split(/\r?\n/).join('<br>'); }

function heroVoid(d) {
  // No "last logged" line here: lastDayStrip() sits directly underneath and
  // says the same thing with more in it.
  return '<div class="slab void">' +
    '<div class="slab-top"><span class="lbl">' + esc(fmtDay(M.today)) + ' · SGT</span></div>' +
    '<div class="figs"><div class="fig lead"><b style="font-size:clamp(30px,5.4vw,46px)">No data logged</b>' +
      '<small style="margin-top:12px">' + (d.logged
        ? 'A row exists for today, but no calories yet.'
        : 'Nothing written for today yet — talk to Claude and the row appears here straight away.') + '</small></div></div>' +
  '</div>';
}

function rollingCell(r) {
  var goal = r.goal == null ? null : Math.round(r.goal);
  if (r.avg == null) {
    return '<div class="cell hl"><span class="lbl">' + r.of + '-day average deficit</span>' +
      '<span class="big none">—</span><span class="sub">' +
      (r.pendingToday ? 'Today is still running. It counts from midnight.'
                      : 'No finished days in the last ' + r.of + '.') + '</span></div>';
  }
  var good = r.avg >= 0;
  return '<div class="cell hl"><span class="lbl">' + r.of + '-day average deficit</span>' +
    '<span class="big ' + (!good ? 'bad' : goal == null || r.avg >= goal ? 'good' : 'caution') + '">' + signed(Math.round(r.avg)) + '<span class="u">kcal/day</span></span>' +
    '<span class="sub">' + (goal != null ? 'Goal ' + signed(goal) + ' (' + deficitPct(M.targets) + '% of burn). ' : '') +
      'Across ' + r.n + ' finished day' + (r.n === 1 ? '' : 's') + ' of the last ' + r.of + '. ' +
      (good ? '≈ ' + nf(r.avg * 7 / 7700, 2) + ' kg of fat per week.' : 'Currently in surplus.') +
      (r.pendingToday ? ' Today counts from midnight.' : '') +
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
      (p.span >= 14 ? Math.round(p.span / 7) + ' weeks' : p.span + ' day' + (p.span === 1 ? '' : 's')) + '). ' +
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
      (d.inProgress
        ? '<div class="void-note"><b>No food logged yet today</b>Protein and fat appear here as soon as Claude logs the first meal.</div></div>'
        : '<div class="void-note"><b>Nothing logged for this day</b>' +
          'Macro targets are not applied to days without an entry — this day is a gap in the record, not a zero.</div></div>');
  }
  var floor = t.protein_floor_g, ceil = t.fat_ceiling_g;
  var goal = t.protein_goal_g == null ? floor : t.protein_goal_g;
  var h = '<div class="sec"><div class="sec-head"><h2>Macros</h2>' +
    '<span class="lbl">' + (d.inProgress ? 'So far today · ' : '') + 'Protein target <span class="nc">' + nf(floor) + ' g</span> · Fat limit <span class="nc">' + nf(ceil) + ' g</span></span></div><div class="macros">';

  // Protein — under target is a warning state, same weight as fat over.
  var pMax = Math.max(goal * 1.25, d.protein || 0);
  h += '<div class="macro ' + (d.proteinWarn ? 'warn' : d.proteinLow ? 'caution' : d.protein == null ? '' : 'ok') + '">' +
    '<div class="macro-top"><span class="macro-name">Protein</span>' +
    '<span class="macro-val"><b>' + nf(d.protein) + '</b> g · target ' + nf(floor) + ' g</span></div>' +
    '<div class="track">' +
      '<div class="band" style="left:' + (floor / pMax * 100) + '%;width:' + ((goal - floor) / pMax * 100) + '%"></div>' +
      '<div class="fill" style="width:' + clamp((d.protein || 0) / pMax * 100, 0, 100) + '%"></div>' +
      '<div class="notch" style="left:' + (floor / pMax * 100) + '%"></div>' +
    '</div>';
  h += d.proteinWarn
    ? '<div class="macro-note">' + nf(floor - d.protein) + ' g short of the ' + nf(floor) + ' g target — on a cut this is where muscle goes.</div>'
    : d.proteinLow
      ? '<div class="macro-foot">' + nf(floor - d.protein) + ' g to go to the ' + nf(floor) + ' g target. The day is still open.</div>'
      : d.protein == null
        ? '<div class="macro-foot">Not logged.</div>'
        : '<div class="macro-foot">' + (d.protein > goal ? nf(d.protein - floor) + ' g above the target.'
                                       : 'Within the ' + nf(floor) + '–' + nf(goal) + ' g target range.') + '</div>';
  h += '</div>';

  // Fat — three states. The amber band between the ceiling and the red
  // threshold is drawn on the track so the number has somewhere to sit.
  var red = t.fat_red_g == null ? ceil : t.fat_red_g;
  var fMax = Math.max(red * 1.4, d.fat || 0);
  h += '<div class="macro ' + (d.fatState === 'over' ? 'warn' : d.fatState === 'caution' ? 'caution' : d.fat == null ? '' : 'ok') + '">' +
    '<div class="macro-top"><span class="macro-name">Fat</span>' +
    '<span class="macro-val"><b>' + nf(d.fat) + '</b> g · limit ' + nf(ceil) + ' g</span></div>' +
    '<div class="track">' +
      '<div class="band amber" style="left:' + (ceil / fMax * 100) + '%;width:' + ((red - ceil) / fMax * 100) + '%"></div>' +
      '<div class="fill" style="width:' + clamp((d.fat || 0) / fMax * 100, 0, 100) + '%"></div>' +
      '<div class="notch" style="left:' + (ceil / fMax * 100) + '%"></div>' +
      '<div class="notch red" style="left:' + (red / fMax * 100) + '%"></div>' +
    '</div>';
  if (d.fatState === 'over') {
    h += '<div class="macro-note">' + nf(d.fatOverBy) + ' g over the ' + nf(ceil) + ' g limit' +
      (d.drivers.length ? ' — driven by: ' + esc(d.drivers.join(', ')) : ' — no contributing foods named in the note') + '.</div>';
  } else if (d.fatState === 'caution') {
    h += '<div class="macro-note caution">' + nf(d.fatOverBy) + ' g over the ' + nf(ceil) + ' g limit, still under ' + nf(red) + ' g' +
      (d.drivers.length ? ' — from: ' + esc(d.drivers.join(', ')) : '') + '.</div>';
  } else if (d.fat != null) {
    h += '<div class="macro-foot">' + nf(ceil - d.fat) + ' g left before the limit.</div>';
  } else {
    h += '<div class="macro-foot">Not logged.</div>';
  }
  h += '</div>';

  // Carbs — the remainder, shown without a target of its own.
  h += '<div class="macro"><div class="macro-top"><span class="macro-name">Carbs</span>' +
    '<span class="macro-val"><b>' + nf(d.carbs) + '</b> g</span></div>' +
    '<div class="track"><div class="fill" style="width:' + clamp((d.carbs || 0) / 260 * 100, 0, 100) + '%"></div></div>' +
    '<div class="macro-foot">No limit — carbs fill whatever calories protein and fat leave.</div></div>';

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
  var avgGoal = mean(logged.map(function (d) { return d.deficit == null ? null : deficitGoal(d, M.targets); }));
  avgGoal = avgGoal == null ? null : Math.round(avgGoal);
  var totSteps = days.reduce(function (a, d) { return a + (d.steps || 0); }, 0);
  var gyms = days.filter(function (d) { return gymState(d) === 'yes'; }).length;
  var notYet = pending ? 'Today not counted yet' : null;

  var h = '<div class="grid g4">' +
    cell('Days logged', logged.length + ' / ' + n, null, null, pending ? '+ today, in progress' : null) +
    cell('Avg intake', avgCal == null ? null : nf(Math.round(avgCal)), 'kcal', null, avgCal == null ? null : notYet) +
    cell('Avg deficit', avgDef == null ? null : signed(Math.round(avgDef)), 'kcal',
         avgDef < 0 ? 'bad' : avgGoal == null || avgDef >= avgGoal ? 'good' : 'caution',
         avgDef == null ? null : notYet || (avgGoal == null ? null : 'goal ' + signed(avgGoal))) +
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
        '<span><i class="key"></i>intake</span><span><i class="key t"></i>target: ' + targetRule(M.targets) + '</span><span><i class="key g"></i>gap in log</span>' +
        (days.some(function (d) { return d.flagged; }) ? '<span><i class="key fd"></i>protein short or fat over</span>' : '') +
        (pending ? '<span><i class="key p"></i>today, so far</span>' : '')) +
      lineChart(w, {
        fmtY: function (v) { return nf(Math.round(v / 10) * 10); },
        points: days.map(function (d, i) {
          return { x01: i / Math.max(1, days.length - 1), y: d.cal, tgt: d.countable ? calorieTarget(d, M.targets) : null, pending: d.inProgress,
                   date: d.date, label: fmtDay(d.date, { weekday: 'short', day: 'numeric', month: undefined }), tip: dayTip(d), flag: d.flagged };
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
          return { y: d.countable ? d.deficit : null, pending: d.inProgress && d.hasIntake, date: d.date, label: fmtDay(d.date, { weekday: 'short', day: undefined, month: undefined }), tip: dayTip(d) };
        })
      });
  });
}

function chartHead(title, legend) {
  return '<div class="chart-head"><h3>' + esc(title) + '</h3><div class="legend">' + legend + '</div></div>';
}

function dayTable(days) {
  var rows = days.slice().reverse().map(function (d) {
    var when = '<span class="d-long">' + esc(fmtDay(d.date)) + '</span>' +
               '<span class="d-short">' + esc(fmtDay(d.date, { month: undefined })) + '</span>';
    if (!d.logged) {
      return '<tr class="void"><td>' + when + '</td><td class="opt"></td>' +
        '<td colspan="4" style="text-align:left">No data logged</td><td class="opt"></td></tr>';
    }
    return '<tr class="day' + (d.date === M.today ? ' today' : '') + '" data-day="' + d.date + '" tabindex="0">' +
      '<td>' + when + '</td>' +
      '<td class="opt">' + (function () { var x = dayType(d); return x ? '<span class="dt ' + x.type + (x.auto ? ' auto' : '') + '">' + x.type + '</span>' : '<span class="dash">—</span>'; })() + '</td>' +
      '<td><b>' + nf(d.cal) + '</b></td>' +
      (d.inProgress
        ? '<td><span class="dash">so far</span></td>'
        : '<td' + (d.deficit != null && d.deficit < 0 ? ' class="warn"' : '') + '>' + signed(d.deficit) + '</td>') +
      '<td' + (d.proteinWarn ? ' class="warn"' : '') + '>' + nf(d.protein) + '</td>' +
      '<td' + (d.fatState === 'over' ? ' class="warn"' : d.fatState === 'caution' ? ' class="caution"' : '') + '>' + nf(d.fat) + '</td>' +
      '<td class="opt">' + nf(d.steps) + '</td></tr>';
  }).join('');
  return '<div class="tw"><table><thead><tr>' +
    '<th>Date</th><th class="opt">Type</th><th>kcal</th><th>Deficit</th><th>Protein g</th><th>Fat g</th><th class="opt">Steps</th>' +
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
        '<span><i class="key"></i>intake</span><span><i class="key t"></i>target: ' + targetRule(M.targets) + '</span><span><i class="key g"></i>gap in log</span>' +
        (days.some(function (d) { return d.flagged; }) ? '<span><i class="key fd"></i>protein short or fat over</span>' : '') +
        (pendingT ? '<span><i class="key p"></i>today, so far</span>' : '')) +
      lineChart(w, {
        fmtY: function (v) { return nf(Math.round(v / 100) * 100); },
        points: days.map(function (d, i) {
          return { x01: i / Math.max(1, days.length - 1), y: d.cal, tgt: d.countable ? calorieTarget(d, M.targets) : null,
            flag: d.flagged, pending: d.inProgress, date: d.date,
            label: fmtDay(d.date, { weekday: undefined, day: 'numeric', month: undefined }),
            labelFull: fmtDay(d.date, { weekday: undefined, day: 'numeric', month: 'short' }),
            mkey: d.date.slice(0, 7), tip: dayTip(d) };
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
          return { x01: i / Math.max(1, days.length - 1), y: r.n >= 2 ? Math.round(r.avg) : null, date: d.date,
            label: fmtDay(d.date, { weekday: undefined, day: 'numeric', month: undefined }),
            labelFull: fmtDay(d.date, { weekday: undefined, day: 'numeric', month: 'short' }), mkey: d.date.slice(0, 7),
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
    return '<tr><td><span class="d-long">' + esc(fmtDay(s.date, { weekday: undefined, day: 'numeric', month: 'short', year: 'numeric' })) + '</span>' +
        '<span class="d-short">' + esc(fmtDay(s.date, { weekday: undefined, day: 'numeric', month: 'short' })) + '</span></td>' +
      '<td>' + nf(s.weight, 1) + '</td>' +
      '<td>' + nf(s.bf, 1) + '</td>' +
      '<td>' + nf(s.fatMass, 1) + '</td>' +
      '<td>' + nf(s.muscle, 1) + '</td>' +
      '<td class="opt">' + nf(s.bmr) + '</td>' +
      '<td class="opt">' + (dw == null ? '<span class="dash">—</span>' : signed(dw, 1)) + '</td></tr>';
  }).join('');
  return '<div class="sec"><div class="sec-head"><h2>Scan history</h2><span class="lbl">Baselines tab</span></div>' +
    '<div class="tw"><table><thead><tr><th>Date</th><th>Weight kg</th><th>Fat %</th><th>Fat kg</th>' +
    '<th>Muscle kg</th><th class="opt">BMR</th><th class="opt">Δ weight</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
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
    if (filter.type !== 'All' && dayTypeName(d) !== filter.type) return false;
    return true;
  });
  var loggedN = rows.filter(function (d) { return d.hasIntake; }).length;
  var gapN = rows.filter(function (d) { return !d.logged; }).length;
  $('#histCount').textContent = loggedN + ' logged · ' + gapN + ' gap' + (gapN === 1 ? '' : 's');
  $('#histBody').innerHTML = rows.length
    ? dayTable(rows)
    : '<div class="void-note"><b>Nothing matches</b>No days match this filter yet.</div>';
}

/* --- day detail --------------------------------------------------------- */
var lastFocus = null, closeTimer = null;
function openDay(date) {
  var d = getDay(date), s = $('#daySheet');
  // A close started just before this open would otherwise hide the new sheet.
  clearTimeout(closeTimer);
  tipOff();
  lastFocus = document.activeElement;
  var h = '<div class="sheet-top"><div><h2 id="dayTitle">' + esc(fmtDay(date, { weekday: 'long', day: 'numeric', month: 'long' })) + '</h2>' +
    '<span class="lbl">' + esc(relDay(date)) + (dayTypeName(d) ? ' · ' + dayTypeName(d) + (dayType(d).auto ? ' (worked out)' : '') : '') + '</span></div>' +
    '<button type="button" data-act="closeDay" aria-label="Close">✕</button></div>';

  if (!d.logged) {
    h += '<div class="void-note"><b>No data logged</b>Nothing was written for this date. It is a gap in the record, not a zero-calorie day.</div>';
  } else {
    var target = calorieTarget(d, M.targets);
    h += '<div class="rows"><h3>Energy' + (d.inProgress ? ' · so far' : '') + '</h3>' +
      row('Calories', d.cal, 'kcal') +
      (d.inProgress
        ? row('Calorie target', target == null ? null : '~' + nf(target) + ' kcal, estimated', '') +
          row('Burned (TDEE)', 'day still open', '') + row('Deficit', 'day still open', '')
        : row('Calorie target', target, 'kcal') +
          row('Burned (TDEE)', d.tdee, 'kcal') +
          // signed, like everywhere else: a bare "232" reads as a quantity,
          // not as a day that came out ahead
          row('Deficit', d.deficit == null ? null : signed(d.deficit) + ' kcal', '',
              d.deficit != null && d.deficit < 0)) +
      row('BMR', d.bmr, 'kcal') +
      '<h3>Macros</h3>' +
      row('Protein', d.protein, 'g', d.proteinWarn) +
      row('Fat', d.fat, 'g', d.fatState === 'over', d.fatState === 'caution') +
      row('Carbs', d.carbs, 'g') +
      '<h3>Activity</h3>' +
      row('Steps', d.steps, '') +
      row('Active calories', d.active, 'kcal') +
      row('Exercise calories', d.exercise, 'kcal') +
      row('Activity level', (function () { var a = activityLevel(d); return a && a.level; })(), '') +
      // say it plainly when the burn came from steps rather than from the
      // calorie figures, so the number can always be traced
      (d.stepFloor && d.steps ? '<div class="row"><span>Activity counted from</span>' +
        '<b>' + nf(d.steps) + ' steps &rarr; ' + nf(Math.round(d.fromSteps)) + ' kcal</b></div>' : '') +
      row('Gym', gymLabel(d), '') +
      '</div>';
    if (d.fatState === 'over') {
      h += '<div class="note warn"><span class="lbl">Fat over the limit</span>' + nf(d.fatOverBy) + ' g over the ' + nf(M.targets.fat_ceiling_g) + ' g limit' +
        (d.drivers.length ? ' — driven by: ' + esc(d.drivers.join(', ')) : '') + '.</div>';
    } else if (d.fatState === 'caution') {
      h += '<div class="note caution"><span class="lbl">Fat above the limit</span>' + nf(d.fatOverBy) + ' g over, ' +
        'still under ' + nf(M.targets.fat_red_g) + ' g' +
        (d.drivers.length ? ' — from: ' + esc(d.drivers.join(', ')) : '') + '.</div>';
    }
    if (d.proteinWarn) {
      h += '<div class="note warn"><span class="lbl">Protein short of target</span>' +
        nf(M.targets.protein_floor_g - d.protein) + ' g short of the ' + nf(M.targets.protein_floor_g) + ' g target.</div>';
    } else if (d.proteinLow) {
      h += '<div class="note"><span class="lbl">Protein so far</span>' +
        nf(M.targets.protein_floor_g - d.protein) + ' g to go to the ' + nf(M.targets.protein_floor_g) + ' g target.</div>';
    }
    if (d.notes) h += '<div class="note"><span class="lbl">Note</span>' + noteHtml(d.notes) + '</div>';
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
  clearTimeout(closeTimer);
  closeTimer = setTimeout(function () { s.hidden = true; }, 300);
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
  $('#view-' + current).innerHTML = '<div class="skl h1"></div><div class="grid g2">' +
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
    '<p class="why">Saved in this browser only, and it takes priority over the default in <code>assets/config.js</code>.</p>' +
    (savedSheet() && DEFAULT_SHEET
      ? '<p class="why">This browser is using a saved sheet. <button type="button" data-act="resetSheet" style="text-decoration:underline">Go back to the default sheet</button></p>'
      : '') + '</div>';
  current = 'today'; markNav();
  VIEWS.forEach(function (v) { $('#view-' + v.id).classList.toggle('on', v.id === 'today'); });
  var i = $('#sid'); if (i) i.focus();
}

function showError(e) {
  // A background refresh that fails (the phone briefly offline) keeps what is
  // on screen. Replacing it with a setup error, and jumping to Today, would
  // punish a glance at Trends for a dropped connection.
  if (lastLoad) {
    setSync('err', 'Couldn\'t refresh · data from ' + lastLoadTime + ' SGT', true);
    return;
  }
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

var loading = false, lastLoad = 0, lastLoadTime = '';

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
    go(current, true);

    lastLoad = Date.now();
    lastLoadTime = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
    setSync('', 'Updated ' + lastLoadTime + ' SGT', true);
    // days with food logged; a row the phone sync made holds only activity
    var fed = M.dates.filter(function (x) { return M.days[x].hasIntake; }).length;
    $('#railStamp').textContent = fed + ' day' + (fed === 1 ? '' : 's') + ' logged';
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
    case 'theme': return cycleTheme();
    case 'reconfigure': return showSetup('Currently reading: ' + (sheetId() || 'nothing') + '.');
    case 'resetSheet':
      try { localStorage.removeItem(LS_KEY); } catch (err) {}
      lastLoad = 0;      // a different sheet: its failure must show, not hide behind old data
      return load();
    case 'saveSheet': {
      var raw = ($('#sid').value || '').trim();
      var m = raw.match(/\/d\/([a-zA-Z0-9-_]+)/);
      var id = m ? m[1] : raw;
      if (!id) return;
      try { localStorage.setItem(LS_KEY, id); } catch (err) {}
      lastLoad = 0;
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

// Once a minute while the tab is visible: re-read the Sheet if the date has
// rolled over at midnight or the refresh interval has passed (the phone pushes
// activity hourly), and re-check the Night theme schedule.
setInterval(function () {
  applyTheme();
  if (document.hidden || loading || !sheetId() || !lastLoad) return;
  var every = (CFG.autoRefreshMinutes || 0) * 60000;
  if (todayYMD() !== M.today || (every && Date.now() - lastLoad > every)) load();
}, 60000);

/* --- boot --------------------------------------------------------------- */
applyTheme();
buildNav();
var startView = location.hash.slice(1) || 'today';
if (!VIEWS.some(function (v) { return v.id === startView; })) startView = 'today';
// Show the requested view straight away, so a link to #trends does not show
// Today's loading placeholder under a nav that says Trends.
current = null;
go(startView, true);
load();

})();
