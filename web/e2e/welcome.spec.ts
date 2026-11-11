import { expect, test } from '@playwright/test';
import { newUser, realErrors, signUp } from './helpers';

// A new Mayor sees the welcome tour once, then the Getting started list, which ticks itself from the class.
test('the welcome shows once and the Getting started list follows the class', async ({ browser }) => {
  const mayor = await newUser(browser, 'Wena', 'Cruz', { welcome: true });
  const { page } = mayor;
  await signUp(page, mayor.first, mayor.last, mayor.email);
  await page.getByRole('button', { name: 'Add a class' }).first().click();
  await page.getByRole('button', { name: /Create a class/ }).click();
  await page.getByLabel('Class name').fill('Welcome Class');
  await page.getByRole('button', { name: 'Create class' }).click();

  // The start card cannot be skipped; the tour then runs in a practice class with sample data.
  const start = page.getByRole('dialog', { name: 'Getting to know ClassHub' });
  await expect(start.getByText('Welcome to Welcome Class')).toBeVisible();
  await expect(page.getByRole('button', { name: /Skip/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(start).toBeVisible();
  await start.getByRole('button', { name: 'Start the tour' }).click();
  const lit = (name: string) => page.locator(`[data-tour="${name}"]`);
  await expect(page.getByText('Step 1 of 6')).toBeVisible();
  await lit('p-tab-LEDGER').click();
  await lit('p-paid').click();
  await lit('p-tab-SCHEDULE').click();
  await expect(page.getByText('Waiting for the treasurer')).toHaveCount(0);
  await lit('p-done').click();
  await lit('p-tab-NEWS').click();
  await lit('p-vote').click();
  const end = page.getByRole('dialog', { name: 'You are ready' });
  await expect(end.getByText('Getting started list')).toBeVisible();
  // The notifications offer only shows where the browser can show notifications.
  await end.getByRole('button', { name: /^(Not now|Open my class)$/ }).click();
  const welcome = page.getByRole('dialog');
  await expect(welcome).toBeHidden();
  // Nothing from the practice class reached the real one.
  await expect(page.getByText('Practice class')).toHaveCount(0);

  const list = page.getByRole('region', { name: 'Getting started' });
  await expect(list.getByText('0 of 5 done')).toBeVisible();
  await list.getByRole('button', { name: 'Add your courses' }).click();
  await page.getByLabel('New course').fill('Algebra');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Added Algebra.')).toBeVisible();
  await page.getByRole('button', { name: /Back/ }).first().click();
  await expect(list.getByText('1 of 5 done')).toBeVisible();

  await page.reload();
  await expect(list.getByText('1 of 5 done')).toBeVisible();
  await expect(welcome).toBeHidden();
  await list.getByRole('button', { name: 'Hide' }).click();
  await expect(list).toBeHidden();
  expect(realErrors(mayor.errors, mayor.failedRequests)).toEqual([]);
});
