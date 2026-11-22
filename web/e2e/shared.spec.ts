import { expect, test, type Page } from '@playwright/test';
import { expectNotice, joinWithApproval, newUser, openTab, realErrors, signUp } from './helpers';

// Two classes working together: G1 hosts a shared grouping with group leaders and G2 links it with the
// share code; a student from each class joins the same group (the G2 student asks, the G1 leader approves).
// Then G1 posts a poll shared with G2, both students vote, and both classes see the same counts.

type User = Awaited<ReturnType<typeof newUser>>;

let hostMayor: User;
let partnerMayor: User;
let ana: User;
let ben: User;
let hostUrl = '';
let partnerUrl = '';
let shareCode = '';

const SHOTS = process.env.QA_SHOTS ?? '';
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function createClass(user: User, name: string): Promise<{ url: string; code: string }> {
  const { page } = user;
  await signUp(page, user.first, user.last, user.email);
  await page.getByRole('button', { name: 'Add a class' }).first().click();
  await page.getByRole('button', { name: /Create a class/ }).click();
  await page.getByLabel('Class name').fill(name);
  await page.getByRole('button', { name: 'Create class' }).click();
  await expect(page.getByText('You are Mayor')).toBeVisible();
  const url = new URL(page.url()).pathname;
  const code = (await page.locator('.invite-code').textContent())!.trim();
  return { url, code };
}

async function openGroups(page: Page, url: string) {
  await page.goto(`${url}?tab=MEMBERS&view=groups`);
  await expect(page.getByRole('group', { name: 'Members' }).getByRole('button', { name: /^Groups/ })).toHaveAttribute('aria-pressed', 'true');
}

async function openPolls(page: Page, url: string) {
  await page.goto(`${url}?tab=NEWS&polls=1`);
  await expect(page.getByRole('group', { name: 'News' }).getByRole('button', { name: /^Polls/ })).toHaveAttribute('aria-pressed', 'true');
}

