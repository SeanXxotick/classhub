# Long text wrapping pass (Nov 16)

Goal: no text that overflows its box, pushes the page sideways, or gets squeezed into a one-letter column
(like the cancelled class row), when people type long text into any field.

## Method

1. `scripts/long-text-emulator.ts` (scratch, not committed): after `seed-emulator.ts`, rewrite every
   user-typed field in the emulator to its longest allowed value (limits from `firestore.rules`), mixing a
   long unbroken token (URL or name without spaces) with long words.
2. A Playwright crawl (scratch) visits each screen and dialog at 360 px and 1280 px, as Mayor and as a
   student, and flags in the page:
   - the page scrolling sideways (`scrollWidth > innerWidth`)
   - an element whose text overflows (`scrollWidth > clientWidth`, overflow visible, no ellipsis)
   - an element past the right edge of the screen (outside a sideways scroller)
   - squeezed text: narrow (< 48 px) and tall (> 3 lines) with more than 12 characters
3. Fix by pattern, not one by one:
   - user text: `overflow-wrap: anywhere` where it sits in flex rows, `min-width: 0` on the flex child
   - things beside text (badges, amounts, chips): may wrap or move under the text instead of squeezing it
4. Rerun the crawl until it is clean, then unit and end-to-end tests, then build.

## Screens

My classes, Account, Create class, Join; class Home, Ledger (list, record dialogs, record forms, charge,
member picker, statement, claims, reminders), Schedule (timetable, full week, items, attendance),
Contents, News (posts, comments), Members (list, member page, join requests), Roles, Courses, Settings,
History, About, Invite.

## Status

- [x] long-text seed (136 documents filled to their limits)
- [x] crawl and detector (31 screens and dialogs)
- [x] fixes: cancelled reason wraps; list titles stop at 3 lines; amounts and badges on the right give way;
      member pickers (Charge, Choose a member, reminders) show the balance under the name; week grid room
      stops at 2 lines
- [x] rerun clean: 0 issues at 360 px (Mayor, student) and 1280 px (Mayor); unit 136 pass; build passes
- [ ] end-to-end: slow machine (1.8 GB free); 13 of 14 in class and delete-class passed with a 30 s wait,
      rerun all 25 when memory is free
