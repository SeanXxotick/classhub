import { expect, test } from '@playwright/test';
import { newUser, realErrors, signUp } from './helpers';

// A new Mayor sees the welcome once, then the Getting started list, which ticks itself from the class.
test('the welcome shows once and the Getting started list follows the class', async ({ browser }) => {
  const mayor = await newUser(browser, 'Wena', 'Cruz', { welcome: true });
  const { page } = mayor;
  await signUp(page, mayor.first, mayor.last, mayor.email);
  await page.getByRole('button', { name: 'Add a class' }).first().click();
  await page.getByRole('button', { name: /Create a class/ }).click();
  await page.getByLabel('Class name').fill('Welcome Class');
  await page.getByRole('button', { name: 'Create class' }).click();

  const welcome = page.getByRole('dialog', { name: 'Getting to know ClassHub' });
  await expect(welcome.getByText('Welcome to Welcome Class')).toBeVisible();
  await welcome.getByRole('button', { name: 'Next' }).click();
  await expect(welcome.getByText('Set up your class')).toBeVisible();
  // The notifications card only shows where the browser can show notifications.
  await welcome.getByRole('button', { name: /^(Next|Done)$/ }).click();
  const notNow = welcome.getByRole('button', { name: 'Not now' });
  if (await notNow.isVisible().catch(() => false)) await notNow.click();
  await expect(welcome).toBeHidden();

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
