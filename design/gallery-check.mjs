// Checks and screenshots of the component gallery (web/gallery.html).
// Run from the repository root:  node design/gallery-check.mjs
// Starts Vite from web/node_modules on port 5199 (nothing else is touched), opens /gallery.html with the
// Playwright already installed in web/node_modules (Chromium must already be downloaded), and saves PNGs
// to web/test-results/gallery-shots/ (git-ignored).
// Exits with code 1 on: a console error or page error; horizontal scrolling at 390px; a tap target under
// 44px on the phone (same exemptions as design/shots.mjs); a Dialog that does not trap focus, close on Escape
// and the background, or give focus back to its opener; a busy Button that still fires its click; a Switch,
// RadioGroup or Swatches that cannot be used from the keyboard.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.join(here, '..', 'web');
const require = createRequire(path.join(webDir, 'package.json'));
const { chromium } = require('playwright');
const { createServer } = await import(pathToFileURL(path.join(webDir, 'node_modules', 'vite', 'dist', 'node', 'index.js')).href);

const PORT = 5199;
const outDir = path.join(webDir, 'test-results', 'gallery-shots');
mkdirSync(outDir, { recursive: true });

const failures = [];
const fail = (msg) => { failures.push(msg); console.error('FAIL ' + msg); };
const expect = (cond, msg) => { if (!cond) fail(msg); };

const server = await createServer({
  root: webDir,
  logLevel: 'error',
  clearScreen: false,
  server: { port: PORT, strictPort: true, host: '127.0.0.1', hmr: false },
});
await server.listen();
const url = `http://127.0.0.1:${PORT}/gallery.html`;

const browser = await chromium.launch();
const sizes = { phone: { width: 390, height: 844 }, wide: { width: 1280, height: 900 } };
const files = [];

// Sticky and fixed bars would float in the middle of a tall screenshot; show them in flow instead.
const FLOW_CSS = '.ch-bottom-nav,.ch-topbar{position:static!important}.ch-fab-wrap{position:relative!important;bottom:76px!important}.ch-snackbar{position:static!important}';

