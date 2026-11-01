import type { LedgerRecord, Member, RecordType } from '../data/models';

export type BalanceStatus = 'OWES' | 'CREDIT' | 'SETTLED';

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** Pure ledger math, kept free of the browser and Firebase so it can be unit tested. */
export const Ledger = {
  /** Effect on the member's own balance. An EXPENSE has no member, so it is 0. */
  memberDelta(record: LedgerRecord): number {
    switch (record.type) {
      case 'PAYMENT':
        return record.amountCentavos;
      case 'CHARGE':
      case 'WITHDRAWAL':
        return -record.amountCentavos;
      case 'EXPENSE':
        return 0;
    }
  },

  /** Effect on the class's cash. A CHARGE only reassigns cost between members, so it is 0. */
  cashDelta(record: LedgerRecord): number {
    switch (record.type) {
      case 'PAYMENT':
        return record.amountCentavos;
      case 'WITHDRAWAL':
      case 'EXPENSE':
        return -record.amountCentavos;
      case 'CHARGE':
        return 0;
    }
  },

  cashOnHand(records: LedgerRecord[]): number {
    return sum(records.map(Ledger.cashDelta));
  },

  total(records: LedgerRecord[], type: RecordType): number {
    return sum(records.filter((r) => r.type === type).map((r) => r.amountCentavos));
  },

  /** Payments minus what members withdrew back out. Charges and expenses do not count. */
  netCollected(records: LedgerRecord[]): number {
    return Ledger.total(records, 'PAYMENT') - Ledger.total(records, 'WITHDRAWAL');
  },

  /** Balance per member id. Members with no records are included at zero. */
  memberBalances(members: Member[], records: LedgerRecord[]): Map<string, number> {
    const byMember = new Map<string, number>();
    for (const r of records) {
      if (!r.memberId) continue;
      byMember.set(r.memberId, (byMember.get(r.memberId) ?? 0) + Ledger.memberDelta(r));
    }
    return new Map(members.map((m) => [m.id, byMember.get(m.id) ?? 0]));
  },

  /** Batch ids of charges that a pay-out has settled. */
  paidOutBatchIds(records: LedgerRecord[]): Set<string> {
    return new Set(records.filter((r) => r.type === 'EXPENSE' && r.settlesBatchId).map((r) => r.settlesBatchId));
  },

  /** Money charged to students that has not been paid out yet (still owed to professors and others). */
  awaitingPayout(records: LedgerRecord[]): number {
    const paid = Ledger.paidOutBatchIds(records);
    return sum(records.filter((r) => r.type === 'CHARGE' && r.batchId && !paid.has(r.batchId)).map((r) => r.amountCentavos));
  },

  /** Cash that is not already owed for a charge. */
  availableCash(records: LedgerRecord[]): number {
    return Ledger.cashOnHand(records) - Ledger.awaitingPayout(records);
  },

  /**
   * The books balance when cash on hand equals everyone's balances plus charges not yet paid out.
   * Returns the difference in centavos: 0 means balanced. Every member who ever had a record counts,
   * including people who were later removed from the class.
   */
  booksDifference(records: LedgerRecord[]): number {
    const allBalances = sum(records.filter((r) => r.memberId).map(Ledger.memberDelta));
    return Ledger.cashOnHand(records) - allBalances - Ledger.awaitingPayout(records);
  },

  /**
   * Records keep the member's name from the day they were saved. This shows each one under the
   * member's current name, so a renamed student's history follows them. Records of people who left keep their saved name.
   */
  withCurrentNames(records: LedgerRecord[], members: Member[]): LedgerRecord[] {
    const names = new Map(members.map((m) => [m.id, m.name]));
    return records.map((r) => {
      const current = names.get(r.memberId);
      return !current || !current.trim() || current === r.memberName ? r : { ...r, memberName: current };
    });
  },

  status(balanceCentavos: number): BalanceStatus {
    if (balanceCentavos < 0) return 'OWES';
    if (balanceCentavos > 0) return 'CREDIT';
    return 'SETTLED';
  },
};
