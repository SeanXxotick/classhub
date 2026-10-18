package com.seanxxotick.classhub.domain

import com.seanxxotick.classhub.data.model.RecordType

/** Checks the ledger forms before anything is saved. Each function returns an error message, or null when valid. */
object LedgerForms {
    /** ₱1,000,000.00. Anything larger is almost certainly a typo for a class fund. */
    const val MAX_AMOUNT_CENTAVOS = 100_000_000L

    /** Firestore writes up to 500 documents in one batch; one slot is kept for a pay-out saved with the charge. */
    const val MAX_CHARGED = 499

    fun checkAmount(amountCentavos: Long?): String? = when {
        amountCentavos == null -> "Enter an amount greater than zero, with up to 2 decimal places."
        amountCentavos > MAX_AMOUNT_CENTAVOS -> "That amount is too large. The limit is ${Money.format(MAX_AMOUNT_CENTAVOS)}."
        else -> null
    }

    /**
     * Payment and Withdrawal.
     * [memberBalanceCentavos] is the chosen member's current balance (needed for a withdrawal).
     */
    fun checkRecord(
        type: RecordType,
        amountCentavos: Long?,
        memberId: String,
        memberBalanceCentavos: Long?,
    ): String? {
        checkAmount(amountCentavos)?.let { return it }
        val amount = amountCentavos ?: return null
        return when (type) {
            RecordType.PAYMENT -> if (memberId.isBlank()) "Choose who paid." else null
            RecordType.WITHDRAWAL -> when {
                memberId.isBlank() -> "Choose who is withdrawing."
                (memberBalanceCentavos ?: 0L) < amount ->
                    "That is more than this member's balance of ${Money.format(memberBalanceCentavos ?: 0L)}."
                else -> null
            }
            RecordType.EXPENSE -> "Use the Pay out from fund form for pay-outs."
            RecordType.CHARGE -> "Use the Charge students form for charges."
        }
    }

    /**
     * Pay out from fund. Every pay-out settles exactly one charge that has not been paid out yet,
     * for exactly that charge's total.
     */
    fun checkPayout(charge: LedgerEntry.ChargeBatch?, alreadyPaidOut: Boolean): String? = when {
        charge == null -> "Choose the charge this pay-out is for."
        alreadyPaidOut -> "That charge has already been paid out."
        else -> null
    }

    fun checkCharge(perMemberCentavos: Long?, note: String, chargedCount: Int): String? {
        checkAmount(perMemberCentavos)?.let { return it }
        return when {
            note.isBlank() -> "Describe the charge, for example \"Quiz - Operations Research\"."
            chargedCount == 0 -> "Choose at least one student to charge."
            chargedCount > MAX_CHARGED -> "You can charge up to $MAX_CHARGED students at once."
            else -> null
        }
    }
}
