import { expect, test, type Page } from '@playwright/test';
import { TEST_PASSWORD, expectNotice, newUser, openTab, realErrors, signIn, signUp, joinWithApproval } from './helpers';

/*
 * The whole life of a class with three people, run in order:
 * Maya creates it, Stu joins with the invite link, Kim joins with a new code.
 * Every ledger record type is added and the fund numbers are checked against the Ledger math.
 */

type User = Awaited<ReturnType<typeof newUser>>;
let maya: User;
let stu: User;
let kim: User;
let classUrl = '';
let firstCode = '';

const shots = (name: string) => `test-results/screenshots/${name}.png`;

// Direct access to the Firestore emulator, past the security rules, to set up a broken state on purpose.
const EMULATOR_DOCS = 'http://127.0.0.1:8080/v1/projects/demo-classhub/databases/(default)/documents';
const OWNER = { Authorization: 'Bearer owner' };

async function uidOf(displayName: string): Promise<string> {
  const users: { documents: { name: string; fields?: { displayName?: { stringValue?: string } } }[] } = await (await fetch(`${EMULATOR_DOCS}/users?pageSize=100`, { headers: OWNER })).json();
  const user = users.documents.find((d) => d.fields?.displayName?.stringValue === displayName);
  if (!user) throw new Error(`No profile for ${displayName}`);
  return user.name.split('/').pop()!;
}

