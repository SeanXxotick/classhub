import { expect, test, type Page } from '@playwright/test';
import { clearNewsCounts, expectNotice, joinWithApproval, newsCountsShown, newUser, openTab, realErrors, signUp, watchNewsCounts } from './helpers';

// The red counts on the News switch (Announcements, Forum, Polls) must never show for a moment and then go
// away: a student who has read and voted on everything opens News again and no count appears at all.

type User = Awaited<ReturnType<typeof newUser>>;

let mayor: User;
let student: User;
let classUrl = '';

const newsSwitch = (page: Page) => page.getByRole('group', { name: 'News' });

async function newPoll(page: Page, question: string, anonymous: boolean) {
  await page.getByRole('button', { name: 'New poll' }).click();
  const dialog = page.getByRole('dialog', { name: 'New poll' });
  await dialog.getByLabel('Question').fill(question);
  await dialog.getByPlaceholder('Choice 1').fill('Yes');
  await dialog.getByPlaceholder('Choice 2').fill('No');
  if (anonymous) await dialog.getByRole('switch', { name: /Anonymous votes/ }).check();
  await dialog.getByRole('button', { name: 'Create poll' }).click();
  await expectNotice(page, 'Poll created.');
}

test.describe.serial('red counts on the News switch', () => {
  test.beforeAll(async ({ browser }) => {
    mayor = await newUser(browser, 'Mara', 'Santos');
    student = await newUser(browser, 'Leo', 'Garcia', { phone: true });
  });

  test.afterAll(async () => {
    for (const u of [mayor, student]) await u?.context.close();
  });

  test('a class with an announcement, a question and polls', async () => {
    const m = mayor.page;
    await signUp(m, mayor.first, mayor.last, mayor.email);
    await m.getByRole('button', { name: 'Add a class' }).first().click();
    await m.getByRole('button', { name: /Create a class/ }).click();
    await m.getByLabel('Class name').fill('News Class');
    await m.getByRole('button', { name: 'Create class' }).click();
    await expect(m.getByText('You are Mayor')).toBeVisible();
    classUrl = new URL(m.url()).pathname;
    const code = (await m.locator('.invite-code').textContent())!.trim();
    await signUp(student.page, student.first, student.last, student.email, `/join/${code}`);
    await joinWithApproval(student.page, m, 'News Class', classUrl, 'Leo Garcia');

    await openTab(m, 'News');
    await m.getByRole('button', { name: 'New announcement' }).click();
    const post = m.getByRole('dialog', { name: 'New announcement' });
    await post.getByLabel('Title').fill('Bring your ID');
    await post.getByRole('button', { name: 'Post' }).click();
    await expectNotice(m, 'Announcement posted.');

    await newsSwitch(m).getByRole('button', { name: /^Forum/ }).click();
    await m.getByRole('button', { name: 'Ask a question' }).click();
    const ask = m.getByRole('dialog', { name: 'Ask a question' });
    await ask.getByLabel('Question').fill('Where is the room?');
    await ask.getByRole('button', { name: 'Ask' }).click();
    await expectNotice(m, 'Question posted.');

    await newsSwitch(m).getByRole('button', { name: /^Polls/ }).click();
    await newPoll(m, 'Open poll?', false);
    await newPoll(m, 'Secret poll?', true);
  });

  test('new things count for the student until they open them', async () => {
    const s = student.page;
    await s.goto(classUrl);
    await openTab(s, 'News');
    await expect(newsSwitch(s).getByRole('button', { name: /Forum\s*1/ })).toBeVisible();
    await expect(newsSwitch(s).getByRole('button', { name: /Polls\s*2/ })).toBeVisible();

    await newsSwitch(s).getByRole('button', { name: /^Forum/ }).click();
    await expect(s.getByText('Where is the room?').first()).toBeVisible();
    await newsSwitch(s).getByRole('button', { name: /^Polls/ }).click();
    for (const question of ['Open poll?', 'Secret poll?']) {
      const choice = s.locator('.ch-card').filter({ hasText: question }).getByRole('button', { name: /Yes/ });
      await choice.click();
      await expect(choice).toHaveAttribute('aria-pressed', 'true');
    }
    await newsSwitch(s).getByRole('button', { name: /^Announcements/ }).click();
    await expect(newsSwitch(s).locator('.news-count')).toHaveCount(0);
  });

  test('opening News again shows no count, not even for a moment', async () => {
    const s = student.page;
    await watchNewsCounts(s);
    for (let i = 0; i < 3; i++) {
      await openTab(s, 'Home');
      await expect(newsSwitch(s)).toHaveCount(0);
      await clearNewsCounts(s);
      await openTab(s, 'News');
      await expect(s.getByText('Bring your ID')).toBeVisible();
      await s.waitForTimeout(700);
      expect(await newsCountsShown(s)).toEqual([]);
    }
  });

  test('neither does opening Polls or the Forum directly', async () => {
    const s = student.page;
    for (const [query, text] of [['polls=1', 'Open poll?'], ['forum=all', 'Where is the room?']]) {
      await s.goto(`${classUrl}?tab=NEWS&${query}`);
      await expect(s.getByText(text).first()).toBeVisible();
      await s.waitForTimeout(700);
      expect(await newsCountsShown(s)).toEqual([]);
    }
  });

  test('opening News does not mark seen announcements again', async () => {
    const s = student.page;
    const classId = classUrl.split('/').pop();
    const savedAt = async () => {
      const seen = `http://127.0.0.1:8080/v1/projects/demo-classhub/databases/(default)/documents/classes/${classId}/seen`;
      const list = (await (await fetch(seen, { headers: { Authorization: 'Bearer owner' } })).json()) as { documents: { updateTime: string }[] };
      return list.documents.map((d) => d.updateTime);
    };
    await openTab(s, 'Home');
    const before = await savedAt();
    await openTab(s, 'News');
    await expect(s.getByText('Bring your ID')).toBeVisible();
    await s.waitForTimeout(1000);
    expect(await savedAt()).toEqual(before);
  });

  test('no console errors', async () => {
    for (const u of [mayor, student]) expect(realErrors(u.errors, u.failedRequests)).toEqual([]);
  });
});
