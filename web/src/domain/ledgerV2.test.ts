import { describe, expect, it } from 'vitest';
import { newMember, newRecord } from '../data/models';
import { Ledger } from './ledger';
import { LedgerView, single } from './ledgerView';

const rec = (type: Parameters<typeof newRecord>[0]['type'], amount: number, extra = {}) =>
  newRecord({ id: Math.random().toString(36), type, amountCentavos: amount, memberId: type === 'EXPENSE' ? '' : 'ana', memberName: 'Ana', ...extra });

describe('voided records', () => {
  it('count toward nothing', () => {
    const records = [rec('PAYMENT', 10000), rec('PAYMENT', 5000, { voidedAtMillis: 9, voidedByUid: 'tr', voidReason: 'Typo' })];
    expect(Ledger.cashOnHand(records)).toBe(10000);
    expect(Ledger.memberBalances([newMember({ id: 'ana' })], records).get('ana')).toBe(10000);
    expect(Ledger.total(records, 'PAYMENT')).toBe(10000);
    expect(Ledger.booksDifference(records)).toBe(0);
  });

  it('a voided pay-out makes its charge waiting again', () => {
    const charge = rec('CHARGE', 600, { batchId: 'b1' });
    const payout = rec('EXPENSE', 600, { settlesBatchId: 'b1' });
    expect(Ledger.awaitingPayout([charge, payout])).toBe(0);
    expect(Ledger.awaitingPayout([charge, { ...payout, voidedAtMillis: 5 }])).toBe(600);
  });

  it('a person whose only records are voided is settled', () => {
    expect(Ledger.unsettled([rec('PAYMENT', 100, { voidedAtMillis: 5 })])).toEqual([]);
  });

  it('keeps the books balanced after any mix of voids', () => {
    const records = [
      rec('PAYMENT', 20000),
      rec('CHARGE', 600, { batchId: 'b1' }),
      rec('EXPENSE', 600, { settlesBatchId: 'b1', voidedAtMillis: 7 }),
      rec('WITHDRAWAL', 1000),
    ];
    expect(Ledger.booksDifference(records)).toBe(0);
  });
});

describe('opening balances', () => {
  it('a positive opening raises the balance and the cash together', () => {
    const records = [rec('OPENING', 25000)];
    expect(Ledger.cashOnHand(records)).toBe(25000);
    expect(Ledger.memberBalances([newMember({ id: 'ana' })], records).get('ana')).toBe(25000);
    expect(Ledger.booksDifference(records)).toBe(0);
  });

  it('a negative opening (the student owes) lowers both, and the books still balance', () => {
    const records = [rec('OPENING', -5000), rec('PAYMENT', 8000)];
    expect(Ledger.memberBalances([newMember({ id: 'ana' })], records).get('ana')).toBe(3000);
    expect(Ledger.cashOnHand(records)).toBe(3000);
    expect(Ledger.booksDifference(records)).toBe(0);
  });

  it('is not counted as money collected', () => {
    expect(Ledger.netCollected([rec('OPENING', 25000)])).toBe(0);
  });
});

describe('fund summary', () => {
  const records = [
    rec('PAYMENT', 20000),
    rec('CHARGE', 600, { batchId: 'b1' }),
    rec('CHARGE', 600, { batchId: 'b1', memberId: 'ben', memberName: 'Ben' }),
    rec('EXPENSE', 1200, { settlesBatchId: 'b1' }),
    rec('WITHDRAWAL', 1000, { voidedAtMillis: 3 }),
    rec('CHARGE', 300, { batchId: 'b2' }),
  ];

  it('adds up what members may see', () => {
    expect(Ledger.summarize(records)).toEqual({
      cashOnHandCentavos: 20000 - 1200,
      waitingPayoutCentavos: 300,
      balancesTotalCentavos: 20000 - 600 - 600 - 300,
      recordCount: 5,
    });
  });

  it('incremental deltas add up to the same totals as recomputing', () => {
    const sum = records.filter((r) => !r.voidedAtMillis).map(Ledger.summaryDelta).reduce(
      (a, d) => ({
        cashOnHandCentavos: a.cashOnHandCentavos + d.cashOnHandCentavos,
        waitingPayoutCentavos: a.waitingPayoutCentavos + d.waitingPayoutCentavos,
        balancesTotalCentavos: a.balancesTotalCentavos + d.balancesTotalCentavos,
        recordCount: a.recordCount + d.recordCount,
      }),
      { cashOnHandCentavos: 0, waitingPayoutCentavos: 0, balancesTotalCentavos: 0, recordCount: 0 },
    );
    expect(Ledger.summaryMatches(sum, records)).toBe(true);
  });

  it('notices a summary that drifted', () => {
    expect(Ledger.summaryMatches({ ...Ledger.summarize(records), cashOnHandCentavos: 1 }, records)).toBe(false);
    expect(Ledger.summaryMatches(null, records)).toBe(false);
  });
});

