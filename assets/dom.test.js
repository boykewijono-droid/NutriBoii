/* The dashboard itself, booted in a fake browser on fixed data at a fixed
 * clock, and read back the way he reads it: the Today card, the day sheet,
 * Trends. Every expected number below is worked out by hand in the comments,
 * not copied from the output.
 *
 *   npm install          (once: fetches jsdom)
 *   node assets/dom.test.js
 *
 * The clock is pinned to 14:00 Singapore on 5 Oct 2026, so the forecast and
 * "burned so far" are exact and the suite gives the same answer at any hour.
 *
 * NUTRIBOII_APP=path/to/app.js runs it against another copy of app.js, which
 * is how the suite is checked: a deliberately broken copy must fail it.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const APP = fs.readFileSync(process.env.NUTRIBOII_APP || path.join(__dirname, 'app.js'), 'utf8');
const CONFIG = fs.readFileSync(path.join(__dirname, 'config.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const NOW = Date.UTC(2026, 9, 5, 6, 0);            // 14:00 SGT, 5 Oct 2026
const TODAY = '2026-10-05';

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok ? '' : '\n        want ' + JSON.stringify(want) + '\n        got  ' + JSON.stringify(got)));
}
const T = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);

/* ---- the sheet, as CSV ------------------------------------------------- */
const DAILY_HEAD = 'Date,DayType,Cal_Eaten,Protein_g,Fat_g,Carbs_g,Steps,ActiveCal,ExerciseCal,BMR,TDEE,Deficit,GymDay,Notes,ExerciseMin,WorkoutSteps';
const q = v => (v == null ? '' : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
const dailyRow = o => [o.date, o.type, o.cal, o.p, o.f, o.c, o.steps, o.active, o.ex, o.bmr, '', '', o.gym, o.notes, o.min, o.ws].map(q).join(',');
const daily = rows => [DAILY_HEAD].concat(rows.map(dailyRow)).join('\n');
const BASE_HEAD = 'Date,Weight_kg,BodyFat_pct,BodyFatMass_kg,SkeletalMuscle_kg,BMR,Notes';
const BODY_HEAD = 'Date,Weight_kg,BodyFat_pct,LeanMass_kg,BoneMass_kg,BodyWater_kg,BMI,Source,Measured';
const FIT = 'com.google.android.apps.fitness';
const bodyRow = (date, kg, stamp) => [date, kg, '', '', '', '', '', FIT, date + ' ' + stamp].join(',');

// The InBody scan of 11 Sept, typed in by Chat with muscle and fat mass, and
// the one the InBody app sent on 4 Oct: no fat mass, no muscle.
const BASE = [BASE_HEAD, '2026-09-11,75.9,20.6,15.6,34.3,1672,', '2026-10-04,76.3,18.7,,,1709,from the InBody app'].join('\n');

// Morning weigh-ins price the steps. 2 Oct is an EVENING reading (76.4, the
// day's food on board: close enough to its neighbours that only the
// morning-only rule keeps it out) and 4 Oct is someone else on the scale
// (72.0, 3.5 kg off its neighbours' median of 75.5). Neither may price anything.
//   clean: 1 Oct 76.0, 3 Oct 75.5, 5 Oct 75.2
const BODY = [BODY_HEAD,
  bodyRow('2026-10-01', 76.0, '7:40 AM'),
  bodyRow('2026-10-02', 76.4, '8:10 PM'),
  bodyRow('2026-10-03', 75.5, '07:55'),          // a 24-hour stamp still reads as morning
  bodyRow('2026-10-04', 72.0, '7:05 AM'),
  bodyRow('2026-10-05', 75.2, '7:20 AM')].join('\n');

/* Six finished days. Each one's burn, by hand (perStep = 0.0004 x weight):
 *
 *  29 Sep  3,000 steps at 76.3 kg (no weigh-in yet: newest InBody weight)
 *          1672 + 3000 x 0.03052 = 1672 + 91.56            = 1,764
 *  30 Sep  8,000 steps at 76.3:  1672 + 244.16             = 1,916
 *   1 Oct  10,000 steps at 76.0: 1672 + 304                = 1,976
 *   2 Oct  gym, 450 kcal over 60 min, 800 of 9,000 steps inside, at 76.0
 *          (not 76.4, the evening reading, which would make it 2,303)
 *          workouts 450 - 1672/1440 x 60 = 380.33
 *          steps    8,200 x 0.0304       = 249.28          = 2,302
 *   3 Oct  250 kcal with NO minutes: recorded before minutes were, so the
 *          old rule, the larger of 250 x 0.7 = 175 and 5000 x 0.0302 = 151
 *          1672 + 175                                     = 1,847
 *   4 Oct  a 40-min walk, 200 kcal, no measured inside steps: cadence
 *          60/min = 2,400 inside. At 75.5 (3 Oct), not 72.0 (the outlier)
 *          workouts 200 - 1672/1440 x 40 = 153.56
 *          steps    9,600 x 0.0302       = 289.92          = 2,115
 */
const HISTORY = [
  { date: '2026-09-29', cal: 1750, steps: 3000, bmr: 1672 },
  { date: '2026-09-30', cal: 1900, steps: 8000, bmr: 1672 },
  { date: '2026-10-01', cal: 2100, steps: 10000, bmr: 1672 },
  { date: '2026-10-02', cal: 2200, steps: 9000, ex: 450, min: 60, ws: 800, gym: 'Yes', bmr: 1672 },
  { date: '2026-10-03', cal: 1700, steps: 5000, ex: 250, bmr: 1672 },
  { date: '2026-10-04', cal: 1800, steps: 12000, ex: 200, min: 40, bmr: 1672 }
];
/* Today at 14:00, 4,300 steps at 75.2 kg: 4300 x 0.03008 = 129.34, so the
 * burn so far is 1709 + 129 = 1,838.
 *
 * Forecast: the six days' activity above resting is 92, 244, 304, 630, 175,
 * 443, a mean of 314.67. Ten of the day's 24 hours are left (600/1440):
 *     1709 + 129 + (314.67 - 129) x 600/1440 = 1,915.4  ->  1,920
 * Plan: 85% of 1,920 = 1,632, below the BMR, so held at 1,709.
 * Burned so far: 1709 x 840/1440 + 129.34 = 996.92 + 129.34 = 1,126.
 */
const todayRow = (cal, notes) => ({ date: TODAY, cal, p: 80, f: 30, c: 90, steps: 4300, bmr: 1709, notes });

/* ---- the browser -------------------------------------------------------- */
async function boot(tabs, opt = {}) {
  const vc = new VirtualConsole(), errors = [];
  vc.on('jsdomError', e => errors.push(e.message));
  const dom = new JSDOM(HTML, { runScripts: 'outside-only', url: 'https://example.com/', virtualConsole: vc, pretendToBeVisual: true });
  const w = dom.window;
  const now = opt.now || NOW;
  const RealDate = w.Date;
  w.Date = class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(now); }
    static now() { return now; }
  };
  // reduced motion: bars land at their width and the number does not count up
  w.matchMedia = query => ({ matches: /reduce/.test(query) || (/dark/.test(query) && !!opt.dark),
                             addEventListener() {}, removeEventListener() {} });
  w.scrollTo = () => {};
  Object.defineProperty(w.Element.prototype, 'clientWidth', { get() { return 390; } });
  Object.entries(opt.storage || {}).forEach(([k, v]) => w.localStorage.setItem(k, v));
  w.fetch = url => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(
    /Daily/.test(url) ? tabs.daily : /Baselines/.test(url) ? (tabs.base || BASE_HEAD)
      : /Body/.test(url) ? (tabs.body || BODY_HEAD) : (tabs.targets || 'Key,Value,Unit,Notes')) });
  w.eval(CONFIG);
  w.eval(APP);
  const app = { w, d: w.document, errors, tabs };
  await loaded(app);
  return app;
}
async function loaded(app) {
  for (let i = 0; i < 400; i++) {
    const s = T(app.d.querySelector('#syncText')) || '';
    if (/^Updated|Could not/.test(s)) return;
    await new Promise(r => setTimeout(r, 5));
  }
  throw new Error('the dashboard never finished loading');
}
async function refresh(app) {
  app.d.querySelector('[data-act="refresh"]').click();
  await loaded(app);
}
const click = (app, sel) => app.d.querySelector(sel).click();
function openDay(app, date) {
  app.d.body.insertAdjacentHTML('beforeend', '<button data-day="' + date + '" id="opener"></button>');
  click(app, '#opener');
  app.d.querySelector('#opener').remove();
  const rows = {};
  app.d.querySelectorAll('#daySheet .row').forEach(r => { rows[T(r.querySelector('span'))] = T(r.querySelector('b')); });
  return rows;
}
function hero(app) {
  const h = app.d.querySelector('#view-today .hero');
  const cap = h.querySelector('.hero-cap');
  return {
    num: T(h.querySelector('.hero-num b')),
    tone: h.querySelector('.hero-num').className.replace('hero-num', '').trim(),
    cap: cap && cap.firstChild ? T({ textContent: cap.firstChild.textContent }) : null,
    past: T(h.querySelector('.hero-past')),
    note: T(h.querySelector('.hero-foot .ht-k')),
    top: [...h.querySelectorAll('.hero-top .ht-k')].map(T),
    ticks: [...h.querySelectorAll('.hero-ticks span')].map(s => ({
      name: T(s.querySelector('i')), text: T(s), at: parseFloat(s.style.left),
      row: parseFloat(s.style.top), tf: s.style.transform })),
    marks: h.querySelectorAll('.hero-bar s').length,
    bar: [...h.querySelectorAll('.hero-bar i')].map(i => i.className + ' ' + i.getAttribute('data-w') + '%'),
    macros: [...h.querySelectorAll('.hm-top')].map(m => [...m.children].map(T).join(' ')),
    panel: [...h.querySelectorAll('.hp-row')].map(r => T(r.querySelector('span')) + ' = ' + T(r.querySelector('b'))),
    el: h
  };
}
const badTokens = app => ['today', 'week', 'trends', 'history'].filter(v =>
  /NaN|undefined|\[object|Infinity/.test(app.d.querySelector('#view-' + v).innerHTML));

(async () => {

console.log('\n=== Today, under the plan: what is left in it ===');
{
  const app = await boot({ daily: daily(HISTORY.concat([todayRow(900,
    '- 08:10 Oats and whey (400 kcal)\n- 12:30 Chicken rice (520 kcal)')])), base: BASE, body: BODY });
  const h = hero(app);
  eq('1,709 plan - 900 eaten = 809 left', h.num, '809');
  eq('captioned, and green', [h.cap, h.tone], ['left in plan', 'good']);
  eq('nothing past the plan to report', h.past, null);
  eq('the clock and the steps sit on top', h.top, ['4,300 steps', '14:00']);
  eq('marks: EATEN, PLAN, BURN, in order along the bar',
     h.ticks.map(k => k.text), ['EATEN900', 'PLAN1,709', 'BURN~1,920']);
  eq('one mark on the bar per label', h.marks, 3);
  eq('the plan is the BMR floor, and the note says so', h.note, 'plan held at your BMR, the floor');
  eq('protein and fat against their own limits', h.macros, ['PROTEIN 80/150 g', 'FAT 30/70 g']);
  eq('the "?" panel: every number the card is made of', h.panel, [
    'forecast burn = ~1,920', '85% of burn = 1,632', 'BMR floor = 1,709', 'plan = 1,709 · floored',
    'eaten = 900', 'burned so far = 1,126', 'steps outside workouts = +129',
    'deficit · burn less eaten = +1,020', 'goal · burn less plan = +211']);
  eq('the panel starts closed', h.el.querySelector('.hero-panel').classList.contains('open'), false);

  // the diary's two meals say 920, the total says 900
  const warn = T(app.d.querySelector('#view-today .note-warn'));
  eq('the diary that does not add up is called out',
     warn, 'These 2 meals add up to 920 kcal, but the day\'s total says 900 — 20 kcal less than the diary. One of them is wrong.');

  // activity, today: no workout, so the Workout cell is empty and the day is Low
  const cells = {};
  app.d.querySelectorAll('#view-today .grid.g4 .cell').forEach(c => {
    cells[T(c.querySelector('.lbl'))] = [T(c.querySelector('.big')), T(c.querySelector('.sub'))];
  });
  eq('Workout: nothing logged', cells.Workout, ['—', 'Not logged']);
  eq('Activity: Low, from 4,300 steps', cells.Activity, ['Low', 'So far today · 4,300 steps']);
  eq('no "Active" cell any more', 'Active' in cells, false);

  // yesterday, as one line: deficit 2,115 - 1,800 = +315; its target is
  // 85% of 2,115 = 1,798, so the goal was +317, and +315 just misses it
  const last = app.d.querySelector('.lastday');
  eq('yesterday\'s strip', [T(last.querySelector('.lbl')), T(last.querySelector('b')), T(last.querySelector('.sub'))],
     ['Yesterday · Busy · done', '+315kcal', '1,800 eaten · 2,115 burned · target 1,798 · goal +317']);
  eq('two short of goal is amber, not green', last.querySelector('b').className, 'caution');

  // the 7-day average: deficits 14, 16, -124, 102, 147, 315 = 470 / 6 = +78;
  // goals 92, 244, 296, 345, 175, 317 = 1,469 / 6 = +245
  const roll = app.d.querySelector('#view-today .cell.hl');
  eq('7-day average deficit', T(roll.querySelector('.big')), '+78kcal/day');
  eq('under its goal, so amber', roll.querySelector('.big').className, 'big caution');
  eq('and the goal it is measured against', /^Goal \+245 \(15% of burn\)\. Across 6 finished days/.test(T(roll.querySelector('.sub'))), true);

  eq('no NaN / undefined anywhere', badTokens(app), []);
  eq('no script errors', app.errors, []);

  console.log('\n=== the "?" opens, survives a refresh, and closes ===');
  click(app, '.hero-why');
  let b = app.d.querySelector('.hero-why');
  eq('open: the panel, the button, its glyph',
     [app.d.querySelector('#heroWhy').classList.contains('open'), b.getAttribute('aria-expanded'), T(b)], [true, 'true', '×']);
  await refresh(app);
  b = app.d.querySelector('.hero-why');
  eq('still open after the 10-minute refresh repaints the card',
     [app.d.querySelector('#heroWhy').classList.contains('open'), b.getAttribute('aria-expanded')], [true, 'true']);
  click(app, '.hero-why');
  b = app.d.querySelector('.hero-why');
  eq('closed again', [app.d.querySelector('#heroWhy').classList.contains('open'), T(b), b.getAttribute('aria-label')],
     [false, '?', 'Show how these numbers are worked out']);

  console.log('\n=== Today, past the plan and past the burn ===');
  app.tabs.daily = daily(HISTORY.concat([todayRow(1800)]));
  await refresh(app);
  let x = hero(app);
  // 1,800 eaten: 91 past the 1,709 plan, 120 short of the 1,920 burn
  eq('past the plan: room before even, amber', [x.num, x.cap, x.tone], ['120', 'left before even', 'caution']);
  eq('and how far past the plan', x.past, '91 past plan');
  eq('the panel adds the overshoot', x.panel.includes('past plan = +91'), true);
  // the bar runs to 1,920 x 1.06 = 2,035.2: food to the plan is 1709/2035.2
  // = 84.0%, the 91 past it 4.5%, nothing past the burn
  eq('the bar: plan-coloured, then amber, then no red',
     x.bar, ['s1 84.0%', 's2 4.5%', 's3 0.0%']);

  app.tabs.daily = daily(HISTORY.concat([todayRow(2000)]));
  await refresh(app);
  x = hero(app);
  eq('past the burn: 2,000 - 1,920 = 80 over, red', [x.num, x.cap, x.tone], ['80', 'over burn', 'bad']);
  eq('still saying how far past the plan', x.past, '291 past plan');
  eq('deficit in the panel goes negative', x.panel.includes('deficit · burn less eaten = −80'), true);

  app.tabs.daily = daily(HISTORY.concat([todayRow(null)]));
  await refresh(app);
  x = hero(app);
  eq('nothing eaten: the whole plan, uncoloured', [x.num, x.cap, x.tone], ['1,709', 'planned today', '']);
  eq('no EATEN mark before anything is eaten', x.ticks.map(k => k.name), ['PLAN', 'BURN']);
  eq('and the note says why', x.note, 'nothing logged yet today');

  console.log('\n=== the marks never overlap, whatever has been eaten ===');
  // Sweep the day from 0 to 2,600 kcal. Each label is "NAME" + value in 11px
  // mono, 6.6px a character, on the narrowest card (322px). Read back from the
  // page: where it is pinned, which way it hangs, which line it sits on.
  const W = 322, CH = 6.6;
  let clashes = [], clipped = [], wrong = [], lines = 0;
  for (let cal = 0; cal <= 2600; cal += 25) {
    app.tabs.daily = daily(HISTORY.concat([todayRow(cal)]));
    await refresh(app);
    const k = hero(app);
    const boxes = k.ticks.map(t => {
      const w = t.text.length * CH, at = t.at / 100 * W;
      const l = /\(0\)/.test(t.tf) ? at : /-100%/.test(t.tf) ? at - w : at - w / 2;
      return { name: t.name, l, r: l + w, row: t.row };
    });
    boxes.forEach((a, i) => boxes.slice(i + 1).forEach(b => {
      if (a.row === b.row && a.l < b.r && b.l < a.r) clashes.push(cal + ': ' + a.name + '/' + b.name);
    }));
    boxes.forEach(a => { if (a.l < -0.5 || a.r > W + 0.5) clipped.push(cal + ': ' + a.name); });
    lines = Math.max(lines, new Set(boxes.map(b => b.row)).size);
    // and the headline follows the lines it crosses: plan 1,709, burn 1,920
    const want = cal === 0 ? ['1,709', 'planned today'] : cal <= 1709 ? [(1709 - cal).toLocaleString('en-GB'), 'left in plan']
      : cal <= 1920 ? [(1920 - cal).toLocaleString('en-GB'), 'left before even'] : [(cal - 1920).toLocaleString('en-GB'), 'over burn'];
    if (k.num !== want[0] || k.cap !== want[1] || !k.ticks.some(t => t.text === 'EATEN' + cal.toLocaleString('en-GB'))) wrong.push(cal);
  }
  eq('105 days of eating: no two labels share a line and overlap', clashes, []);
  eq('no label hangs off either end of the card', clipped, []);
  eq('crowded days really did need a second line', lines >= 2, true);
  eq('the headline and the EATEN mark were right at every step', wrong, []);
  eq('no script errors through the sweep', app.errors, []);
  app.w.close();
}

console.log('\n=== Today with a workout: the plan comes off the floor ===');
{
  /* 6,000 steps, 700 of them inside a 50-minute, 510 kcal session, at 75.2 kg:
   *   workouts  510 - 1709/1440 x 50 = 450.66
   *   steps     5,300 x 0.03008      = 159.42     so far 1709 + 610 = 2,319
   * Already above a usual day's 314.67, so the forecast adds nothing: 2,320.
   * Plan 85% of 2,320 = 1,972, above the BMR. Burned so far
   *   1709 x 840/1440 + 610.08 = 1,607.
   */
  const app = await boot({ daily: daily(HISTORY.concat([{ date: TODAY, cal: 1500, p: 120, f: 50, c: 150,
    steps: 6000, ex: 510, min: 50, ws: 700, bmr: 1709 }])), base: BASE, body: BODY });
  const h = hero(app);
  eq('1,972 - 1,500 = 472 left in plan', [h.num, h.cap, h.tone], ['472', 'left in plan', 'good']);
  eq('marks', h.ticks.map(k => k.text), ['EATEN1,500', 'PLAN1,972', 'BURN~2,320']);
  eq('not floored, so the note is the burn so far', h.note, '≈1,607 kcal burned so far');
  eq('the burn, part by part', h.panel.filter(r => /^(plan|workouts|steps outside)/.test(r)),
     ['plan = 1,972', 'workouts, net of resting = +451', 'steps outside workouts = +159']);
  const cells = {};
  app.d.querySelectorAll('#view-today .grid.g4 .cell').forEach(c => {
    cells[T(c.querySelector('.lbl'))] = [T(c.querySelector('.big')), T(c.querySelector('.sub'))];
  });
  eq('Workout: its minutes, and the steps inside it', cells.Workout, ['50min', '700 steps inside']);
  eq('Exercise', cells.Exercise, ['510kcal', 'so far today']);
  eq('Activity: High, on the workout', cells.Activity, ['High', 'So far today · 510 kcal exercise · 6,000 steps']);
  eq('no script errors', app.errors, []);
  app.w.close();
}

console.log('\n=== the day sheet: every burn traced to its parts ===');
{
  const app = await boot({ daily: daily(HISTORY.concat([todayRow(900)])), base: BASE, body: BODY });
  let r = openDay(app, '2026-10-02');
  eq('2 Oct, the gym day', [r.Calories, r['Burned (TDEE)'], r.Deficit, r.BMR],
     ['2,200 kcal', '2,302 kcal', '+102 kcal', '1,672 kcal']);
  eq('its target: 85% of 2,302', r['Calorie target'], '1,957 kcal');
  eq('workout minutes and the steps inside them', [r['Exercise calories'], r['Workout minutes'], r['Steps inside workouts']],
     ['450 kcal', '60 min', '800']);
  eq('built from: the evening reading priced nothing', r['Burned, built from'], 'BMR 1,672 + workouts 380 + steps 249');
  eq('a logged gym day is High', [r['Activity level'], r.Gym], ['High', 'Yes']);

  r = openDay(app, '2026-10-04');
  eq('4 Oct, the walk: the 72 kg outlier priced nothing either', [r['Burned (TDEE)'], r['Burned, built from']],
     ['2,115 kcal', 'BMR 1,672 + workouts 154 + steps 290']);
  eq('no measured inside steps: shown blank, not invented', r['Steps inside workouts'], '—');
  eq('200 kcal of walking is Medium, not High', r['Activity level'], 'Medium');

  r = openDay(app, '2026-10-03');
  eq('3 Oct, before minutes were recorded: the old rule, labelled',
     [r['Burned (TDEE)'], r['Burned, built from']], ['1,847 kcal', 'BMR 1,672 + workout × 0.7 175']);

  r = openDay(app, '2026-10-01');
  eq('10,000 steps and no workout: Medium (a big walking day is not High)', r['Activity level'], 'Medium');
  r = openDay(app, '2026-09-29');
  eq('3,000 steps: Low', [r['Activity level'], r['Burned (TDEE)']], ['Low', '1,764 kcal']);

  r = openDay(app, TODAY);
  eq('today\'s sheet holds the burn back', [r['Burned (TDEE)'], r.Deficit], ['day still open', 'day still open']);
  eq('and names the target as an estimate', r['Calorie target'], '~1,709 kcal, estimated');

  r = openDay(app, '2026-09-20');
  eq('a date with no row is a gap, not a zero', T(app.d.querySelector('#daySheet .void-note b')), 'No data logged');
  eq('no NaN / undefined anywhere', badTokens(app), []);
  eq('no script errors', app.errors, []);
  app.w.close();
}

console.log('\n=== Trends: the InBody app\'s scan, and the scale check with too few weigh-ins ===');
{
  const app = await boot({ daily: daily(HISTORY.concat([todayRow(900)])), base: BASE, body: BODY });
  click(app, '[data-view="trends"]');
  const tr = app.d.querySelector('#view-trends');
  const scans = [...tr.querySelectorAll('tbody tr')].map(r => [...r.querySelectorAll('td')].map(td => T(td.querySelector('.d-long') || td)));
  // fat mass for 4 Oct is derived: 76.3 x 18.7% = 14.27; weight change +0.4
  eq('newest first: the app\'s scan, fat mass worked out, muscle blank',
     scans[0], ['4 Oct 2026', '76.3', '18.7', '14.3', '—', '1,709', '+0.4']);
  eq('Chat\'s 11 Sept scan keeps its muscle and fat mass', scans[1], ['11 Sept 2026', '75.9', '20.6', '15.6', '34.3', '1,672', '—']);
  /* Pace: fat 15.6 -> 14.268 over 23 days is 0.405 kg a week. Lean 62.03 kg
   * at 15% is 72.98 kg, holding 10.95 kg of fat: 3.32 kg to go, ~8 weeks. */
  const pace = [...tr.querySelectorAll('.cell')].find(c => /Pace to/.test(T(c)));
  eq('pace to 15% from the two scans', T(pace.querySelector('.big')), '~8weeks');
  eq('and it says the basis is thin', /Based on 2 scans over 3 weeks — thin/.test(T(pace)), true);
  // 1 Oct, 3 Oct, 5 Oct count; the evening reading and the outlier do not
  const check = [...tr.querySelectorAll('.cell')].find(c => /Your weight says/.test(T(c)));
  eq('scale check: not enough yet, and counts only clean mornings',
     T(check.querySelector('.sub')), 'Needs at least 10 morning weigh-ins and 14 logged days. 3 clean weigh-ins so far.');
  eq('no NaN / undefined anywhere', badTokens(app), []);
  eq('no script errors', app.errors, []);
  app.w.close();
}

console.log('\n=== the scale check, with enough weigh-ins ===');
{
  /* Fifty days to yesterday, 16 Aug to 4 Oct, every morning on a straight line
   * down 0.02 kg a day, eating 2,000 a day with no activity logged, so the
   * formula's burn is the BMR, 1,672.
   *   weight says: 2000 + 0.02 x 7700 = 2,154, with no scatter so no range
   *   gap: 1,672 - 2,154 = -482, outside the range: the formula runs LOW */
  const run = async (days, cal) => {
    const rows = [], body = [BODY_HEAD];
    for (let i = 0; i < days; i++) {
      const date = new Date(Date.UTC(2026, 9, 4 - (days - 1) + i)).toISOString().slice(0, 10);
      rows.push({ date, cal, bmr: 1672 });
      body.push(bodyRow(date, (80 - 0.02 * i).toFixed(2), '7:30 AM'));
    }
    const app = await boot({ daily: daily(rows), base: BASE, body: body.join('\n') });
    click(app, '[data-view="trends"]');
    const c = [...app.d.querySelectorAll('#view-trends .cell')].find(x => /Your weight says/.test(T(x)));
    const out = { big: T(c.querySelector('.big')), cls: c.querySelector('.big').className, sub: T(c.querySelector('.sub')),
                  errors: app.errors, bad: badTokens(app) };
    app.w.close();
    return out;
  };
  let c = await run(50, 2000);
  eq('implied burn, and the range', c.big, '2,154± 0 kcal/day');
  eq('the verdict', c.sub, 'Outside the range: the formula is running LOW. NutriBoii’s burn averaged 1,672 over the same 50 days (−482). From 50 morning weigh-ins, 16 Aug to 4 Oct.');
  eq('outside the range is amber', c.cls, 'big caution');
  eq('clean', [c.errors, c.bad], [[], []]);

  // eating 1,518 instead: 1518 + 154 = 1,672, exactly the formula's burn
  c = await run(50, 1518);
  eq('agreement reads as agreement', /^Inside the range: the formula stands\./.test(c.sub), true);
  eq('and is not coloured', c.cls, 'big');

  // twenty days is too short to judge, whatever the numbers say
  c = await run(20, 2000);
  eq('under six weeks: too early, and says how far along', /^Too early to judge the formula: 20 of 42 days/.test(c.sub), true);
  eq('too early is never amber', c.cls, 'big');
}

console.log('\n=== a sheet still on the old column names ===');
{
  // Before the migration: Calories and TDEE_Target, no ExerciseMin, and an
  // ActiveCal of 615 that must NOT count (Samsung never shares the real one).
  // No weigh-ins and no scans: steps are priced at 75 kg.
  //   1672 + 10,000 x 0.03 = 1,972
  const OLD = 'Date,DayType,Calories,Protein_g,Fat_g,Carbs_g,Steps,ActiveCal,ExerciseCal,BMR,TDEE_Target,Deficit,GymDay,Notes\n' +
              '2026-10-04,,1800,140,55,180,10000,615,,1672,2272,472,,';
  const app = await boot({ daily: OLD });
  const r = openDay(app, '2026-10-04');
  eq('Calories still reads as what was eaten', r.Calories, '1,800 kcal');
  eq('the burn is recomputed, and ActiveCal plays no part', [r['Burned (TDEE)'], r.Deficit], ['1,972 kcal', '+172 kcal']);
  const h = app.d.querySelector('#view-today .hero');
  eq('no row for today: the empty card, same shell', [T(h.querySelector('.hero-num')), T(h.querySelector('.hero-cap'))],
     ['No data logged', 'nothing written for today yet']);
  eq('no script errors', app.errors, []);
  app.w.close();
}

console.log('\n=== no forecast yet: claims nothing ===');
{
  // A first day, no history and no activity: eaten is all there is to say.
  // BMR so far: 1709 x 840/1440 = 997.
  const app = await boot({ daily: daily([{ date: TODAY, cal: 600, bmr: 1709 }]) });
  const h = hero(app);
  eq('the headline is just what was eaten', [h.num, h.cap, h.tone], ['600', 'eaten so far', '']);
  eq('marks: what was eaten, against the BMR', h.ticks.map(k => k.text), ['EATEN600', 'BMR1,709']);
  eq('the note', h.note, 'no forecast yet · nothing claimed');
  eq('the panel', h.panel, ['eaten = 600', 'burned so far = 997', 'BMR floor = 1,709',
     'forecast burn = needs 3 days', 'plan = —']);
  eq('no script errors', app.errors, []);
  app.w.close();
}

console.log('\n=== the diary check stays quiet when it cannot be sure ===');
{
  const quiet = async notes => {
    const app = await boot({ daily: daily(HISTORY.concat([todayRow(900, notes)])), base: BASE, body: BODY });
    const w = app.d.querySelector('#view-today .note-warn');
    app.w.close();
    return w === null;
  };
  eq('within 5 kcal is rounding', await quiet('- Oats (400 kcal)\n- Rice (497 kcal)'), true);
  eq('a meal with no bracket means it cannot add up', await quiet('- Oats (400 kcal)\n- Rice'), true);
  eq('a note that is not a diary', await quiet('felt good today'), true);
}

console.log('\n=== theme: Auto, Light, Dark, and no Night ===');
{
  const app = await boot({ daily: daily([todayRow(900)]) });
  const st = () => [T(app.d.querySelector('#themeText')), app.d.documentElement.getAttribute('data-theme'),
                    app.w.localStorage.getItem('nutriboii.theme')];
  eq('starts on Auto, following a light phone', st(), ['Auto', 'light', null]);
  click(app, '#themeBtn'); eq('then Light', st(), ['Light', 'light', 'light']);
  click(app, '#themeBtn'); eq('then Dark', st(), ['Dark', 'dark', 'dark']);
  click(app, '#themeBtn'); eq('then back to Auto, not Night', st(), ['Auto', 'light', 'system']);
  app.w.close();

  const dark = await boot({ daily: daily([todayRow(900)]) }, { dark: true });
  eq('Auto on a dark phone is dark', dark.d.documentElement.getAttribute('data-theme'), 'dark');
  dark.w.close();

  const old = await boot({ daily: daily([todayRow(900)]) }, { storage: { 'nutriboii.theme': 'night' } });
  eq('someone still on Night is settled on Auto, and it is saved',
     [T(old.d.querySelector('#themeText')), old.w.localStorage.getItem('nutriboii.theme')], ['Auto', 'system']);
  old.w.close();
}

console.log('\n' + '='.repeat(46));
console.log('  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

})().catch(e => { console.log('  CRASH ' + (e && e.stack || e)); process.exit(1); });
