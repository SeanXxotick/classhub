import { expect, test, type Page } from '@playwright/test';
import { expectNotice, newUser, openTab, realErrors, signUp, joinWithApproval } from './helpers';

/*
 * The Mayor deletes a class. It is refused while a student still has money in the fund,
 * and works once everyone is settled. The student then loses the class too.
 */

type User = Awaited<ReturnType<typeof newUser>>;
let dina: User;
let eli: User;
let classUrl = '';

async function newRecord(page: Page, kind: RegExp, amount: string, field: RegExp, save: string) {
  await page.goto(classUrl);
  await openTab(page, 'Ledger');
  await page.locator('.fab').click();
  await page.getByRole('dialog', { name: 'New record' }).getByRole('button', { name: kind }).click();
  await page.getByRole('textbox', { name: 'Amount', exact: true }).fill(amount);
  await page.getByRole('button', { name: field }).click();
  await page.getByRole('dialog', { name: 'Choose a member' }).getByRole('button', { name: /Eli Cruz/ }).click();
  await page.getByRole('button', { name: save }).click();
}

async function openClassSettings(page: Page) {
  await page.goto(classUrl);
  await page.getByRole('button', { name: 'Class settings' }).click();
}

test.describe.serial('deleting a class', () => {
  test.beforeAll(async ({ browser }) => {
    dina = await newUser(browser, 'Dina', 'Ramos');
    eli = await newUser(browser, 'Eli', 'Cruz');
  });

  test.afterAll(async () => {
    for (const u of [dina, eli]) await u?.context.close();
  });

  test('a class with a student who still has money in it', async () => {
    await signUp(dina.page, dina.first, dina.last, dina.email);
    await dina.page.locator('.fab').click();
    await dina.page.getByRole('button', { name: /Create a class/ }).click();
    await dina.page.getByLabel('Class name').fill('Closing Class');
    await dina.page.getByRole('button', { name: 'Create class' }).click();
    await expect(dina.page.getByText('You are Mayor')).toBeVisible();
    classUrl = new URL(dina.page.url()).pathname;
    const code = (await dina.page.locator('.invite-code').textContent())!.trim();

    await signUp(eli.page, eli.first, eli.last, eli.email, `/join/${code}`);
    await joinWithApproval(eli.page, dina.page, 'Closing Class', classUrl, 'Eli Cruz');
    await expect(eli.page.getByText('You are Member')).toBeVisible();
    // Students do not see the delete button: Class settings is for officers.
    await eli.page.goto(`${classUrl}/settings`);
    await expect(eli.page.getByRole('button', { name: 'Delete class' })).toHaveCount(0);

    await newRecord(dina.page, /^Payment/, '50', /^Who paid/, 'Save payment');
    await expectNotice(dina.page, 'Payment of ₱50.00 from Eli Cruz saved.');
  });

  test('the Mayor cannot delete the class until everyone is settled', async () => {
    const { page } = dina;
    await openClassSettings(page);
    await expect(page.getByText('You can delete the class once everyone is settled and the class fund is empty.')).toBeVisible();
    await expect(page.getByText('Eli Cruz has ₱50.00 left')).toBeVisible();
    await expect(page.getByText('A record may be missing')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete class' })).toBeDisabled();
    await page.getByRole('button', { name: 'Delete class' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/screenshots/delete-class-blocked.png' });

    await newRecord(page, /^Withdrawal/, '50', /^Who is withdrawing/, 'Save withdrawal');
    await expectNotice(page, 'Withdrawal of ₱50.00 by Eli Cruz saved.');
    await openClassSettings(page);
    await expect(page.getByText('You can delete the class once everyone is settled')).toHaveCount(0);
  });

  test('the Mayor deletes the class after typing its name', async () => {
    const { page } = dina;
    await page.getByRole('button', { name: 'Delete class' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete Closing Class?' });
    await expect(dialog).toContainText('The class disappears for you and the 1 other member.');
    const confirm = dialog.getByRole('button', { name: 'Delete class' });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel('Type the class name to confirm').fill('Closing');
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel('Type the class name to confirm').fill('Closing Class');
    await page.screenshot({ path: 'test-results/screenshots/delete-class-confirm.png' });
    await confirm.click();
    await expectNotice(page, 'Closing Class was deleted.');
    await expect(page.getByRole('heading', { name: `Hi, ${dina.name}!` })).toBeVisible();
    await expect(page.getByRole('link', { name: /Closing Class/ })).toHaveCount(0);
    expect(realErrors(dina.errors, dina.failedRequests), dina.failedRequests.join(', ')).toEqual([]);
  });

  test('the student loses the class the next time they open it', async () => {
    const { page } = eli;
    await page.goto(classUrl);
    await expect(page.getByRole('heading', { name: `Hi, ${eli.name}!` })).toBeVisible();
    await expect(page.getByRole('link', { name: /Closing Class/ })).toHaveCount(0);
  });
});
