/* Restamp index.html's asset URLs with the current contents of the assets:
 * ?v=<first 8 hex of sha256(styles.css + config.js + app.js)>, the recipe
 * assets/app.test.js checks. Run after any change to those three files:
 *
 *   npm run stamp
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const h = crypto.createHash('sha256');
['assets/styles.css', 'assets/config.js', 'assets/app.js'].forEach(f => h.update(fs.readFileSync(path.join(root, f))));
const v = h.digest('hex').slice(0, 8);

const file = path.join(root, 'index.html');
let n = 0;
const html = fs.readFileSync(file, 'utf8').replace(/(assets\/(?:styles\.css|config\.js|app\.js))\?v=[0-9a-f]+/g,
  (m, asset) => { n++; return asset + '?v=' + v; });
if (n !== 3) { console.error('expected 3 stamped asset URLs in index.html, found ' + n); process.exit(1); }
fs.writeFileSync(file, html);
console.log('index.html stamped ?v=' + v);