function tomorrowKey(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function newRecord(page: Page, kind: RegExp) {
  await openTab(page, 'Ledger');
  await page.locator('.fab').click();
  await page.getByRole('dialog', { name: 'New record' }).getByRole('button', { name: kind }).click();
}

async function pickMember(page: Page, field: RegExp, name: string) {
  await page.getByRole('button', { name: field }).click();
  await page.getByRole('dialog', { name: 'Choose a member' }).getByRole('button', { name: new RegExp(name) }).click();
}

test.describe.serial('a class from start to finish', () => {
  test.beforeAll(async ({ browser }) => {
    maya = await newUser(browser, 'Maya', 'Reyes');
    stu = await newUser(browser, 'Stu', 'Dent');
    kim = await newUser(browser, 'Kim', 'Lee', { phone: true, dark: true });
  });

  test.afterAll(async () => {
    for (const u of [maya, stu, kim]) await u?.context.close();
  });

  test('the Mayor creates a class and its courses', async () => {
    const { page } = maya;
    await signUp(page, maya.first, maya.last, maya.email);
    await expect(page.getByRole('heading', { name: `Hi, ${maya.name}!` })).toBeVisible();
    await page.locator('.fab').click();
    await page.getByRole('button', { name: /Create a class/ }).click();
    await page.getByLabel('Class name').fill('Test Class');
    await page.getByRole('button', { name: 'Create class' }).click();
    await expect(page.getByText('You are Mayor')).toBeVisible();
    classUrl = new URL(page.url()).pathname;
    firstCode = (await page.locator('.invite-code').textContent())!.trim();
    expect(firstCode).toMatch(/^[A-Z0-9]{6}$/);

    await page.getByRole('button', { name: 'Courses (0)' }).click();
    for (const course of ['Operations Research', 'Software Engineering']) {
      await page.getByLabel('New course').fill(course);
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await expectNotice(page, `Added ${course}.`);
    }
    await expect(page.getByText('1 of 1 take this')).toHaveCount(2);
    // A name already listed is refused.
    await page.getByLabel('New course').fill('operations research');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expectNotice(page, 'Use a course name of up to 40 characters that is not already listed.');
  });

  test('a student joins with the invite link before signing in', async () => {
    const { page } = stu;
    await signUp(page, stu.first, stu.last, stu.email, `/join/${firstCode}`);
    await expect(page.getByText('You are invited to')).toBeVisible();
    await joinWithApproval(page, maya.page, 'Test Class', classUrl, 'Stu Dent');
    await expect(page.getByText('You are Member')).toBeVisible();
    await expect(page.getByText('2 members')).toBeVisible();
    // Members cannot add records, so there is no + button and the form says so.
    await openTab(page, 'Ledger');
    await expect(page.locator('.fab')).toHaveCount(0);
    await page.goto(`${classUrl}/charge`);
    await expect(page.getByText('Your role does not allow you to charge students.')).toBeVisible();
    await page.goto(classUrl);
  });

  test('the Mayor marks a course the student does not take', async () => {
    const { page } = maya;
    await page.goto(classUrl);
    await openTab(page, 'Members');
    await page.getByRole('button', { name: /Stu Dent|Dent, Stu/ }).click();
    await page.getByRole('switch', { name: /Operations Research/ }).uncheck();
    await expect(page.getByText('Skipped when charging this course')).toBeVisible();
    await page.getByRole('button', { name: 'Save courses' }).click();
    await expectNotice(page, "Stu Dent's courses were saved.");
    await page.goBack();
    await expect(page.getByText('Does not take 1 course')).toBeVisible();
  });

  test('every kind of ledger record, with the fund numbers', async () => {
    const { page } = maya;

    await newRecord(page, /^Payment/);
    await page.getByRole('textbox', { name: 'Amount', exact: true }).fill('100');
    await pickMember(page, /^Who paid/, 'Stu Dent');
    await page.getByLabel('Note (optional)').fill('October dues');
    await page.getByRole('button', { name: 'Save payment' }).click();
    await expectNotice(page, 'Payment of ₱100.00 from Stu Dent saved.');

    await newRecord(page, /^Charge students/);
    await page.getByLabel('Amount per student').fill('20');
    await page.getByLabel('Description').fill('Quiz fee');
    await page.getByRole('button', { name: 'Charge 2 students', exact: true }).click();
    await expectNotice(page, 'Charged 2 students ₱20.00 each (₱40.00 in total).');

    // By course: the student who does not take it starts unticked. Paid out right away.
    await newRecord(page, /^Charge students/);
    await page.getByLabel('Amount per student').fill('10');
    await page.getByLabel('Description').fill('OR handout');
    await page.getByRole('button', { name: /^Course/ }).click();
    await page.getByRole('dialog', { name: 'Charge by course' }).getByRole('button', { name: 'Operations Research' }).click();
    await expect(page.getByText('Does not take Operations Research')).toBeVisible();
    await page.getByRole('switch', { name: /Also record the pay-out now/ }).check();
    await page.getByLabel('Paid to (optional)').fill('Prof. Santos');
    await page.getByRole('button', { name: 'Charge 1 student and pay out' }).click();
    await expectNotice(page, 'Charged 1 student ₱10.00 each (₱10.00 in total) and recorded the pay-out.');

    // A withdrawal is not limited by the balance (a larger one is tested in the domain tests).
    await newRecord(page, /^Withdrawal/);
    await pickMember(page, /^Who is withdrawing/, 'Stu Dent');
    await expect(page.getByText('Current balance ₱80.00')).toBeVisible();
    await page.getByRole('textbox', { name: 'Amount', exact: true }).fill('30');
    await page.getByRole('button', { name: 'Save withdrawal' }).click();
    await expectNotice(page, 'Withdrawal of ₱30.00 by Stu Dent saved.');

    await newRecord(page, /^Pay out from fund/);
    await page.getByRole('button', { name: /^Charge being paid out/ }).click();
    await page.getByRole('dialog', { name: 'Waiting to be paid out' }).getByRole('button', { name: /Quiz fee/ }).click();
    await page.getByRole('button', { name: 'Pay out ₱40.00' }).click();
    await expectNotice(page, 'Paid out ₱40.00 for "Quiz fee".');

    // Cash 100 - 30 - 10 - 40 = 20. Stu 100 - 20 - 30 = 50, Maya -20 - 10 = -30. Nothing waiting.
    await openTab(page, 'Ledger');
    const fund = page.locator('.hero').first();
    await expect(fund.locator('.money-big')).toHaveText('₱20.00');
    await expect(fund).toContainText('Net collected₱70.00');
    await expect(fund).toContainText('Charged to members₱50.00');
    await expect(fund).toContainText('Waiting to be paid out₱0.00');
    await expect(fund).toContainText('Available cash₱20.00');
    await expect(fund).toContainText('✓ Books balanced');
    await expect(page.getByText('You owe ₱30.00')).toBeVisible();
    await expect(page.getByText('Paid out', { exact: true })).toHaveCount(2);
    await page.screenshot({ path: shots('desktop-ledger-officer'), fullPage: true });

    // Voiding a pay-out puts its charge back on the waiting list.
    await page.locator('.list-row', { hasText: 'Paid out from fund to Prof. Santos' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Void record' }).click();
    const confirm = page.getByRole('dialog', { name: 'Void this record?' });
    // A reason is required.
    await expect(confirm.getByRole('button', { name: 'Void record' })).toBeDisabled();
    await confirm.getByLabel('Reason for voiding').fill('Paid to the wrong person');
    await confirm.getByRole('button', { name: 'Void record' }).click();
    await expectNotice(page, 'Pay-out voided. Its charge is waiting to be paid out again.');
    // The voided pay-out stays in the list, marked.
    await expect(page.locator('.list-row', { hasText: 'Voided' })).toHaveCount(1);
    await expect(fund).toContainText('Waiting to be paid out₱10.00');
    await page.locator('.list-row', { hasText: 'OR handout' }).filter({ hasText: 'Charge ·' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Record pay-out' }).click();
    await page.getByLabel('Paid to (optional)').fill('Prof. Santos');
    await page.getByRole('button', { name: 'Pay out ₱10.00' }).click();
    await expectNotice(page, 'Paid out ₱10.00 for "OR handout".');
    await expect(fund).toContainText('✓ Books balanced');
  });

  test('the student sees their own balance', async () => {
    const { page } = stu;
    await openTab(page, 'Ledger');
    const card = page.locator('.hero').first();
    await expect(card).toContainText('Your balance');
    await expect(card.locator('.money-big')).toHaveText('₱50.00');
    await expect(card).toContainText('You paid in₱100.00');
    await expect(card).toContainText('Charged to you₱20.00');
    await expect(card).toContainText('You withdrew ₱30.00 in total.');
    await page.getByRole('tab', { name: 'Mine' }).click();
    await expect(page.locator('.list-row')).toHaveCount(3);
  });

  test('schedule: added by the Mayor, marked done by the student, counted for the class', async () => {
    await openTab(maya.page, 'Schedule');
    await maya.page.locator('.fab').click();
    await maya.page.getByRole('radio', { name: 'Quiz' }).click();
    await maya.page.getByLabel('Title').fill('Quiz 1');
    await maya.page.getByLabel('Due date').fill(tomorrowKey());
    await maya.page.getByRole('button', { name: 'Add to schedule' }).click();
    await expectNotice(maya.page, 'Added "Quiz 1".');
    await expect(maya.page.locator('.list-row', { hasText: 'Quiz 1' })).toContainText('Tomorrow');

    await openTab(stu.page, 'Home');
    await expect(stu.page.getByText('Coming up')).toBeVisible();
    await stu.page.getByRole('button', { name: 'Mark "Quiz 1" as done' }).click();
    await expectNotice(stu.page, 'Marked "Quiz 1" as done.');

    await maya.page.locator('.list-row.clickable', { hasText: 'Quiz 1' }).click();
    const details = maya.page.getByRole('dialog', { name: 'Quiz 1' });
    await expect(details).toContainText('Marked done by 1 of 2');
    await details.getByRole('button', { name: 'See who' }).click();
    await expect(details).toContainText('• Stu Dent');
    await details.getByRole('button', { name: 'Cancel for the whole class' }).click();
    await expectNotice(maya.page, '"Quiz 1" is cancelled for the class.');
    await maya.page.getByRole('tab', { name: 'All' }).click();
    await expect(maya.page.locator('.list-row', { hasText: 'Quiz 1' })).toContainText('Cancelled');
  });

  test('contents: add, open, edit and delete a link', async () => {
    const { page } = maya;
    await openTab(page, 'Contents');
    await page.locator('.fab').click();
    await page.getByLabel('Title').fill('Syllabus');
    await page.getByLabel('Link').fill('drive.google.com/file/d/abc123/view');
    await expect(page.getByRole('radio', { name: 'File' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: 'Add content' }).click();
    await expectNotice(page, 'Added "Syllabus".');

    await openTab(stu.page, 'Contents');
    const link = stu.page.getByRole('link', { name: /Syllabus/ });
    await expect(link).toHaveAttribute('href', 'https://drive.google.com/file/d/abc123/view');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(link).toContainText('File  ·  Google Drive');
    // The row menu: everyone can copy the link, only officers can edit.
    await stu.page.getByRole('button', { name: 'More for "Syllabus"' }).click();
    await expect(stu.page.getByRole('menuitem', { name: 'Copy link' })).toBeVisible();
    await expect(stu.page.getByRole('menuitem', { name: 'Edit' })).toHaveCount(0);
    await stu.page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'More for "Syllabus"' }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await page.getByLabel('Title').fill('Syllabus v2');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expectNotice(page, 'Saved "Syllabus v2".');
    await page.getByRole('button', { name: 'More for "Syllabus v2"' }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expectNotice(page, 'Deleted "Syllabus v2".');
    await expect(stu.page.getByText('No class contents yet.')).toBeVisible();
  });

  test('a new role takes effect for the student right away', async () => {
    await openTab(maya.page, 'Members');
    await maya.page.getByRole('button', { name: /Stu Dent|Dent, Stu/ }).click();
    await maya.page.getByRole('radio', { name: 'Treasurer' }).check();
    await maya.page.getByRole('button', { name: 'Save role' }).click();
    await expectNotice(maya.page, "Stu Dent's role was updated.");
    await maya.page.goBack();

    await openTab(stu.page, 'Ledger');
    await expect(stu.page.locator('.fab')).toContainText('New record');
    await expect(stu.page.locator('.hero').first()).toContainText('Cash on hand');
  });

  test('a new invite code replaces the old one', async () => {
    const { page } = maya;
    await openTab(page, 'Home');
    await page.getByRole('button', { name: 'New code' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Make new code' }).click();
    await expectNotice(page, /New invite code: [A-Z0-9]{6}\. The old code no longer works\./);
    const newCode = (await page.locator('.invite-code').textContent())!.trim();
    expect(newCode).not.toBe(firstCode);

    // Kim is on a phone, in dark mode, and types the new code.
    const k = kim.page;
    await signUp(k, kim.first, kim.last, kim.email, `/join/${firstCode}`);
    await expect(k.getByText('That code does not match any class.')).toBeVisible();
    await k.getByLabel('Invite code').fill(newCode.toLowerCase());
    await joinWithApproval(k, page, 'Test Class', classUrl, 'Kim Lee');
    await expect(k.getByText('3 members')).toBeVisible();
    await k.screenshot({ path: shots('phone-dark-home'), fullPage: true });
  });

  test('a removed student can rejoin with the invite code', async () => {
    // Kim is on another page, so the class stays in Kim's own list after the removal.
    const k = kim.page;
    await k.goto('/account');
    const { page } = maya;
    await openTab(page, 'Members');
    await page.getByRole('button', { name: /Kim Lee|Lee, Kim/ }).click();
    await page.getByRole('button', { name: 'Remove from class' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
    await expectNotice(page, 'Kim Lee was removed from the class.');
    await openTab(page, 'Home');
    await expect(page.getByText('2 members')).toBeVisible();

    const code = (await page.locator('.invite-code').textContent())!.trim();
    await k.goto(`/join/${code}`);
    await joinWithApproval(k, page, 'Test Class', classUrl, 'Kim Lee');
    await expect(k.getByText('3 members')).toBeVisible();
    await expect(page.getByText('3 members')).toBeVisible();
  });

  test('the class is in the student\'s list without a saved copy', async () => {
    // My classes is a live query on the member entries, so there is no list entry that can go missing.
    const k = kim.page;
    await k.goto('/');
    await k.locator('.grid-2').getByRole('link', { name: /Test Class/ }).click();
    await expect(k.getByText('3 members')).toBeVisible();
  });

  test('class settings: rename and turn a module off', async () => {
    const { page } = maya;
    await openTab(page, 'Home');
    await page.getByRole('button', { name: 'Class settings' }).click();
    await page.getByLabel('Class name').fill('Test Class Renamed');
    await page.getByRole('radio', { name: '#DB2777' }).first().click();
    await page.getByRole('switch', { name: /^Contents/ }).uncheck();
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expectNotice(page, 'Class settings saved.');
    await page.goBack();
    await expect(page.locator('.topbar .title')).toHaveText('Test Class Renamed');
    await expect(stu.page.locator('.topbar .title')).toHaveText('Test Class Renamed');
    await expect(stu.page.getByRole('navigation', { name: 'Class sections' }).filter({ visible: true }).getByRole('button', { name: 'Contents' })).toHaveCount(0);
  });

  test('a new name shows in every class', async () => {
    const { page } = stu;
    await page.goto('/account');
    await page.getByLabel('First name').fill('Stuart');
    await expect(page.getByText('Shown as: Stuart Dent')).toBeVisible();
    await page.getByRole('button', { name: 'Save name' }).click();
    await expectNotice(page, 'Name saved. It now shows in all your classes.');
    await openTab(maya.page, 'Members');
    await expect(maya.page.getByRole('button', { name: /Stuart Dent|Dent, Stuart/ })).toBeVisible();
  });

  test('the student leaves, with a reminder of their balance', async () => {
    const { page } = stu;
    await page.goto(classUrl);
    await page.getByRole('button', { name: 'My settings for this class' }).click();
    await page.getByRole('button', { name: 'Leave class' }).click();
    const dialog = page.getByRole('dialog', { name: 'Leave Test Class Renamed?' });
    await expect(dialog).toContainText('You have ₱50.00 left in the class fund.');
    await dialog.getByRole('button', { name: 'Leave' }).click();
    await expectNotice(page, 'You left Test Class Renamed.');
    await expect(page.getByRole('heading', { name: 'Hi, Stuart Dent!' })).toBeVisible();
    await expect(maya.page.getByText('2 members')).toBeVisible();
  });

  test('the Mayor hands the class over and leaves', async () => {
    const { page } = maya;
    await page.getByRole('button', { name: 'My settings for this class' }).click();
    await page.getByRole('button', { name: 'Leave class' }).click();
    await page.getByRole('radio', { name: 'Kim Lee' }).check();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Make Mayor and leave' }).click();
    await expectNotice(page, 'You left Test Class Renamed.');
    await expect(kim.page.getByText('You are Mayor')).toBeVisible();
    await expect(kim.page.getByText('1 member', { exact: false })).toBeVisible();
  });

  test('the student deletes their account', async () => {
    const { page } = stu;
    await page.goto('/account');
    await page.getByRole('button', { name: 'Delete account' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete your account?' });
    await dialog.getByLabel('Your password').fill('not-the-password');
    await dialog.getByRole('button', { name: 'Delete account' }).click();
    await expect(dialog).toContainText('That password is incorrect.');
    await dialog.getByLabel('Your password').fill(TEST_PASSWORD);
    await dialog.getByRole('button', { name: 'Delete account' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('the new Mayor changes their password and signs back in', async () => {
    const { page } = kim;
    const newPassword = `${TEST_PASSWORD}-new`;
    await page.goto('/account');
    await page.getByRole('button', { name: 'Change password' }).click();
    await page.getByLabel('New password').fill(newPassword);
    await page.getByLabel('Type it again').fill(newPassword);
    await page.getByRole('button', { name: 'Save new password' }).click();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Sign out' }).click();
    await signIn(page, kim.email, newPassword);
    await expect(page.getByRole('link', { name: /Test Class Renamed/ }).filter({ visible: true })).toBeVisible();
  });

  test('no errors in any browser console', async () => {
    expect(realErrors(maya.errors, maya.failedRequests), maya.failedRequests.join(', ')).toEqual([]);
    // The one 400 is the wrong password typed on purpose before deleting the account.
    const stuErrors = realErrors(stu.errors, stu.failedRequests);
    const wrongPassword = stuErrors.findIndex((e) => e.includes('status of 400'));
    if (wrongPassword >= 0) stuErrors.splice(wrongPassword, 1);
    expect(stuErrors, stu.failedRequests.join(', ')).toEqual([]);
    expect(realErrors(kim.errors, kim.failedRequests), kim.failedRequests.join(', ')).toEqual([]);
  });
});
