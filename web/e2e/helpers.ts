import { expect, type Browser, type Page } from '@playwright/test';

/** A fresh password for this run's throwaway accounts in the local Auth emulator. */
export const TEST_PASSWORD = `e2e-${Math.random().toString(36).slice(2, 12)}`;

let counter = 0;

/** A new browser profile with its own sign-in, and the console errors it logs. */
export async function newUser(browser: Browser, first: string, last: string, options: { phone?: boolean; dark?: boolean; welcome?: boolean } = {}) {
  const context = await browser.newContext({
    viewport: options.phone ? { width: 390, height: 844 } : { width: 1360, height: 900 },
    colorScheme: options.dark ? 'dark' : 'light',
  });
  // The first-visit welcome would cover every screen; only the test that checks it asks for it.
  if (!options.welcome) await context.addInitScript(() => localStorage.setItem('classhub.welcomeSeen', '1'));
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  // The console only says "Failed to load resource"; this keeps which address it was, for the report.
  const failedRequests: string[] = [];
  page.on('response', (r) => {
    if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.request().method()} ${r.url().split('?')[0]}`);
  });
  counter++;
  const email = `${first.toLowerCase()}.${Date.now()}.${counter}@example.test`;
  return { context, page, errors, failedRequests, email, name: `${first} ${last}`, first, last };
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

/**
 * The student asks to join from the join screen they are on, an officer approves the request in the
 * Members tab, and the student opens the class.
 */
export async function joinWithApproval(student: Page, officer: Page, className: string, classUrl: string, studentName: string) {
  await student.getByRole('button', { name: `Ask to join ${className}` }).click();
  await expect(student.getByText('Waiting for approval')).toBeVisible();
  await officer.goto(classUrl);
  await openTab(officer, 'Members');
  await officer.getByRole('button', { name: 'Approve' }).click();
  await expectNotice(officer, `${studentName} is now in the class.`);
  await student.goto(classUrl);
}

/** The snackbar shows this message. */
export async function expectNotice(page: Page, text: string | RegExp) {
  await expect(page.getByRole('status').filter({ hasText: text })).toBeVisible();
}

/** Opens a class tab, from the top tabs on wide screens or the bottom bar on phones. */
export async function openTab(page: Page, name: 'Home' | 'Ledger' | 'Schedule' | 'Contents' | 'News' | 'Members') {
  const nav = page.getByRole('navigation', { name: 'Class sections' }).filter({ visible: true });
  await nav.getByRole('button', { name }).click();
}

/**
 * Console errors that matter. The emulator warning and React Router future flags are expected, and so is
 * a 400 on Firestore's own streaming channel, which the library closes and reopens by itself. The console
 * does not name the address, so one 400 is skipped for each such channel response.
 */
export function realErrors(errors: string[], failedRequests: string[] = []) {
  let channel400s = failedRequests.filter((r) => /^400 \w+ \S*\/google\.firestore\.v1\.Firestore\/(Listen|Write)\/channel$/.test(r)).length;
  return errors.filter((e) => {
    if (/emulator|React Router Future Flag|Download the React DevTools/i.test(e)) return false;
    if (channel400s > 0 && e.includes('status of 400')) {
      channel400s--;
      return false;
    }
    return true;
  });
}
