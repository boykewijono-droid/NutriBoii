/* Tests for the parts of app.js that decide what gets REPORTED: which foods
 * are named as fat drivers, and whether a day counts as a gym day.
 *
 *   node assets/app.test.js
 *
 * No dependencies. The functions are lifted out of app.js by their section
 * markers and run in isolation, so this tests the shipped code, not a copy.
 */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8').replace(/\r\n/g, '\n');

function slice(from, to) {
  const a = src.indexOf(from), b = src.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('marker not found: ' + (a < 0 ? from : to));
  return src.slice(a, b);
}
const fatDrivers = new Function(slice('var FAT_FOODS', 'function buildDays(') + '\nreturn fatDrivers;')();
const gym = new Function(slice('function gymState', '/** Rolling average deficit') +
  '\nreturn { gymState: gymState, gymLabel: gymLabel };')();

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok ? '' : '\n        want ' + JSON.stringify(want) + '\n        got  ' + JSON.stringify(got)));
}

console.log('\n=== fat drivers: false positives that used to happen ===');
eq('"boiled" is not oil',                fatDrivers('3 boiled eggs, chicken breast, rice'), []);
eq('"doughnuts" is doughnuts, not nuts', fatDrivers('two doughnuts at the office'), ['doughnuts']);
eq('"foil" is not oil; coconuts not nuts', fatDrivers('foil-baked fish, coconuts'), ['coconuts']);
eq('peanut butter is one item',           fatDrivers('peanut butter toast'), ['peanut butter']);
eq('ice cream is not also cream',         fatDrivers('ice cream after dinner'), ['ice cream']);

console.log('\n=== fat drivers: negation ===');
eq('oil-free, skinless, no butter',       fatDrivers('oil-free dressing, skinless chicken, no butter'), []);
eq('fat-free is not a "fat ... from" list', fatDrivers('fat-free yogurt from the shop'), []);
eq('skin-off thigh is not chicken skin',  fatDrivers('grilled chicken skin-off thigh'), []);

console.log('\n=== fat drivers: local food that used to be missed ===');
eq('char kway teow + pork belly',         fatDrivers('char kway teow and pork belly'), ['char kway teow', 'pork belly']);
eq('nasi lemak, in the order written',    fatDrivers('nasi lemak with sambal and fried chicken, teh tarik'), ['nasi lemak', 'sambal', 'fried chicken']);
eq('roti prata + curry',                  fatDrivers('roti prata x2 with curry, kopi'), ['roti prata', 'curry']);
eq('"fried carrot cake" is one item',     fatDrivers('hawker night — fried carrot cake, satay'), ['fried carrot cake', 'satay']);
eq('laksa and cake',                      fatDrivers('birthday dinner, laksa and cake'), ['laksa', 'cake']);

console.log('\n=== fat drivers: the note names them itself ===');
eq('your real note from 12 Sept',
   fatDrivers('fat near ceiling from chicken skin-off thigh, fried egg, sambal oil, ikan bilis'),
   ['chicken skin-off thigh', 'fried egg', 'sambal oil', 'ikan bilis']);
eq('"fat over from a + b + c"',           fatDrivers('fat over from chocolate + cashews + olive oil'), ['chocolate', 'cashews', 'olive oil']);
eq('quantities stripped, not discarded',  fatDrivers('fat over from 2 tbsp olive oil + 30g cashews'), ['olive oil', 'cashews']);
eq('"driven by:"',                        fatDrivers('Over by 12g. driven by: cheese, bacon'), ['cheese', 'bacon']);
eq('nothing fatty, nothing reported',     fatDrivers('clean day, hit protein early'), []);
eq('empty note',                          fatDrivers(''), []);

console.log('\n=== gym ===');
const day = (g, t) => ({ gym: g, dayType: t || null });
eq('Yes counts',                   gym.gymState(day('Yes')), 'yes');
eq('No does NOT count',            gym.gymState(day('No')), 'no');
eq('None does not count',          gym.gymState(day('None')), 'no');
eq('a split name counts',          gym.gymState(day('Day 2')), 'yes');
eq('blank is unknown, not "Rest"', gym.gymState(day(null)), null);
eq('blank but DayType Gym counts', gym.gymState(day(null, 'Gym')), 'yes');
eq('explicit No beats DayType',    gym.gymState(day('No', 'Gym')), 'no');
eq('label: Yes',                   gym.gymLabel(day('yes')), 'Yes');
eq('label: No',                    gym.gymLabel(day('No')), 'No');
eq('label: split name kept',       gym.gymLabel(day('Day 2')), 'Day 2');
eq('label: unknown is null',       gym.gymLabel(day(null)), null);


/* ---- the cache stamp ------------------------------------------------
 * GitHub Pages serves assets with Cache-Control: max-age=600, so a phone
 * can keep running yesterday's app.js long after a deploy — which is
 * exactly what happened the day EATEN was added to the hero. The fix is a
 * content hash in the URL, and this test is what stops anyone forgetting
 * to update it: change app.js, styles.css or config.js and it fails,
 * printing the stamp to use.
 */
console.log('\n=== the cache stamp matches the assets it names ===');
{
  const crypto = require('crypto');
  const root = path.join(__dirname, '..');
  const files = ['assets/styles.css', 'assets/config.js', 'assets/app.js'];
  const h = crypto.createHash('sha256');
  files.forEach(f => h.update(fs.readFileSync(path.join(root, f))));
  const want = h.digest('hex').slice(0, 8);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  files.forEach(f => {
    const m = html.match(new RegExp(f.replace('.', '\\.').replace('/', '\\/') + '\\?v=([0-9a-f]+)'));
    eq(f + ' is stamped with the current contents', m && m[1], want);
  });
}

console.log('\n' + '='.repeat(46));
console.log('  ' + pass + ' passed, ' + fail + ' failed');
console.log('='.repeat(46));
process.exit(fail ? 1 : 0);
