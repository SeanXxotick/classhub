// Renders the app icon (public/icon.svg) to the PNG sizes the web manifest lists, using Playwright's Chromium.
// Run: node scripts/gen-png-icons.mjs
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const svg = readFileSync(new URL('../public/icon.svg', import.meta.url), 'utf8');
// The maskable icon is full-bleed: no rounded corners, and the drawing kept inside the safe zone.
const maskable = svg.replace(' rx="30"', '').replace('<path', '<g transform="translate(10.8 10.8) scale(0.8)"><path').replace('</svg>', '</g></svg>');

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, source, size] of [
  ['icon-192.png', svg, 192],
  ['icon-512.png', svg, 512],
  ['icon-maskable-512.png', maskable, 512],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${source.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.locator('svg').screenshot({ path: fileURLToPath(new URL(`../public/${file}`, import.meta.url)), omitBackground: true });
}
await browser.close();
