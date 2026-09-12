# Setup — from zero to a live dashboard

Four steps, about 15 minutes. Do them in order.

---

## 1. Build the Google Sheet

1. Create a blank Google Sheet. Name it **GymBoii Daily Log**.
2. **Extensions → Apps Script**. Delete the placeholder code.
3. Paste the whole of [`sheet/setup.gs`](sheet/setup.gs).
4. **Run → `setUpGymBoii`**. Approve the permission prompt — it only touches
   this one spreadsheet.
5. It builds three tabs and shows you the spreadsheet ID. Copy that ID.

You now have:

| Tab | Shape | Who writes it |
|---|---|---|
| `Daily Log` | one row per day | Claude, from your chat |
| `Baselines` | one row per InBody scan | Claude, when you log a scan |
| `Targets` | key/value | you or Claude, rarely |

No cell contains a formula. Every value is a plain number, so editing anything
by hand can never break a calculation — the dashboard does all the maths.

> Prefer to build it by hand? Import the three files in [`sheet/`](sheet/) as
> tabs instead. Tab names must match exactly.

---

## 2. Share the Sheet so the dashboard can read it

**Share → General access → Anyone with the link → Viewer.**

This step is required. The dashboard is a static page with no backend and no
server-side secret, so it reads the Sheet anonymously. Without this it cannot
see anything, and you will get the "Cannot read the Sheet" screen.

Anyone who has both the dashboard URL and the sheet ID can read your log. There
are no credentials in the page — only the sheet ID. If that is not acceptable,
see *Keeping it private* at the bottom of the README.

---

## 3. Point the dashboard at the Sheet

Open [`assets/config.js`](assets/config.js) and paste the ID:

```js
sheetId: "1AbC...xYz",
```

That is the only edit needed.

> **Or skip the edit.** Open the dashboard, and if `sheetId` is empty it shows a
> setup screen that accepts the ID (or the full Sheet URL) and remembers it in
> that browser. Handy for testing; set it in `config.js` to make it permanent
> across every device. You can also pass `?sheet=<id>` in the URL.

---

## 4. Publish to GitHub Pages

From this folder:

```bash
git remote add origin https://github.com/<you>/gymboii-dashboard.git
git branch -M main
git push -u origin main
```

Then on GitHub: **Settings → Pages → Source: Deploy from a branch →
Branch: `main`, folder: `/ (root)` → Save.**

Your URL appears within a minute or two:

```
https://<you>.github.io/gymboii-dashboard/
```

Open it on your phone → Share → **Add to Home Screen**. It gets its own icon
and opens without browser chrome.

A private repo works too — GitHub Pages on private repos requires a paid plan;
on the free plan make the repo public. The repo holds no personal data either
way: all your numbers live in the Sheet, and the only thing in the code is the
sheet ID.

---

## Checking it works

| What you should see | What it means |
|---|---|
| Numbers, green dot, "Live · HH:MM SGT" | Working |
| "Connect your Sheet" | `sheetId` is empty — step 3 |
| "not shared publicly yet" | Step 2 was missed |
| "a tab name did not match" | A tab got renamed — check spelling |
| "No data logged" on Today | Working; today's row just isn't written yet |

After Claude writes a row, pull-to-refresh — or just leave the tab and come
back, which re-reads automatically after 60 seconds.

---

## Changing targets

Edit the `Targets` tab in the Sheet, not the code:

| Key | Default | Effect |
|---|---|---|
| `protein_floor_g` | 150 | Below → protein flagged red |
| `protein_goal_g` | 160 | Top of the green band |
| `fat_ceiling_g` | 70 | Above → fat flagged red, note mined for foods |
| `bodyfat_goal_pct` | 15 | The goal the projection counts down to |

`fat_ceiling_g` of 70 is an assumption — the build spec set a protein floor and
a body-fat goal but never named a fat number. 70 g sits below the example days
that were described as "over". Change it in the Sheet once you know the real
figure; nothing in the code needs touching.
