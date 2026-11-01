import { expect, type Browser, type Page } from '@playwright/test';

/** A fresh password for this run's throwaway accounts in the local Auth emulator. */
export const TEST_PASSWORD = `e2e-${Math.random().toString(36).slice(2, 12)}`;

let counter = 0;

/** A new browser profile with its own sign-in, and the console errors it logs. */
export async function newUser(browser: Browser, first: string, last: string, options: { phone?: boolean; dark?: boolean } = {}) {
  const context = await browser.newContext({
    viewport: options.phone ? { width: 390, height: 844 } : { width: 1360, height: 900 },
    colorScheme: options.dark ? 'dark' : 'light',
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  counter++;
  const email = `${first.toLowerCase()}.${Date.now()}.${counter}@example.test`;
  return { context, page, errors, email, name: `${first} ${last}`, first, last };
}

export async function signUp(page: Page, first: string, last: string, email: string, path = '/') {
  await page.goto(path);
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('First name').fill(first);
  await page.getByLabel('Last name').fill(last);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
  await page.locator('form').getByRole('button', { name: 'Create account' }).click();
}

export async function signIn(page: Page, email: string, password = TEST_PASSWORD) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.locator('form').getByRole('button', { name: 'Sign in' }).click();
}

/** The snackbar shows this message. */
export async function expectNotice(page: Page, text: string | RegExp) {
  await expect(page.getByRole('status').filter({ hasText: text })).toBeVisible();
}

/** Opens a class tab, from the top tabs on wide screens or the bottom bar on phones. */
export async function openTab(page: Page, name: 'Home' | 'Ledger' | 'Schedule' | 'Contents' | 'Members') {
  const nav = page.getByRole('navigation', { name: 'Class sections' }).filter({ visible: true });
  await nav.getByRole('button', { name }).click();
}

/** Console errors that matter (the emulator warning and React Router future flags are expected). */
export function realErrors(errors: string[]) {
  return errors.filter((e) => !/emulator|React Router Future Flag|Download the React DevTools/i.test(e));
}
