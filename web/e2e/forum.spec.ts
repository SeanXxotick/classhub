import { expect, test } from '@playwright/test';
import { expectNotice, joinWithApproval, newUser, openTab, realErrors, signUp } from './helpers';

// The Forum (docs/PLAN-FORUM.md): a student asks anonymously with a course tag, the Mayor sees who asked
// and answers, the student replies (still anonymous) and picks the best answer, and the Mayor tops the
// helpers list. Then a tagged announcement.
test('forum: an anonymous question, an answer, a reply, the best answer and a tagged announcement', async ({ browser }) => {
  const mayor = await newUser(browser, 'Rafa', 'Mendoza');
  const stu = await newUser(browser, 'Lea', 'Garcia', { phone: true });
  const m = mayor.page;
  const s = stu.page;

  await signUp(m, mayor.first, mayor.last, mayor.email);
  await m.getByRole('button', { name: 'Add a class' }).first().click();
  await m.getByRole('button', { name: /Create a class/ }).click();
  await m.getByLabel('Class name').fill('Forum Class');
  await m.getByRole('button', { name: 'Create class' }).click();
  await expect(m.getByText('You are Mayor')).toBeVisible();
  const classUrl = new URL(m.url()).pathname;
  const code = (await m.locator('.invite-code').textContent())!.trim();
  await m.getByRole('button', { name: 'Courses (0)' }).click();
  await m.getByLabel('New course').fill('Operations Research');
  await m.getByRole('button', { name: 'Add', exact: true }).click();
  await expectNotice(m, 'Added Operations Research.');

  await signUp(s, stu.first, stu.last, stu.email, `/join/${code}`);
  await joinWithApproval(s, m, 'Forum Class', classUrl, 'Lea Garcia');

  // The student asks anonymously, tagged with the course.
  await openTab(s, 'News');
  await s.getByRole('button', { name: 'Forum' }).click();
  await s.getByRole('button', { name: 'Ask a question' }).click();
  const ask = s.getByRole('dialog', { name: 'Ask a question' });
  await ask.getByLabel('Question').fill('Is the OR long quiz open notes?');
  await ask.getByLabel('Tag').selectOption({ label: 'Operations Research' });
  await expect(ask.getByText('Students taking Operations Research get a notification.')).toBeVisible();
  await ask.getByRole('switch', { name: /Ask anonymously/ }).check();
  await ask.getByRole('button', { name: 'Ask' }).click();
  await expectNotice(s, 'Question posted.');
  // It opens the question; the student sees themselves as the anonymous asker.
  await expect(s.getByText('Anonymous classmate (you)')).toBeVisible();

  // The Mayor sees the question with a red count, and who asked (officers only).
  await m.goto(classUrl);
  await openTab(m, 'News');
  await expect(m.getByRole('button', { name: /Forum\s*1/ })).toBeVisible();
  await m.getByRole('button', { name: /Forum/ }).click();
  await m.getByRole('button', { name: /Is the OR long quiz open notes\?/ }).click();
  await expect(m.getByText('Posted by Lea Garcia. Only officers see this.')).toBeVisible();
  await m.getByLabel('Your answer').fill('Open notes, but no laptops.');
  await m.getByRole('button', { name: 'Post answer' }).click();
  await expectNotice(m, 'Answer posted.');

  // The student replies, still anonymous, and picks the Mayor's answer.
  await expect(s.getByText('Open notes, but no laptops.')).toBeVisible();
  await s.getByRole('button', { name: 'Reply' }).first().click();
  await s.getByLabel('Your reply').fill('Thanks! Is a calculator allowed?');
  await s.getByRole('button', { name: 'Post reply' }).click();
  await expectNotice(s, 'Reply posted.');
  await expect(s.getByText('The asker (you)')).toBeVisible();
  await s.getByRole('button', { name: 'Mark as best answer' }).click();
  await expectNotice(s, 'Marked as the best answer.');
  await expect(s.getByText('✓ Best answer · Picked by the asker')).toBeVisible();

  // The reply under the Mayor's answer counts for the Mayor, and marks the question.
  await m.getByRole('button', { name: 'Announcements' }).click();
  await expect(m.getByRole('button', { name: /Forum\s*1/ })).toBeVisible();
  await m.getByRole('button', { name: /Forum/ }).click();
  await expect(m.locator('.forum-card').getByText('New answers')).toBeVisible();

  // The list says Answered, and the Mayor tops the helpers.
  await s.getByRole('button', { name: 'Forum' }).last().click();
  await expect(s.locator('.forum-card').getByText('Answered')).toBeVisible();
  await expect(s.getByText('Top helpers this month')).toBeVisible();
  await expect(s.locator('.forum-helper').first()).toContainText('Rafa Mendoza');
  await expect(s.locator('.forum-helper').first()).toContainText('1 best answer');

  // A tagged announcement: the Mayor picks the course, the student filters by it.
  await m.getByRole('button', { name: 'Announcements' }).click();
  await m.getByRole('button', { name: 'New announcement' }).click();
  const post = m.getByRole('dialog', { name: 'New announcement' });
  await post.getByLabel('Title').fill('OR quiz moved to Friday');
  await post.getByLabel('Tag').selectOption({ label: 'Operations Research' });
  await post.getByRole('button', { name: 'Post' }).click();
  await expectNotice(m, 'Announcement posted.');
  await s.getByRole('button', { name: /Announcements/ }).click();
  await expect(s.getByText('OR quiz moved to Friday')).toBeVisible();
  await s.getByLabel('Tag').selectOption({ label: 'General' });
  await expect(s.getByText('No announcements with this tag.')).toBeVisible();

  for (const u of [mayor, stu]) expect(realErrors(u.errors, u.failedRequests), u.failedRequests.join(', ')).toEqual([]);
  await mayor.context.close();
  await stu.context.close();
});
