import { newRecord, type LedgerRecord, type Member } from '../data/models';
import { LedgerForms } from './ledgerForms';

/** What the "New charge" screen shows before the treasurer taps Save. */
export interface ChargePreview {
  charged: Member[];
  skipped: Member[];
  perMemberCentavos: number;
  totalCentavos: number;
}

export const ChargePlanner = {
  /** Members who take the course. A blank courseId means the whole class. */
  eligible(members: Member[], courseId: string): Member[] {
    return courseId ? members.filter((m) => !m.excludedCourseIds.includes(courseId)) : members;
  },

  /**
   * Who gets charged. Starts from eligible, then applies the treasurer's manual overrides:
   * forceInclude adds someone who would have been skipped, forceExclude removes someone.
   */
  preview(
    members: Member[],
    courseId: string,
    perMemberCentavos: number,
    forceInclude: Set<string> = new Set(),
    forceExclude: Set<string> = new Set(),
  ): ChargePreview {
    const chargedIds = new Set(ChargePlanner.eligible(members, courseId).map((m) => m.id));
    forceInclude.forEach((id) => chargedIds.add(id));
    forceExclude.forEach((id) => chargedIds.delete(id));
    const charged = members.filter((m) => chargedIds.has(m.id));
    const skipped = members.filter((m) => !chargedIds.has(m.id));
    return { charged, skipped, perMemberCentavos, totalCentavos: perMemberCentavos * charged.length };
  },

  /** The pay-out that settles a charge: always exactly the charge's total, linked by batchId. */
  buildPayout(batchId: string, totalCentavos: number, note: string, dateMillis: number, paidTo: string): LedgerRecord {
    return newRecord({ type: 'EXPENSE', amountCentavos: totalCentavos, note, dateMillis, settlesBatchId: batchId, paidTo: paidTo.trim() });
  },

  /** True when the charge fits one batch (LedgerForms.MAX_CHARGED students at most). */
  fitsOneBatch(preview: ChargePreview): boolean {
    return preview.charged.length <= LedgerForms.MAX_CHARGED;
  },

  /** One CHARGE record per charged member, all sharing batchId so they can be undone together. */
  buildRecords(preview: ChargePreview, note: string, courseId: string, dateMillis: number, batchId: string): LedgerRecord[] {
    if (!ChargePlanner.fitsOneBatch(preview)) throw new Error(`You can charge up to ${LedgerForms.MAX_CHARGED} students at once.`);
    return preview.charged.map((member) =>
      newRecord({
        type: 'CHARGE',
        amountCentavos: preview.perMemberCentavos,
        memberId: member.id,
        memberName: member.name,
        note,
        dateMillis,
        batchId,
        courseId,
      }),
    );
  },
};
