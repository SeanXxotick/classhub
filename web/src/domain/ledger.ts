import type { LedgerRecord, Member, RecordType } from '../data/models';

/** The fund totals every member may read, kept in classes/{classId}/summary/fund. */
export interface FundSummary {
  cashOnHandCentavos: number;
  waitingPayoutCentavos: number;
  balancesTotalCentavos: number;
  recordCount: number;
}

export type BalanceStatus = 'OWES' | 'CREDIT' | 'SETTLED';

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** Voided records stay in the history but count toward nothing. */
const live = (records: LedgerRecord[]) => records.filter((r) => !r.voidedAtMillis);

/** Pure ledger math, kept free of the browser and Firebase so it can be unit tested. */
export const Ledger = {
  /** The records that count: everything except voided ones. */
  live,

  /**
   * Effect on the member's own balance. An EXPENSE has no member, so it is 0.
   * OPENING carries a balance in from before: its amount is signed (negative = owes) and it moves the cash by the
   * same amount, so cash on hand still equals all balances plus charges not yet paid out. That is only true to the
   * real fund when the earlier books had no charge waiting to be paid out, so those are paid out before carrying over.
   */
  memberDelta(record: LedgerRecord): number {
    switch (record.type) {
      case 'PAYMENT':
      case 'OPENING':
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
      case 'OPENING':
        return record.amountCentavos;
      case 'WITHDRAWAL':
      case 'EXPENSE':
        return -record.amountCentavos;
      case 'CHARGE':
        return 0;
    }
  },

  cashOnHand(records: LedgerRecord[]): number {
    return sum(live(records).map(Ledger.cashDelta));
  },

  total(records: LedgerRecord[], type: RecordType): number {
    return sum(live(records).filter((r) => r.type === type).map((r) => r.amountCentavos));
  },

  /** Payments minus what members withdrew back out. Charges and expenses do not count. */
  netCollected(records: LedgerRecord[]): number {
    return Ledger.total(records, 'PAYMENT') - Ledger.total(records, 'WITHDRAWAL');
  },

  /** Balance per member id. Members with no records are included at zero. */
  memberBalances(members: Member[], records: LedgerRecord[]): Map<string, number> {
    const byMember = new Map<string, number>();
    for (const r of live(records)) {
      if (!r.memberId) continue;
      byMember.set(r.memberId, (byMember.get(r.memberId) ?? 0) + Ledger.memberDelta(r));
    }
    return new Map(members.map((m) => [m.id, byMember.get(m.id) ?? 0]));
  },

  /** Batch ids of charges that a pay-out has settled. */
  paidOutBatchIds(records: LedgerRecord[]): Set<string> {
    return new Set(live(records).filter((r) => r.type === 'EXPENSE' && r.settlesBatchId).map((r) => r.settlesBatchId));
  },

  /** Money charged to students that has not been paid out yet (still owed to professors and others). */
  awaitingPayout(records: LedgerRecord[]): number {
    const paid = Ledger.paidOutBatchIds(records);
    return sum(live(records).filter((r) => r.type === 'CHARGE' && r.batchId && !paid.has(r.batchId)).map((r) => r.amountCentavos));
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
    const allBalances = sum(live(records).filter((r) => r.memberId).map(Ledger.memberDelta));
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

  /**
   * Everyone whose balance is not zero, with their latest saved name, owing first and then by amount.
   * People who left the class count too: their money is still part of the class's books.
   */
  unsettled(records: LedgerRecord[]): { memberId: string; name: string; balanceCentavos: number }[] {
    const people = new Map<string, { memberId: string; name: string; balanceCentavos: number }>();
    for (const r of live(records)) {
      if (!r.memberId) continue;
      const person = people.get(r.memberId) ?? { memberId: r.memberId, name: r.memberName, balanceCentavos: 0 };
      person.balanceCentavos += Ledger.memberDelta(r);
      if (r.memberName.trim()) person.name = r.memberName;
      people.set(r.memberId, person);
    }
    return [...people.values()]
      .filter((p) => p.balanceCentavos !== 0)
      .sort((a, b) => a.balanceCentavos - b.balanceCentavos);
  },

  /** A class can be deleted only when every balance is zero and no money is left in the fund. */
  canCloseBooks(records: LedgerRecord[]): boolean {
    return Ledger.unsettled(records).length === 0 && Ledger.cashOnHand(records) === 0;
  },

  /** The totals to store in the fund summary. Voided records are left out. */
  summarize(records: LedgerRecord[]): FundSummary {
    const active = live(records);
    return {
      cashOnHandCentavos: Ledger.cashOnHand(active),
      waitingPayoutCentavos: Ledger.awaitingPayout(active),
      balancesTotalCentavos: sum(active.filter((r) => r.memberId).map(Ledger.memberDelta)),
      recordCount: active.length,
    };
  },

  /** True when the stored summary matches what the records add up to. */
  summaryMatches(stored: Partial<FundSummary> | null | undefined, records: LedgerRecord[]): boolean {
    if (!stored) return false;
    const wanted = Ledger.summarize(records);
    return (Object.keys(wanted) as (keyof FundSummary)[]).every((k) => stored[k] === wanted[k]);
  },

  /**
   * Changes to the stored summary for one new record, written as increments in the same batch as the record.
   * It relies on what the app guarantees: a pay-out is for exactly its charge's total, and a charge has one
   * pay-out at most. If the stored totals ever differ, summaryMatches notices and the app rewrites them.
   */
  summaryDelta(record: LedgerRecord): FundSummary {
    const waiting = record.type === 'CHARGE' ? record.amountCentavos : record.type === 'EXPENSE' ? -record.amountCentavos : 0;
    return {
      cashOnHandCentavos: Ledger.cashDelta(record),
      waitingPayoutCentavos: waiting,
      balancesTotalCentavos: record.memberId ? Ledger.memberDelta(record) : 0,
      recordCount: 1,
    };
  },

  /** Changes to the stored summary when a record is voided: exactly the opposite of adding it. */
  summaryDeltaForVoid(record: LedgerRecord): FundSummary {
    const d = Ledger.summaryDelta(record);
    return {
      cashOnHandCentavos: 0 - d.cashOnHandCentavos,
      waitingPayoutCentavos: 0 - d.waitingPayoutCentavos,
      balancesTotalCentavos: 0 - d.balancesTotalCentavos,
      recordCount: -1,
    };
  },

  status(balanceCentavos: number): BalanceStatus {
    if (balanceCentavos < 0) return 'OWES';
    if (balanceCentavos > 0) return 'CREDIT';
    return 'SETTLED';
  },
};