/** Expands a grouping card by its title, then the named group inside it. */
async function openSlot(page: Page, title: string, slot: string) {
  const card = page.locator('.ch-card').filter({ has: page.getByRole('button', { name: new RegExp(title) }) }).first();
  const toggle = card.locator('.grp-card-toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  const expand = card.getByRole('button', { name: `Expand ${slot}` });
  if (await expand.isVisible()) await expand.click();
  return card;
}

test.describe.serial('shared groupings and shared polls across two classes', () => {
  test.beforeAll(async ({ browser }) => {
    hostMayor = await newUser(browser, 'Lara', 'Dizon');
    partnerMayor = await newUser(browser, 'Joel', 'Tan');
    ana = await newUser(browser, 'Ana', 'Reyes', { phone: true, dark: true });
    ben = await newUser(browser, 'Ben', 'Cruz', { phone: true });
  });

  test.afterAll(async () => {
    for (const u of [hostMayor, partnerMayor, ana, ben]) await u?.context.close();
  });

  test('two classes, one student in each', async () => {
    const host = await createClass(hostMayor, 'BSM CS 3A-G1');
    hostUrl = host.url;
    const partner = await createClass(partnerMayor, 'BSM CS 3A (G2)');
    partnerUrl = partner.url;
    await signUp(ana.page, ana.first, ana.last, ana.email, `/join/${host.code}`);
    await joinWithApproval(ana.page, hostMayor.page, 'BSM CS 3A-G1', hostUrl, 'Ana Reyes');
    await signUp(ben.page, ben.first, ben.last, ben.email, `/join/${partner.code}`);
    await joinWithApproval(ben.page, partnerMayor.page, 'BSM CS 3A (G2)', partnerUrl, 'Ben Cruz');
  });

  test('G1 creates a shared grouping with leaders and G2 links it with the code', async () => {
    const h = hostMayor.page;
    await openGroups(h, hostUrl);
    await h.getByRole('button', { name: 'New grouping' }).click();
    const dialog = h.getByRole('dialog', { name: 'New grouping' });
    await dialog.getByLabel('Title').fill('Thesis Groups');
    await dialog.getByLabel('Groups', { exact: true }).fill('2');
    await dialog.getByLabel('Max per group (0 = no limit)').fill('3');
    await dialog.getByRole('switch', { name: /Group leaders/ }).check();
    await dialog.getByRole('switch', { name: /Share with another class/ }).check();
    await expect(dialog.getByLabel('Section tag')).toHaveValue('G1');
    await shot(h, '01-host-new-grouping-dialog');
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expectNotice(h, 'Shared grouping created.');
    const card = await openSlot(h, 'Thesis Groups', 'Group 1');
    shareCode = (await card.locator('.grp-code-pill').textContent())!.trim();
    expect(shareCode).toMatch(/^GRP-[A-Z2-9]{8}$/);
    await shot(h, '02-host-grouping-card');

    const p = partnerMayor.page;
    await openGroups(p, partnerUrl);
    await p.getByRole('button', { name: 'Link with code' }).click();
    const link = p.getByRole('dialog', { name: 'Link with code' });
    await link.getByLabel('Share code').fill(shareCode.toLowerCase());
    await expect(link.getByLabel('Section tag')).toHaveValue('G2');
    await link.getByRole('button', { name: 'Link' }).click();
    await expectNotice(p, 'Shared grouping linked.');
    const partnerCard = await openSlot(p, 'Thesis Groups', 'Group 1');
    await expect(partnerCard.getByText('BSM CS 3A-G1 · Host')).toBeVisible();
    await expect(partnerCard.getByText('BSM CS 3A (G2)', { exact: true })).toBeVisible();
    await shot(p, '03-partner-linked-card');
  });

  test('the G1 student leads Group 1 and approves the G2 student', async () => {
    const a = ana.page;
    await openGroups(a, hostUrl);
    const card = await openSlot(a, 'Thesis Groups', 'Group 1');
    await expect(card.getByText('You do not have a group yet.')).toBeVisible();
    await card.getByRole('button', { name: 'Join' }).first().click();
    await expectNotice(a, 'Joined Group 1.');
    await shot(a, '04-ana-joined-phone-dark');

    const b = ben.page;
    await openGroups(b, partnerUrl);
    const bCard = await openSlot(b, 'Thesis Groups', 'Group 1');
    await bCard.getByRole('button', { name: 'Request to join' }).first().click();
    await expectNotice(b, 'Requested to join Group 1.');
    await expect(bCard.getByText(/Waiting for Group 1 to approve your request/)).toBeVisible();
    await shot(b, '05-ben-requested-phone');

    await a.reload();
    const aCard = await openSlot(a, 'Thesis Groups', 'Group 1');
    await expect(aCard.getByText('Join requests (1)')).toBeVisible();
    await aCard.getByRole('button', { name: 'Approve' }).click();
    await expectNotice(a, 'Approved Cruz, Ben.');
    await expect(aCard.getByText('2/3')).toBeVisible();

    await b.reload();
    const bAfter = await openSlot(b, 'Thesis Groups', 'Group 1');
    await expect(bAfter.getByText('Cruz, Ben (you)')).toBeVisible();
    await expect(bAfter.getByText('You do not have a group yet.')).toHaveCount(0);
    await shot(b, '06-ben-in-group-phone');
  });

  test('G1 posts a poll shared with G2 and both classes see the same counts', async () => {
    const h = hostMayor.page;
    await openPolls(h, hostUrl);
    await h.getByRole('button', { name: 'New poll' }).click();
    const dialog = h.getByRole('dialog', { name: 'New poll' });
    await dialog.getByLabel('Question').fill('Defense day?');
    await dialog.getByPlaceholder('Choice 1').fill('Monday');
    await dialog.getByPlaceholder('Choice 2').fill('Friday');
    await dialog.getByRole('switch', { name: /BSM CS 3A \(G2\)/ }).check();
    await shot(h, '07-host-new-shared-poll');
    await dialog.getByRole('button', { name: 'Create poll' }).click();
    await expectNotice(h, 'Shared poll created.');

    for (const [user, url] of [[ana, hostUrl], [ben, partnerUrl]] as const) {
      await openPolls(user.page, url);
      await user.page.getByRole('button', { name: /Friday/ }).click();
      await expect(user.page.getByRole('button', { name: /Friday/ })).toHaveAttribute('aria-pressed', 'true');
    }
    for (const [user, url, name] of [[hostMayor, hostUrl, 'host'], [partnerMayor, partnerUrl, 'partner']] as const) {
      await openPolls(user.page, url);
      await expect(user.page.getByText('2 voted')).toBeVisible();
      await expect(user.page.getByRole('button', { name: /Friday/ })).toContainText('100% (2)');
      await shot(user.page, `08-${name}-poll-counts`);
    }
    await ben.page.getByRole('button', { name: 'Show voters ▾' }).click();
    await expect(ben.page.locator('.poll-name-chip')).toHaveCount(2);
    await shot(ben.page, '09-ben-poll-voters-phone');
  });

  test('after votes, a multiple-choice poll stays one and its limit cannot go down', async () => {
    const h = hostMayor.page;
    await openPolls(h, hostUrl);
    await h.getByRole('button', { name: 'New poll' }).click();
    const dialog = h.getByRole('dialog', { name: 'New poll' });
    await dialog.getByLabel('Question').fill('Snacks for defense?');
    await dialog.getByPlaceholder('Choice 1').fill('Bread');
    await dialog.getByPlaceholder('Choice 2').fill('Juice');
    await dialog.getByRole('button', { name: '+ Add choice' }).click();
    await dialog.getByPlaceholder('Choice 3').fill('Fruit');
    await dialog.getByRole('switch', { name: /Allow multiple choices/ }).check();
    await dialog.getByLabel('Maximum choices per student').selectOption('3');
    await dialog.getByRole('button', { name: 'Create poll' }).click();
    await expectNotice(h, 'Poll created.');

    const a = ana.page;
    await openPolls(a, hostUrl);
    const aCard = a.locator('.ch-card').filter({ hasText: 'Snacks for defense?' });
    for (const choice of ['Bread', 'Juice', 'Fruit']) {
      await aCard.getByRole('button', { name: new RegExp(choice) }).click();
      await expect(aCard.getByRole('button', { name: new RegExp(choice) })).toHaveAttribute('aria-pressed', 'true');
    }

    await h.reload();
    await h.getByRole('button', { name: 'More for "Snacks for defense?"' }).click();
    await h.getByRole('menuitem', { name: 'Edit poll' }).click();
    const edit = h.getByRole('dialog', { name: 'Edit poll' });
    await expect(edit.getByRole('switch', { name: /Allow multiple choices/ })).toBeDisabled();
    await expect(edit.getByLabel('Maximum choices per student').locator('option')).toHaveText(['Up to 3']);
    await shot(h, '10-host-edit-poll-after-votes');
    await edit.getByRole('button', { name: 'Cancel' }).click();
  });

  test('no console errors', async () => {
    for (const u of [hostMayor, partnerMayor, ana, ben]) expect(realErrors(u.errors, u.failedRequests)).toEqual([]);
  });
});
