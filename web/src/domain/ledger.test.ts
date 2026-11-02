import { describe, expect, it } from 'vitest';
import { newMember, newRecord, type RecordType } from '../data/models';
import { Ledger } from './ledger';
import { LedgerView, chargeBatch, type ChargeBatch } from './ledgerView';
import { LedgerForms } from './ledgerForms';
import { ChargePlanner } from './chargePlanner';
import { formatMoney, parsePesos } from './money';

const record = (type: RecordType, member: string, pesos: number) => newRecord({ type, amountCentavos: pesos * 100, memberId: member });
const payment = (m: string, p: number) => record('PAYMENT', m, p);
const charge = (m: string, p: number) => record('CHARGE', m, p);
const withdrawal = (m: string, p: number) => record('WITHDRAWAL', m, p);
const expense = (p: number) => record('EXPENSE', '', p);
const ana = newMember({ id: 'ana', name: 'Ana' });
const lito = newMember({ id: 'lito', name: 'Lito' });
const kim = newMember({ id: 'kim', name: 'Kim' });

describe('Ledger', () => {
  it('moves balances and cash by record type', () => {
    expect([Ledger.memberDelta(payment('ana', 100)), Ledger.cashDelta(payment('ana', 100))]).toEqual([10_000, 10_000]);
    expect([Ledger.memberDelta(charge('ana', 6)), Ledger.cashDelta(charge('ana', 6))]).toEqual([-600, 0]);
    expect([Ledger.memberDelta(withdrawal('ana', 50)), Ledger.cashDelta(withdrawal('ana', 50))]).toEqual([-5_000, -5_000]);
    expect([Ledger.memberDelta(expense(380)), Ledger.cashDelta(expense(380))]).toEqual([0, -38_000]);
  });

  it('cash on hand is payments minus withdrawals minus expenses', () => {
    const records = [payment('ana', 100), payment('lito', 50), charge('ana', 6), charge('lito', 6), withdrawal('ana', 20), expense(30)];
    expect(Ledger.cashOnHand(records)).toBe(10_000);
    expect(Ledger.cashOnHand([])).toBe(0);
  });

  it('totals and net collected', () => {
    const records = [payment('ana', 100), payment('lito', 50), charge('ana', 6), expense(30)];
    expect(Ledger.total(records, 'PAYMENT')).toBe(15_000);
    expect(Ledger.total(records, 'CHARGE')).toBe(600);
    expect(Ledger.total(records, 'WITHDRAWAL')).toBe(0);
    expect(Ledger.total(records, 'EXPENSE')).toBe(3_000);
    const r2 = [payment('ana', 100), payment('lito', 50), withdrawal('ana', 40), charge('lito', 6), expense(30)];
    expect(Ledger.netCollected(r2)).toBe(11_000);
    expect(Ledger.netCollected([])).toBe(0);
  });

  it('member balances', () => {
    const records = [payment('ana', 100), charge('ana', 6), charge('ana', 6), withdrawal('ana', 30), payment('lito', 50), charge('lito', 6)];
    const balances = Ledger.memberBalances([ana, lito], records);
    expect(balances.get('ana')).toBe(5_800);
    expect(balances.get('lito')).toBe(4_400);
    expect(Ledger.memberBalances([ana, kim], [payment('ana', 10)]).get('kim')).toBe(0);
    expect(Ledger.memberBalances([ana], [payment('ana', 10), expense(500)]).get('ana')).toBe(1_000);
    expect(Ledger.memberBalances([lito], [payment('lito', 5), charge('lito', 6)]).get('lito')).toBe(-100);
  });

  it('unsettled people and closing the books', () => {
    const settle = (b: string) => newRecord({ type: 'CHARGE', amountCentavos: 2_000, memberId: 'ana', memberName: 'Ana', batchId: b });
    const records = [
      newRecord({ type: 'PAYMENT', amountCentavos: 5_000, memberId: 'ana', memberName: 'Ana' }),
      settle('b1'),
      newRecord({ type: 'CHARGE', amountCentavos: 1_000, memberId: 'gone', memberName: 'Left Early', batchId: 'b1' }),
    ];
    // Ana has 30 pesos left; a student who left still owes 10.
    expect(Ledger.unsettled(records)).toEqual([
      { memberId: 'gone', name: 'Left Early', balanceCentavos: -1_000 },
      { memberId: 'ana', name: 'Ana', balanceCentavos: 3_000 },
    ]);
    expect(Ledger.canCloseBooks(records)).toBe(false);
    expect(Ledger.canCloseBooks([])).toBe(true);
    // Everyone settled, but the charge is not paid out yet, so its money is still in the fund.
    const settled = [payment('ana', 20), charge('ana', 20)];
    expect(Ledger.unsettled(settled)).toEqual([]);
    expect(Ledger.canCloseBooks(settled)).toBe(false);
    expect(Ledger.canCloseBooks([...settled, expense(20)])).toBe(true);
    // A withdrawal of the whole balance also settles.
    expect(Ledger.canCloseBooks([payment('ana', 20), withdrawal('ana', 20)])).toBe(true);
  });

  it('status follows the sign', () => {
    expect([Ledger.status(-1), Ledger.status(1), Ledger.status(0)]).toEqual(['OWES', 'CREDIT', 'SETTLED']);
  });

  it('stays exact with many small payments', () => {
    const records = Array.from({ length: 1_000 }, () => newRecord({ type: 'PAYMENT', amountCentavos: 10 }));
    expect(Ledger.cashOnHand(records)).toBe(10_000);
  });

  it('withCurrentNames uses the renamed name and keeps names of people who left', () => {
    const records = [
      newRecord({ type: 'PAYMENT', amountCentavos: 100, memberId: 'a', memberName: 'Old Name' }),
      newRecord({ type: 'PAYMENT', amountCentavos: 100, memberId: 'gone', memberName: 'Left Early' }),
    ];
    const shown = Ledger.withCurrentNames(records, [newMember({ id: 'a', name: 'New Name' })]);
    expect(shown.map((r) => r.memberName)).toEqual(['New Name', 'Left Early']);
  });
});

