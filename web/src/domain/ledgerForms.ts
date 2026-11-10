import type { RecordType } from '../data/models';
import type { ChargeBatch } from './ledgerView';
import { formatMoney } from './money';

/** Checks the ledger forms before anything is saved. Each function returns an error message, or null when valid. */
export const LedgerForms = {
  /** ₱1,000,000.00. Anything larger is almost certainly a typo for a class fund. */
  MAX_AMOUNT_CENTAVOS: 100_000_000,

  /** Firestore writes up to 500 documents in one batch; one slot is kept for a pay-out saved with the charge. */
  MAX_CHARGED: 499,

  checkAmount(amountCentavos: number | null): string | null {
    if (amountCentavos === null) return 'Enter an amount greater than zero, with up to 2 decimal places.';
    if (amountCentavos > LedgerForms.MAX_AMOUNT_CENTAVOS) {
      return `That amount is too large. The limit is ${formatMoney(LedgerForms.MAX_AMOUNT_CENTAVOS)}.`;
    }
    return null;
  },

  /**
   * Payment and Withdrawal. Balances are not limited: a withdrawal may be larger than the student's balance,
   * which simply leaves them owing the class.
   */
  checkRecord(type: RecordType, amountCentavos: number | null, memberId: string): string | null {
    const amountError = LedgerForms.checkAmount(amountCentavos);
    if (amountError) return amountError;
    switch (type) {
      case 'PAYMENT':
        return memberId.trim() ? null : 'Choose who paid.';
      case 'WITHDRAWAL':
        return memberId.trim() ? null : 'Choose who is withdrawing.';
      case 'EXPENSE':
        return 'Use the Pay out from fund form for pay-outs.';
      case 'CHARGE':
        return 'Use the Charge students form for charges.';
      case 'OPENING':
        return 'Use the Opening balance form for opening balances.';
    }
  },

  /** Pay out from fund. Every pay-out settles exactly one charge that has not been paid out yet, for its total. */
  checkPayout(charge: ChargeBatch | null, alreadyPaidOut: boolean): string | null {
    if (!charge) return 'Choose the charge this pay-out is for.';
    if (alreadyPaidOut) return 'That charge has already been paid out.';
    return null;
  },

  checkCharge(perMemberCentavos: number | null, note: string, chargedCount: number): string | null {
    const amountError = LedgerForms.checkAmount(perMemberCentavos);
    if (amountError) return amountError;
    if (!note.trim()) return 'Describe the charge, for example "Quiz - Operations Research".';
    if (chargedCount === 0) return 'Choose at least one student to charge.';
    if (chargedCount > LedgerForms.MAX_CHARGED) return `You can charge up to ${LedgerForms.MAX_CHARGED} students at once.`;
    return null;
  },
};