try {
  for (const mode of ['phone', 'wide']) {
    const ctx = await browser.newContext({ viewport: sizes[mode], deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    let current = mode;
    page.on('console', (m) => { if (m.type() === 'error') fail(`console error (${current}): ${m.text()}`); });
    page.on('pageerror', (e) => fail(`page error (${current}): ${e.message}`));
    page.on('requestfailed', (r) => fail(`request failed (${current}): ${r.url()}`));
    page.on('response', (r) => { if (r.status() >= 400) fail(`HTTP ${r.status()} (${current}): ${r.url()}`); });
    await page.goto(url);
    await page.getByRole('heading', { name: 'Components', level: 1 }).waitFor();
    await page.evaluate(() => document.fonts.ready);

    for (const theme of ['light', 'dark']) {
      current = `${mode} ${theme}`;
      await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      await page.waitForTimeout(50);

      if (mode === 'phone') {
        const res = await page.evaluate(() => {
          const out = { pageScroll: document.documentElement.scrollWidth - window.innerWidth, over: [], small: [] };
          const label = (el) => `${el.tagName.toLowerCase()}.${String(el.className.baseVal ?? el.className).split(' ')[0]} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}"`;
          for (const el of document.body.querySelectorAll('*')) {
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) continue;
            if (el.closest('.ch-chips,[hidden],.ch-sr-only')) continue;
            if (r.right > window.innerWidth + 1 || r.left < -1) out.over.push(label(el));
          }
          const sel = 'button, a[href], select, textarea, input:not([type=hidden]):not([type=checkbox]):not([type=radio]), [role=link]';
          for (const el of document.body.querySelectorAll(sel)) {
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height || el.closest('[hidden]')) continue;
            if (el.matches('.ch-chip')) continue; // carries an enlarged hit area
            if (r.height < 43.5 || r.width < 43.5) out.small.push(`${label(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
          }
          return out;
        });
        if (res.pageScroll > 0) fail(`horizontal page scroll (${res.pageScroll}px) at 390px, ${theme}`);
        if (res.over.length) fail(`content outside the phone width, ${theme}: ${res.over.slice(0, 4).join(' | ')}`);
        if (res.small.length) fail(`tap target under 44px, ${theme}: ${res.small.slice(0, 4).join(' | ')}`);
      }

      const style = await page.addStyleTag({ content: FLOW_CSS });
      const name = `gallery__${mode}__${theme}.png`;
      await page.screenshot({ path: path.join(outDir, name), fullPage: true });
      files.push(name);
      await style.evaluate((el) => el.remove());

      // The void dialog with a reason typed, as the viewer sees it.
      await page.getByRole('button', { name: 'Void with a reason' }).click();
      await page.getByRole('dialog').getByRole('textbox').fill('Entered twice by mistake');
      const dname = `gallery-dialog__${mode}__${theme}.png`;
      await page.screenshot({ path: path.join(outDir, dname) });
      files.push(dname);
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'detached' });
    }

    // ---------------- Behaviour (light theme) ----------------
    current = `${mode} behaviour`;
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; window.scrollTo(0, 0); });

    // Dialog: focus in, trapped, Escape closes, focus returns, background closes.
    const opener = page.getByRole('button', { name: 'Open dialog' });
    await opener.focus();
    await opener.click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    expect(await dialog.getAttribute('aria-modal') === 'true', 'dialog is not aria-modal');
    expect(!!(await dialog.getAttribute('aria-labelledby')), 'dialog has no aria-labelledby');
    const inside = () => page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'));
    expect(await inside(), 'focus did not move into the dialog on open');
    for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); if (!(await inside())) { fail('Tab left the dialog'); break; } }
    for (let i = 0; i < 6; i++) { await page.keyboard.press('Shift+Tab'); if (!(await inside())) { fail('Shift+Tab left the dialog'); break; } }
    await page.keyboard.press('Escape');
    expect((await page.getByRole('dialog').count()) === 0, 'Escape did not close the dialog');
    expect(await page.evaluate(() => document.activeElement?.textContent === 'Open dialog'), 'focus did not return to the opener after Escape');
    await opener.click();
    await dialog.waitFor();
    await page.mouse.click(4, 4); // the dim background
    expect((await page.getByRole('dialog').count()) === 0, 'a click on the background did not close the dialog');
    expect(await page.evaluate(() => document.activeElement?.textContent === 'Open dialog'), 'focus did not return to the opener after a background click');

    // Confirm button inside a form must not submit the form behind it; reason gate; busy blocks Escape.
    await page.getByRole('button', { name: 'Void with a reason' }).click();
    await dialog.waitFor();
    const confirm = dialog.getByRole('button', { name: 'Void record' });
    expect(await confirm.isDisabled(), 'confirm button must be disabled until a reason is typed');
    await dialog.getByRole('textbox').fill('Entered twice');
    expect(!(await confirm.isDisabled()), 'confirm button should enable once a reason is typed');
    await confirm.click();
    await page.keyboard.press('Escape'); // busy for half a second: must not close
    expect((await page.getByRole('dialog').count()) === 1, 'Escape closed a busy dialog');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    expect((await page.getByTestId('submits').textContent()) === '0', 'a dialog button submitted the form behind it');
    expect(((await page.getByTestId('confirmed').textContent()) ?? '').includes('Entered twice'), 'the confirm did not hand over the reason');

    await page.getByRole('button', { name: 'Delete class' }).first().click();
    await dialog.waitFor();
    const del = dialog.getByRole('button', { name: 'Delete class' });
    expect(await del.isDisabled(), 'delete must be disabled until the name is typed');
    await dialog.getByRole('textbox').fill('BSCS 2');
    expect(await del.isDisabled(), 'delete must stay disabled for a wrong name');
    await dialog.getByRole('textbox').fill('BSCS 2B');
    expect(!(await del.isDisabled()), 'delete should enable once the name matches');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Busy dialog' }).click();
    await dialog.waitFor();
    await page.keyboard.press('Escape');
    await page.mouse.click(4, 4);
    expect((await page.getByRole('dialog').count()) === 1, 'a busy dialog closed on Escape or a background click');
    await dialog.getByRole('button', { name: 'Stop the spinner' }).click();
    await page.keyboard.press('Escape');
    expect((await page.getByRole('dialog').count()) === 0, 'Escape did not close the dialog once it was no longer busy');

    // Busy button: clicks and the keyboard do nothing.
    const busy = page.getByRole('button', { name: 'Saving', exact: true });
    expect((await busy.getAttribute('aria-busy')) === 'true', 'busy button has no aria-busy');
    await busy.click({ force: true });
    await busy.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    expect((await page.getByTestId('busy-clicks').textContent()) === '0', 'a busy button still fires its click');
    await page.getByRole('button', { name: 'Solid', exact: true }).click();
    expect((await page.getByTestId('clicks').textContent()) === '1', 'a normal button did not fire its click');

    // Switch from the keyboard.
    const sw = page.getByRole('switch', { name: 'Switch off' });
    await sw.focus();
    expect(!(await sw.isChecked()), 'switch should start off');
    await page.keyboard.press('Space');
    expect(await sw.isChecked(), 'Space did not turn the switch on');
    await page.keyboard.press('Space');
    expect(!(await sw.isChecked()), 'Space did not turn the switch off again');

    // RadioGroup from the keyboard.
    const officers = page.getByRole('radio', { name: /Officers only/ });
    await officers.focus();
    await page.keyboard.press('ArrowDown');
    expect(await page.getByRole('radio', { name: /Treasurers only/ }).isChecked(), 'ArrowDown did not select the next radio');
    await page.keyboard.press('ArrowUp');
    expect(await officers.isChecked(), 'ArrowUp did not select the previous radio');

    // Swatches from the keyboard (one tab stop, arrows move and select).
    const group = page.getByRole('radiogroup', { name: 'Color', exact: true });
    const swatches = group.getByRole('radio');
    expect((await swatches.evaluateAll((els) => els.filter((e) => e.tabIndex === 0).length)) === 1, 'swatches should have exactly one tab stop');
    await group.getByRole('radio', { checked: true }).focus();
    await page.keyboard.press('ArrowRight');
    expect((await group.getByRole('radio', { checked: true }).getAttribute('aria-label')) === '#CC4A0A', 'ArrowRight did not select the next swatch');

    // Dark theme keeps the accent in a dialog (the dialog is drawn outside the accent wrapper).
    await group.getByRole('radio').nth(1).click();
    await page.getByRole('radiogroup', { name: 'Class accent color' }).getByRole('radio').nth(1).click();
    await page.getByRole('button', { name: 'Open dialog' }).click();
    const accent = await page.evaluate(() => getComputedStyle(document.querySelector('.ch-scrim')).getPropertyValue('--ch-accent').trim().toLowerCase());
    expect(accent === '#585be8', `the dialog lost the class accent (got "${accent}")`);
    await page.keyboard.press('Escape');

    await ctx.close();
  }
} catch (e) {
  fail(`the check script crashed: ${e && e.stack ? e.stack : e}`);
} finally {
  await browser.close();
  await server.close();
}

console.log(`${files.length} screenshots in ${outDir}`);
if (failures.length) {
  console.error(`${failures.length} problem(s)`);
  process.exit(1);
}
console.log('OK: no console errors, no horizontal scroll, no small tap targets, dialogs and controls work from the keyboard.');
