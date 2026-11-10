// Screenshots of design/mockup-v2.html for review.
// Run from the repository root:  node design/shots.mjs
// Uses the Playwright already installed in web/node_modules (Chromium must already be downloaded).
// Saves PNGs to web/test-results/design-shots/ (git-ignored).
// Exits with code 1 if the page logs a console error or throws, if any phone-width screen
// scrolls sideways, or if a phone-width screen has a tap target smaller than 44px.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '..', 'web', 'package.json'));
const { chromium } = require('playwright');

const outDir = path.join(here, '..', 'web', 'test-results', 'design-shots');
mkdirSync(outDir, { recursive: true });
const url = pathToFileURL(path.join(here, 'mockup-v2.html')).href;

const only = process.argv.slice(2); // optional screen ids
const failures = [];
const fail = (msg) => { failures.push(msg); console.error('FAIL ' + msg); };

const browser = await chromium.launch();
const sizes = { phone: { width: 390, height: 844 }, wide: { width: 1280, height: 900 } };
const files = [];

for (const mode of ['phone', 'wide']) {
  const ctx = await browser.newContext({ viewport: sizes[mode], deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  let current = '';
  page.on('console', (m) => { if (m.type() === 'error') fail(`console error on ${current}: ${m.text()}`); });
  page.on('pageerror', (e) => fail(`page error on ${current}: ${e.message}`));
  page.on('request', (r) => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) fail(`network request on ${current}: ${r.url()}`); });
  await page.goto(url);
  await page.waitForFunction(() => window.CH);
  const jumps = await page.evaluate(() => window.CH.jumps);
  // Sticky bars would float in the middle of a tall screenshot; show them in flow instead.
  await page.addStyleTag({ content: '.bottom-nav,.topbar{position:static!important}.fab-wrap{position:relative!important;bottom:76px!important}.snackbar{position:static!important}' });

  for (const theme of ['light', 'dark']) {
    for (const j of jumps) {
      if (only.length && !only.includes(j.id)) continue;
      current = `${j.id} ${mode} ${theme}`;
      await page.evaluate(([id, t, m]) => window.CH.show(id, { theme: t, mode: m }), [j.id, theme, mode]);
      await page.waitForTimeout(30);
      const role = j.role ? `-${j.role}` : '-treasurer';
      const name = `${j.id}${role}__${mode}__${theme}.png`;
      await page.locator('#dev').screenshot({ path: path.join(outDir, name) });
      files.push(name);

      if (mode === 'phone') {
        const res = await page.evaluate(() => {
          const dev = document.getElementById('dev');
          const dr = dev.getBoundingClientRect();
          const out = { pageScroll: document.documentElement.scrollWidth - window.innerWidth, over: [], small: [] };
          for (const el of dev.querySelectorAll('*')) {
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) continue;
            if (el.closest('.chips,[hidden],.sr-only')) continue;
            if (r.right > dr.right + 1 || r.left < dr.left - 1) out.over.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${(el.textContent || '').trim().slice(0, 30)}"`);
          }
          const sel = 'button, a[href], select, textarea, input:not([type=hidden]):not([type=checkbox]):not([type=radio]), [role=link]';
          for (const el of dev.querySelectorAll(sel)) {
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height || el.closest('[hidden]')) continue;
            if (el.matches('.chip, .done-check, .back-btn')) continue; // these carry an enlarged hit area
            if (r.height < 43.5 || r.width < 43.5) out.small.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
          }
          return out;
        });
        if (res.pageScroll > 0) fail(`horizontal page scroll (${res.pageScroll}px) on ${current}`);
        if (res.over.length) fail(`content outside the phone frame on ${current}: ${res.over.slice(0, 4).join(' | ')}`);
        if (res.small.length) fail(`tap target under 44px on ${current}: ${res.small.slice(0, 4).join(' | ')}`);
      }
    }
  }

  // Click-through smoke test of the main flows (desktop and phone).
  current = `smoke ${mode}`;
  await page.evaluate((m) => window.CH.show('home', { theme: 'light', mode: m }), mode);
  for (const label of ['Ledger', 'Schedule', 'Contents', mode === 'phone' ? 'News' : 'Announcements', 'Members', 'Home']) {
    await page.locator(mode === 'phone' ? '.bottom-nav button' : '.tabs .tab', { hasText: label }).first().click();
  }
  await page.locator(mode === 'phone' ? '.bottom-nav button' : '.tabs .tab', { hasText: 'Ledger' }).first().click();
  await page.locator('.list-row.rec').first().click();
  await page.getByRole('button', { name: 'Void this record' }).click();
  const dialog = page.getByRole('dialog');
  if (!(await dialog.isVisible())) fail('void dialog did not open');
  if (!(await dialog.getByRole('button', { name: 'Void record' }).isDisabled())) fail('void button must be disabled until a reason is typed');
  await dialog.locator('textarea').fill('Entered twice');
  if (await dialog.getByRole('button', { name: 'Void record' }).isDisabled()) fail('void button should enable once a reason is typed');
  await page.keyboard.press('Escape');
  if (await page.getByRole('dialog').count()) fail('Escape did not close the dialog');
  await ctx.close();
}

// Extra shots: plain member with balances hidden, both widths and themes (ledger and members).
{
  for (const mode of ['phone', 'wide']) {
    const ctx = await browser.newContext({ viewport: sizes[mode], reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(url);
    await page.waitForFunction(() => window.CH);
    await page.addStyleTag({ content: '.bottom-nav,.topbar{position:static!important}.fab-wrap{position:relative!important;bottom:76px!important}.snackbar{position:static!important}' });
    for (const theme of ['light', 'dark']) {
      for (const id of ['ledger-limited', 'members-limited']) {
        await page.evaluate(([i, t, m]) => window.CH.show(i, { theme: t, mode: m, role: 'member', vis: 'TREASURERS' }), [id, theme, mode]);
        const name = `member-hidden-${id}__${mode}__${theme}.png`;
        await page.locator('#dev').screenshot({ path: path.join(outDir, name) });
        files.push(name);
      }
    }
    await ctx.close();
  }
}

await browser.close();
console.log(`${files.length} screenshots in ${outDir}`);
if (failures.length) {
  console.error(`${failures.length} problem(s)`);
  process.exit(1);
}
console.log('OK: no console errors, no horizontal scroll, no small tap targets on phone screens.');