describe('Money', () => {
  it('formats with the peso sign, separators and two decimals', () => {
    expect(formatMoney(425_000)).toBe('₱4,250.00');
    expect(formatMoney(5)).toBe('₱0.05');
    expect(formatMoney(0)).toBe('₱0.00');
    expect(formatMoney(123_456_789)).toBe('₱1,234,567.89');
    expect(formatMoney(-800)).toBe('-₱8.00');
    expect(formatMoney(-50)).toBe('-₱0.50');
  });

  it('parses pesos', () => {
    expect(parsePesos('100')).toBe(10_000);
    expect(parsePesos('1,250.50')).toBe(125_050);
    expect(parsePesos('0.05')).toBe(5);
    expect(parsePesos('  100.00 ')).toBe(10_000);
    for (const bad of ['', 'abc', '0', '-5', '1.234', '.', '1e3']) expect(parsePesos(bad)).toBeNull();
  });
});

describe('LedgerView', () => {
  const rec = (id: string, type: RecordType, pesos: number, o: { member?: string; date?: number; batch?: string; note?: string } = {}) =>
    newRecord({ id, type, amountCentavos: pesos * 100, memberId: o.member ?? '', memberName: o.member ?? '', dateMillis: o.date ?? 0, batchId: o.batch ?? '', note: o.note ?? '' });
  const records = [
    rec('p1', 'PAYMENT', 100, { member: 'ana', date: 10 }),
    rec('c1', 'CHARGE', 6, { member: 'ana', date: 20, batch: 'b1', note: 'Quiz - OR' }),
    rec('c2', 'CHARGE', 6, { member: 'lito', date: 20, batch: 'b1', note: 'Quiz - OR' }),
    rec('c3', 'CHARGE', 6, { member: 'kim', date: 20, batch: 'b1', note: 'Quiz - OR' }),
    rec('w1', 'WITHDRAWAL', 50, { member: 'lito', date: 30 }),
    rec('e1', 'EXPENSE', 18, { date: 40, note: 'Printing' }),
  ];

  it('folds each charge batch into one line, newest first', () => {
    expect(LedgerView.entries(records).map((e) => e.key)).toEqual(['r:e1', 'r:w1', 'b:b1', 'r:p1']);
  });

  it('a batch reports count, total and per-student amount', () => {
    const batch = LedgerView.entries(records).find((e) => e.kind === 'batch') as ChargeBatch;
    expect([batch.count, batch.totalCentavos, batch.perMemberCentavos, batch.note]).toEqual([3, 1_800, 600, 'Quiz - OR']);
    const mixed = [rec('a', 'CHARGE', 6, { member: 'ana', batch: 'b' }), rec('b', 'CHARGE', 7, { member: 'lito', batch: 'b' })];
    expect((LedgerView.entries(mixed)[0] as ChargeBatch).perMemberCentavos).toBeNull();
    expect(LedgerView.entries([rec('x', 'CHARGE', 6, { member: 'ana' })])[0].kind).toBe('single');
  });

  it('filters', () => {
    expect(LedgerView.filter(records, 'MINE', 'lito').map((e) => e.key)).toEqual(['r:w1', 'r:c2']);
    expect(LedgerView.filter(records, 'PAYMENTS', '').map((e) => e.key)).toEqual(['r:p1']);
    expect(LedgerView.filter(records, 'CHARGES', '').map((e) => e.key)).toEqual(['b:b1']);
    expect(LedgerView.filter(records, 'WITHDRAWALS', '').map((e) => e.key)).toEqual(['r:w1']);
    expect(LedgerView.filter(records, 'PAYOUTS', '').map((e) => e.key)).toEqual(['r:e1']);
  });

  it('display amounts are positive only for payments', () => {
    const byKey = new Map(LedgerView.entries(records).map((e) => [e.key, e]));
    expect(LedgerView.displayAmount(byKey.get('r:p1')!)).toBe(10_000);
    expect(LedgerView.displayAmount(byKey.get('b:b1')!)).toBe(-1_800);
    expect(LedgerView.displayAmount(byKey.get('r:w1')!)).toBe(-5_000);
    expect(LedgerView.displayAmount(byKey.get('r:e1')!)).toBe(-1_800);
  });

  it('statement is one member, newest first', () => {
    expect(LedgerView.statement('ana', records).map((r) => r.id)).toEqual(['c1', 'p1']);
  });
});

