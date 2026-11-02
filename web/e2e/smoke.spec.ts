import { expect, test } from '@playwright/test';
import { newUser, openTab, realErrors, signUp } from './helpers';

test('sign up, create a class and open every tab', async ({ browser }) => {
  const mayor = await newUser(browser, 'Maya', 'Reyes');
  const { page } = mayor;
  await signUp(page, mayor.first, mayor.last, mayor.email);
  await expect(page.getByRole('heading', { name: `Hi, ${mayor.name}!` })).toBeVisible();

  await page.getByRole('button', { name: 'Add a class' }).first().click();
  await page.getByRole('button', { name: /Create a class/ }).click();
  await page.getByLabel('Class name').fill('BSM CS 3A Test');
  await page.getByLabel('Description (optional)').fill('1st Semester');
  await page.getByRole('button', { name: 'Create class' }).click();

  await expect(page.getByText('1 member')).toBeVisible();
  await expect(page.getByText('You are Mayor')).toBeVisible();
  for (const tab of ['Ledger', 'Schedule', 'Contents', 'Members', 'Home'] as const) {
    await openTab(page, tab);
  }
  await expect(page.getByText('What you can do')).toBeVisible();
  expect(realErrors(mayor.errors, mayor.failedRequests)).toEqual([]);
  await mayor.context.close();
});