describe('ledger list with voids and opening balances', () => {
  const charge = (id: string, extra = {}) => rec('CHARGE', 600, { id, batchId: 'b1', ...extra });
  const payout = (extra = {}) => rec('EXPENSE', 1200, { id: 'e1', settlesBatchId: 'b1', ...extra });

  it('shows an opening balance with its own sign', () => {
    expect(LedgerView.displayAmount(single(rec('OPENING', 25000)))).toBe(25000);
    expect(LedgerView.displayAmount(single(rec('OPENING', -5000)))).toBe(-5000);
  });

  it('a voided pay-out no longer counts as the pay-out of its charge', () => {
    const records = [charge('c1'), charge('c2'), payout({ voidedAtMillis: 4 })];
    expect(LedgerView.payoutFor('b1', records)).toBeNull();
    expect(LedgerView.unpaidCharges(records).map((b) => b.batchId)).toEqual(['b1']);
  });

  it('a later pay-out is found even when an earlier one was voided', () => {
    const records = [charge('c1'), charge('c2'), payout({ voidedAtMillis: 4 }), payout({ id: 'e2' })];
    expect(LedgerView.payoutFor('b1', records)?.id).toBe('e2');
    expect(LedgerView.unpaidCharges(records)).toEqual([]);
    expect(Ledger.booksDifference(records)).toBe(0);
  });

  it('a voided charge is not waiting to be paid out, and is marked voided in the list', () => {
    const records = [charge('c1', { voidedAtMillis: 4 }), charge('c2', { voidedAtMillis: 4 })];
    expect(LedgerView.unpaidCharges(records)).toEqual([]);
    expect(Ledger.awaitingPayout(records)).toBe(0);
    const [entry] = LedgerView.entries(records);
    expect(entry.kind === 'batch' && entry.voided).toBe(true);
  });

  it('the books check catches a charge voided while its pay-out still stands', () => {
    const records = [charge('c1', { voidedAtMillis: 4 }), charge('c2', { voidedAtMillis: 4 }), payout()];
    expect(Ledger.booksDifference(records)).toBe(-1200);
  });

  it('the books check catches one share voided out of a paid-out charge', () => {
    const records = [charge('c1', { voidedAtMillis: 4 }), charge('c2'), payout()];
    expect(Ledger.booksDifference(records)).toBe(-600);
  });
});

describe('fund summary when voiding', () => {
  type Totals = ReturnType<typeof Ledger.summarize>;
  const add = (a: Totals, d: Totals): Totals => ({
    cashOnHandCentavos: a.cashOnHandCentavos + d.cashOnHandCentavos,
    waitingPayoutCentavos: a.waitingPayoutCentavos + d.waitingPayoutCentavos,
    balancesTotalCentavos: a.balancesTotalCentavos + d.balancesTotalCentavos,
    recordCount: a.recordCount + d.recordCount,
  });

  it('voiding a pay-out by increments matches recomputing', () => {
    const charges = [rec('CHARGE', 600, { batchId: 'b1' }), rec('CHARGE', 600, { batchId: 'b1', memberId: 'ben' })];
    const payout = rec('EXPENSE', 1200, { settlesBatchId: 'b1' });
    const before = [rec('PAYMENT', 20000), ...charges, payout];
    const stored = add(Ledger.summarize(before), Ledger.summaryDeltaForVoid(payout));
    const after = before.map((r) => (r === payout ? { ...r, voidedAtMillis: 9 } : r));
    expect(Ledger.summaryMatches(stored, after)).toBe(true);
    expect(stored.waitingPayoutCentavos).toBe(1200);
  });

  it('voiding a whole unpaid charge by increments matches recomputing', () => {
    const charges = [rec('CHARGE', 600, { batchId: 'b1' }), rec('CHARGE', 600, { batchId: 'b1', memberId: 'ben' })];
    const before = [rec('PAYMENT', 20000), ...charges];
    const stored = charges.map(Ledger.summaryDeltaForVoid).reduce(add, Ledger.summarize(before));
    const after = before.map((r) => (charges.includes(r) ? { ...r, voidedAtMillis: 9 } : r));
    expect(Ledger.summaryMatches(stored, after)).toBe(true);
  });

  it('voiding an opening balance by increments matches recomputing', () => {
    const opening = rec('OPENING', -5000);
    const payment = rec('PAYMENT', 20000);
    const stored = add(Ledger.summarize([payment, opening]), Ledger.summaryDeltaForVoid(opening));
    expect(Ledger.summaryMatches(stored, [payment, { ...opening, voidedAtMillis: 9 }])).toBe(true);
  });
});

describe('balances are not limited', () => {
  it('a withdrawal larger than the balance leaves the student owing, and the books still balance', () => {
    const records = [rec('PAYMENT', 5000), rec('WITHDRAWAL', 8000)];
    expect(Ledger.memberBalances([newMember({ id: 'ana' })], records).get('ana')).toBe(-3000);
    expect(Ledger.cashOnHand(records)).toBe(-3000);
    expect(Ledger.booksDifference(records)).toBe(0);
    expect(Ledger.status(-3000)).toBe('OWES');
  });

  it('a pay-out may take the cash on hand below zero', () => {
    const records = [rec('CHARGE', 600, { batchId: 'b1' }), rec('EXPENSE', 600, { settlesBatchId: 'b1' })];
    expect(Ledger.cashOnHand(records)).toBe(-600);
    expect(Ledger.booksDifference(records)).toBe(0);
  });
});