describe('LedgerForms', () => {
  it('amount must be present and not huge', () => {
    expect(LedgerForms.checkAmount(null)).not.toBeNull();
    expect(LedgerForms.checkAmount(LedgerForms.MAX_AMOUNT_CENTAVOS + 1)).not.toBeNull();
    expect(LedgerForms.checkAmount(LedgerForms.MAX_AMOUNT_CENTAVOS)).toBeNull();
    expect(LedgerForms.checkAmount(1)).toBeNull();
  });

  it('payments and withdrawals', () => {
    expect(LedgerForms.checkRecord('PAYMENT', 10_000, '', null)).toBe('Choose who paid.');
    expect(LedgerForms.checkRecord('PAYMENT', 10_000, 'ana', 0)).toBeNull();
    expect(LedgerForms.checkRecord('WITHDRAWAL', 5_001, 'ana', 5_000)).not.toBeNull();
    expect(LedgerForms.checkRecord('WITHDRAWAL', 5_000, 'ana', 5_000)).toBeNull();
    expect(LedgerForms.checkRecord('WITHDRAWAL', 100, 'lito', -800)).not.toBeNull();
    expect(LedgerForms.checkRecord('WITHDRAWAL', 100, '', null)).toBe('Choose who is withdrawing.');
    expect(LedgerForms.checkRecord('EXPENSE', 100, '', null)).not.toBeNull();
    expect(LedgerForms.checkRecord('CHARGE', 100, 'ana', null)).not.toBeNull();
    expect(LedgerForms.checkRecord('PAYMENT', null, '', null)).toBe(LedgerForms.checkAmount(null));
  });

  it('pay-outs and charges', () => {
    const c = chargeBatch('b1', [newRecord({ type: 'CHARGE', amountCentavos: 600, batchId: 'b1' })]);
    expect(LedgerForms.checkPayout(null, false)).not.toBeNull();
    expect(LedgerForms.checkPayout(c, true)).not.toBeNull();
    expect(LedgerForms.checkPayout(c, false)).toBeNull();
    expect(LedgerForms.checkCharge(null, 'Quiz', 3)).not.toBeNull();
    expect(LedgerForms.checkCharge(600, ' ', 3)).not.toBeNull();
    expect(LedgerForms.checkCharge(600, 'Quiz', 0)).not.toBeNull();
    expect(LedgerForms.checkCharge(600, 'Quiz', LedgerForms.MAX_CHARGED + 1)).not.toBeNull();
    expect(LedgerForms.checkCharge(600, 'Quiz', 29)).toBeNull();
    expect(LedgerForms.MAX_CHARGED + 1).toBe(500);
  });
});

