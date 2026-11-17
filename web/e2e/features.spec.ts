import { expect, test } from '@playwright/test';
import { expectNotice, newUser, openTab, realErrors, signUp } from './helpers';

// The 2.1 to 2.4 features in one pass, as the Mayor of a new class: a payment claim, the statement,
// an announcement and the timetable.
test('claims, statement, announcements and the timetable', async ({ browser }) => {
  const mayor = await newUser(browser, 'Nina', 'Castro');
  const { page } = mayor;
  await signUp(page, mayor.first, mayor.last, mayor.email);
  await page.getByRole('button', { name: 'Add a class' }).first().click();
  await page.getByRole('button', { name: /Create a class/ }).click();
  await page.getByLabel('Class name').fill('Feature Class');
  await page.getByRole('button', { name: 'Create class' }).click();
  await expect(page.getByText('1 member')).toBeVisible();
  const classUrl = new URL(page.url()).pathname;

  // A claim: sent, then confirmed into a payment.
  await openTab(page, 'Ledger');
  await page.getByRole('button', { name: 'I paid' }).click();
  const claim = page.getByRole('dialog', { name: 'I paid' });
  await claim.getByLabel('Amount').fill('150');
  await claim.getByLabel('Reference number (optional)').fill('REF 001');
  await claim.getByRole('button', { name: 'Send claim' }).click();
  await expectNotice(page, 'Claim sent. It is waiting for the treasurer.');
  await expect(page.getByText('Payment claims (1 waiting)')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expectNotice(page, 'Payment of ₱150.00 from Nina Castro confirmed.');
  await expect(page.locator('.hero').first().locator('.money-big')).toHaveText('₱150.00');
  await expect(page.getByText('Confirmed', { exact: true })).toBeVisible();

  // The statement shows the payment with the running balance.
  await page.getByRole('button', { name: 'My statement' }).click();
  const statement = page.getByRole('dialog', { name: 'Statement of Nina Castro' });
  await expect(statement).toContainText('+₱150.00');
  await statement.getByRole('button', { name: 'Close' }).click();

  // An announcement, pinned.
  await openTab(page, 'News');
  await page.getByRole('button', { name: 'New announcement' }).click();
  const post = page.getByRole('dialog', { name: 'New announcement' });
  await post.getByLabel('Title').fill('No uniform on Friday');
  await post.getByLabel('Message').fill('Wear the class shirt.');
  await post.getByLabel('Pin to the top').check();
  await post.getByRole('button', { name: 'Post' }).click();
  await expectNotice(page, 'Announcement posted.');
  await expect(page.getByText('No uniform on Friday')).toBeVisible();
  await expect(page.getByText('Pinned', { exact: true })).toBeVisible();
  await expect(page.getByText('Seen by 1 of 1')).toBeVisible();

  // A course, then a weekly meeting on every day so "Today" always has one, then no classes today.
  await page.goto(`${classUrl}/courses`);
  await page.getByLabel('New course').fill('Operations Research');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expectNotice(page, 'Added Operations Research.');
  await page.goto(`${classUrl}?tab=SCHEDULE`);
  const today = new Date(Date.now() + 8 * 3600_000).getUTCDay();
  await page.getByRole('button', { name: 'Add meeting' }).click();
  const meeting = page.getByRole('dialog', { name: 'Add meeting' });
  await meeting.getByLabel('Day').selectOption(String(today));
  await meeting.getByLabel('Room (optional)').fill('Room 204');
  await meeting.getByRole('button', { name: 'Save' }).click();
  await expectNotice(page, 'Meeting saved.');
  await expect(page.getByText('8:00 AM to 9:00 AM · Room 204')).toBeVisible();

  // Attendance: the Mayor marks themselves absent, and sees it under My attendance.
  await page.getByRole('button', { name: 'Take attendance' }).click();
  const sheet = page.getByRole('dialog', { name: 'Take attendance' });
  await expect(sheet.getByRole('radio', { name: /Operations Research Not taken yet/ })).toBeVisible();
  await sheet.getByRole('radiogroup', { name: 'Attendance of Nina Castro' }).getByRole('radio', { name: 'Absent' }).click();
  await sheet.getByRole('button', { name: 'Save' }).click();
  // Saving asks first, with who is absent.
  const confirmSave = page.getByRole('dialog', { name: 'Save attendance?' });
  await expect(confirmSave.getByText('Castro, Nina')).toBeVisible();
  await confirmSave.getByRole('button', { name: 'Save' }).click();
  await expectNotice(page, 'Attendance saved: 0 present, 0 late, 1 absent, 0 excused.');
  await expect(page.getByText('Out of 1 meeting')).toBeVisible();
  await expect(page.getByText('1 absent').first()).toBeVisible();
  await expect(page.getByText('Attendance taken')).toBeVisible();

  // Opened again, the meeting shows as taken; replacing it lists only the change, and Back keeps it as it was.
  await page.getByRole('button', { name: 'Take attendance' }).click();
  await expect(sheet.getByText(/Taken on .* by Nina Castro./)).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'No changes' })).toBeDisabled();
  await sheet.getByRole('radiogroup', { name: 'Attendance of Nina Castro' }).getByRole('radio', { name: 'Late' }).click();
  await sheet.getByRole('button', { name: 'Update' }).click();
  const confirmReplace = page.getByRole('dialog', { name: 'Replace saved attendance?' });
  await expect(confirmReplace.getByText('1 change')).toBeVisible();
  await expect(confirmReplace.getByText('Castro, Nina')).toBeVisible();
  await confirmReplace.getByRole('button', { name: 'Back' }).click();
  await sheet.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'No classes' }).click();
  const mark = page.getByRole('dialog', { name: 'No classes' });
  // Today is the only day this week with a class; picking it lists that class, unticked, with a warning
  // because its attendance was taken above. Next stays off until a class is ticked.
  await mark.getByRole('button', { name: /: 1 class$/ }).click();
  const orClass = mark.getByRole('checkbox', { name: /Operations Research/ });
  await expect(orClass).toHaveAttribute('aria-checked', 'false');
  await expect(mark.getByRole('button', { name: 'Next' })).toBeDisabled();
  await orClass.click();
  await expect(orClass).toHaveAttribute('aria-checked', 'true');
  await expect(mark.getByText('Attendance was already taken for this class')).toBeVisible();
  await mark.getByRole('button', { name: 'Holiday' }).click();
  await mark.getByRole('button', { name: 'Next' }).click();
  const confirmMark = page.getByRole('dialog', { name: 'Mark 1 class as no classes?' });
  await expect(confirmMark.getByText('1 of these already has attendance. It stays saved and still counts.')).toBeVisible();
  await confirmMark.getByRole('button', { name: 'Mark no classes' }).click();
  await expectNotice(page, 'Marked 1 class as no classes.');
  await expect(page.getByText('1 class · Whole day')).toBeVisible();
  // Remove asks first; Cancel keeps it.
  await page.getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('dialog', { name: 'Classes are back on?' }).getByRole('button', { name: 'Cancel' }).click();

  await openTab(page, 'Home');
  await expect(page.getByText('No classes: Holiday')).toBeVisible();

  expect(realErrors(mayor.errors, mayor.failedRequests), mayor.failedRequests.join(', ')).toEqual([]);
  await mayor.context.close();
});
