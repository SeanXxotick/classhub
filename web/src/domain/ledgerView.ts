import type { LedgerRecord, RecordType } from '../data/models';
import { Ledger } from './ledger';
import { compareStrings } from './classRules';

/** One line in the ledger list. A charge to many students shows as a single ChargeBatch line. */
export type LedgerEntry = SingleEntry | ChargeBatch;

export interface SingleEntry {
  kind: 'single';
  key: string;
  type: RecordType;
  dateMillis: number;
  record: LedgerRecord;
}

export interface ChargeBatch {
  kind: 'batch';
  key: string;
  type: 'CHARGE';
  dateMillis: number;
  batchId: string;
  records: LedgerRecord[];
  note: string;
  courseId: string;
  count: number;
  totalCentavos: number;
  /** The amount each student was charged, or null if the amounts differ. */
  perMemberCentavos: number | null;
}

export function single(record: LedgerRecord): SingleEntry {
  return { kind: 'single', key: 'r:' + record.id, type: record.type, dateMillis: record.dateMillis, record };
}

export function chargeBatch(batchId: string, records: LedgerRecord[]): ChargeBatch {
  const amounts = new Set(records.map((r) => r.amountCentavos));
  return {
    kind: 'batch',
    key: 'b:' + batchId,
    type: 'CHARGE',
    dateMillis: Math.max(...records.map((r) => r.dateMillis)),
    batchId,
    records,
    note: records[0].note,
    courseId: records[0].courseId,
    count: records.length,
    totalCentavos: records.reduce((a, r) => a + r.amountCentavos, 0),
    perMemberCentavos: amounts.size === 1 ? records[0].amountCentavos : null,
  };
}

export const LEDGER_FILTERS = [
  { id: 'ALL', label: 'All' },
  { id: 'MINE', label: 'Mine' },
  { id: 'TO_PAY_OUT', label: 'To pay out' },
  { id: 'PAYMENTS', label: 'Payments' },
  { id: 'CHARGES', label: 'Charges' },
  { id: 'WITHDRAWALS', label: 'Withdrawals' },
  { id: 'PAYOUTS', label: 'Pay-outs' },
] as const;
export type LedgerFilter = (typeof LEDGER_FILTERS)[number]['id'];

const newestFirst = <T extends { dateMillis: number }>(list: T[]) => [...list].sort((a, b) => b.dateMillis - a.dateMillis);

export const LedgerView = {
  /** Newest first. CHARGE records that share a batch id are folded into one ChargeBatch. */
  entries(records: LedgerRecord[]): LedgerEntry[] {
    const singles: LedgerEntry[] = [];
    const groups = new Map<string, LedgerRecord[]>();
    for (const r of records) {
      if (r.type === 'CHARGE' && r.batchId) {
        const list = groups.get(r.batchId);
        if (list) list.push(r);
        else groups.set(r.batchId, [r]);
      } else singles.push(single(r));
    }
    const batches = [...groups].map(([id, list]) =>
      chargeBatch(id, [...list].sort((a, b) => compareStrings(a.memberName.toLowerCase(), b.memberName.toLowerCase()))),
    );
    return newestFirst([...singles, ...batches]);
  },

  /**
   * Applies a filter chip. "Mine" lists the signed-in student's own records one by one (including their
   * share of each charge), so a student sees exactly what moved their balance.
   */
  filter(records: LedgerRecord[], filter: LedgerFilter, myUid: string): LedgerEntry[] {
    const ofType = (type: RecordType) => LedgerView.entries(records.filter((r) => r.type === type));
    switch (filter) {
      case 'ALL':
        return LedgerView.entries(records);
      case 'MINE':
        return newestFirst(records.filter((r) => r.memberId === myUid)).map(single);
      case 'TO_PAY_OUT':
        return LedgerView.unpaidCharges(records);
      case 'PAYMENTS':
        return ofType('PAYMENT');
      case 'CHARGES':
        return ofType('CHARGE');
      case 'WITHDRAWALS':
        return ofType('WITHDRAWAL');
      case 'PAYOUTS':
        return ofType('EXPENSE');
    }
  },

  /** Charges that no pay-out has settled yet, oldest first (the order to pay them in). */
  unpaidCharges(records: LedgerRecord[]): ChargeBatch[] {
    const paid = Ledger.paidOutBatchIds(records);
    return LedgerView.entries(records.filter((r) => r.type === 'CHARGE' && r.batchId && !paid.has(r.batchId)))
      .filter((e): e is ChargeBatch => e.kind === 'batch')
      .sort((a, b) => a.dateMillis - b.dateMillis);
  },

  /** The pay-out that settled the batch, if any. */
  payoutFor(batchId: string, records: LedgerRecord[]): LedgerRecord | null {
    return records.find((r) => r.type === 'EXPENSE' && r.settlesBatchId === batchId) ?? null;
  },

  /** The charge a pay-out settled, if it still exists. */
  chargeFor(payout: LedgerRecord, records: LedgerRecord[]): ChargeBatch | null {
    const entries = LedgerView.entries(records.filter((r) => r.type === 'CHARGE' && r.batchId === payout.settlesBatchId));
    return (entries.find((e) => e.kind === 'batch') as ChargeBatch | undefined) ?? null;
  },

  /** A member's own records, newest first. */
  statement(memberId: string, records: LedgerRecord[]): LedgerRecord[] {
    return newestFirst(records.filter((r) => r.memberId === memberId));
  },

  /** Signed amount shown on a ledger line, from the class fund's point of view for pay-outs. */
  displayAmount(entry: LedgerEntry): number {
    if (entry.kind === 'batch') return -entry.totalCentavos;
    return entry.record.type === 'PAYMENT' ? entry.record.amountCentavos : -entry.record.amountCentavos;
  },
};
