import { describe, expect, it } from 'vitest';
import { newMember, newRecord } from '../data/models';
import { Ledger } from './ledger';

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