describe('ChargePlanner', () => {
  const lito2 = newMember({ id: 'lito', name: 'Lito', excludedCourseIds: ['or'] });
  const kim2 = newMember({ id: 'kim', name: 'Kim', excludedCourseIds: ['or', 'swe'] });
  const members = [ana, lito2, kim2];

  it('eligible skips members who exclude the course', () => {
    expect(ChargePlanner.eligible(members, 'or').map((m) => m.id)).toEqual(['ana']);
    expect(ChargePlanner.eligible(members, 'swe').map((m) => m.id)).toEqual(['ana', 'lito']);
    expect(ChargePlanner.eligible(members, '').length).toBe(3);
    expect(ChargePlanner.eligible(members, 'brandNewCourse').length).toBe(3);
  });

  it('preview with overrides', () => {
    const p = ChargePlanner.preview(members, 'swe', 600);
    expect([p.charged.length, p.skipped.length, p.totalCentavos]).toEqual([2, 1, 1_200]);
    const inc = ChargePlanner.preview(members, 'or', 600, new Set(['lito']));
    expect(new Set(inc.charged.map((m) => m.id))).toEqual(new Set(['ana', 'lito']));
    expect(inc.skipped.map((m) => m.id)).toEqual(['kim']);
    const exc = ChargePlanner.preview(members, '', 600, new Set(), new Set(['ana']));
    expect(new Set(exc.charged.map((m) => m.id))).toEqual(new Set(['lito', 'kim']));
    const none = ChargePlanner.preview([kim2], 'or', 600);
    expect([none.charged.length, none.totalCentavos]).toEqual([0, 0]);
  });

  it('buildRecords makes one charge per member sharing the batch', () => {
    const records = ChargePlanner.buildRecords(ChargePlanner.preview(members, 'swe', 600), 'Quiz - SWE', 'swe', 1_000, 'b1');
    expect(records.length).toBe(2);
    expect(records.every((r) => r.type === 'CHARGE' && r.batchId === 'b1' && r.amountCentavos === 600)).toBe(true);
    expect(records.map((r) => r.memberId)).toEqual(['ana', 'lito']);
    expect([records[0].note, records[0].courseId]).toEqual(['Quiz - SWE', 'swe']);
    const orRecords = ChargePlanner.buildRecords(ChargePlanner.preview(members, 'or', 600), 'Quiz - OR', 'or', 0, 'b2');
    const balances = Ledger.memberBalances(members, orRecords);
    expect([balances.get('ana'), balances.get('lito'), balances.get('kim'), Ledger.cashOnHand(orRecords)]).toEqual([-600, 0, 0, 0]);
  });
});

describe('Pay-outs (the ₱6 OR quiz example)', () => {
  const students = Array.from({ length: 30 }, (_, i) => newMember({ id: `s${i + 1}`, name: `Student ${i + 1}` }));
  const payments = students.map((s) =>
    newRecord({ id: `p-${s.id}`, type: 'PAYMENT', amountCentavos: 10_000, memberId: s.id, memberName: s.name, dateMillis: 1 }),
  );
  const quizCharge = (batch = 'quiz') =>
    ChargePlanner.buildRecords(ChargePlanner.preview(students, '', 600), 'Quiz - OR', '', 2, batch).map((r, i) => ({ ...r, id: `${batch}-${i}` }));
  const payout = (batch = 'quiz', amount = 18_000) => ({ ...ChargePlanner.buildPayout(batch, amount, 'Quiz - OR', 3, ' Prof. Santos '), id: `e-${batch}` });

  it('books balance through payments, a charge and its pay-out', () => {
    expect([Ledger.cashOnHand(payments), Ledger.awaitingPayout(payments), Ledger.booksDifference(payments)]).toEqual([300_000, 0, 0]);
    const charged = [...payments, ...quizCharge()];
    expect([Ledger.cashOnHand(charged), Ledger.awaitingPayout(charged), Ledger.availableCash(charged), Ledger.booksDifference(charged)]).toEqual([300_000, 18_000, 282_000, 0]);
    expect(LedgerView.unpaidCharges(charged).map((c) => c.batchId)).toEqual(['quiz']);
    const paid = [...charged, payout()];
    expect([Ledger.cashOnHand(paid), Ledger.awaitingPayout(paid), Ledger.availableCash(paid), Ledger.booksDifference(paid)]).toEqual([282_000, 0, 282_000, 0]);
    expect(LedgerView.unpaidCharges(paid)).toEqual([]);
    expect(Ledger.paidOutBatchIds(paid)).toEqual(new Set(['quiz']));
  });

  it('a pay-out is exactly the charge total and links back', () => {
    const c = LedgerView.entries(quizCharge()).find((e) => e.kind === 'batch') as ChargeBatch;
    const p = ChargePlanner.buildPayout(c.batchId, c.totalCentavos, c.note, 3, 'Prof. Santos');
    expect([p.amountCentavos, p.settlesBatchId, p.type, p.memberId]).toEqual([18_000, 'quiz', 'EXPENSE', '']);
    expect(payout().paidTo).toBe('Prof. Santos');
    const records = [...payments, ...quizCharge(), payout()];
    expect(LedgerView.payoutFor('quiz', records)?.id).toBe('e-quiz');
    expect(LedgerView.chargeFor(payout(), records)?.batchId).toBe('quiz');
    expect(LedgerView.payoutFor('other', records)).toBeNull();
  });

  it('the books check catches mistakes and counts removed members', () => {
    expect(Ledger.booksDifference([...payments, payout()])).toBe(-18_000);
    expect(Ledger.booksDifference([...payments, newRecord({ type: 'CHARGE', amountCentavos: 600, memberId: 's1' })])).toBe(600);
    const w = newRecord({ type: 'WITHDRAWAL', amountCentavos: 5_000, memberId: 's1' });
    expect(Ledger.booksDifference([...payments, ...quizCharge(), payout(), w])).toBe(0);
    expect(Ledger.booksDifference([...payments, newRecord({ type: 'PAYMENT', amountCentavos: 2_000, memberId: 'left-the-class' })])).toBe(0);
  });

  it('the To pay out filter lists unpaid charges, oldest first', () => {
    const records = [
      ...payments,
      ...quizCharge('old').map((r) => ({ ...r, dateMillis: 2 })),
      ...quizCharge('new').map((r) => ({ ...r, dateMillis: 5 })),
      ...quizCharge('done'),
      payout('done'),
    ];
    expect(LedgerView.filter(records, 'TO_PAY_OUT', '').map((e) => e.key)).toEqual(['b:old', 'b:new']);
  });
});
