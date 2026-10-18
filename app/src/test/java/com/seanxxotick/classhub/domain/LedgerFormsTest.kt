package com.seanxxotick.classhub.domain

import com.seanxxotick.classhub.data.model.LedgerRecord
import com.seanxxotick.classhub.data.model.RecordType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class LedgerFormsTest {
    @Test
    fun amount_mustBePresent_andNotHuge() {
        assertNotNull(LedgerForms.checkAmount(null))
        assertNotNull(LedgerForms.checkAmount(LedgerForms.MAX_AMOUNT_CENTAVOS + 1))
        assertNull(LedgerForms.checkAmount(LedgerForms.MAX_AMOUNT_CENTAVOS))
        assertNull(LedgerForms.checkAmount(1))
    }

    @Test
    fun payment_needsAMember() {
        assertEquals("Choose who paid.", LedgerForms.checkRecord(RecordType.PAYMENT, 10_000, "", null))
        assertNull(LedgerForms.checkRecord(RecordType.PAYMENT, 10_000, "ana", 0))
    }

    @Test
    fun withdrawal_cannotExceedTheMembersBalance() {
        assertNotNull(LedgerForms.checkRecord(RecordType.WITHDRAWAL, 5_001, "ana", 5_000))
        assertNull(LedgerForms.checkRecord(RecordType.WITHDRAWAL, 5_000, "ana", 5_000))
        assertNotNull(LedgerForms.checkRecord(RecordType.WITHDRAWAL, 100, "lito", -800))
    }

    @Test
    fun withdrawal_needsAMember() {
        assertEquals("Choose who is withdrawing.", LedgerForms.checkRecord(RecordType.WITHDRAWAL, 100, "", null))
    }

    @Test
    fun payOutsAndCharges_areRejectedByTheGeneralForm() {
        assertNotNull(LedgerForms.checkRecord(RecordType.EXPENSE, 100, "", null))
        assertNotNull(LedgerForms.checkRecord(RecordType.CHARGE, 100, "ana", null))
    }

    @Test
    fun amountErrorsComeFirst() {
        assertEquals(LedgerForms.checkAmount(null), LedgerForms.checkRecord(RecordType.PAYMENT, null, "", null))
    }

    @Test
    fun payout_mustSettleAChargeThatIsNotPaidOutYet() {
        val charge = LedgerEntry.ChargeBatch("b1", listOf(LedgerRecord(type = RecordType.CHARGE, amountCentavos = 600, batchId = "b1")))
        assertNotNull(LedgerForms.checkPayout(null, alreadyPaidOut = false))
        assertNotNull(LedgerForms.checkPayout(charge, alreadyPaidOut = true))
        assertNull(LedgerForms.checkPayout(charge, alreadyPaidOut = false))
    }

    @Test
    fun charge_needsAmountNoteAndAtLeastOneStudent() {
        assertNotNull(LedgerForms.checkCharge(null, "Quiz", 3))
        assertNotNull(LedgerForms.checkCharge(600, " ", 3))
        assertNotNull(LedgerForms.checkCharge(600, "Quiz", 0))
        assertNotNull(LedgerForms.checkCharge(600, "Quiz", LedgerForms.MAX_CHARGED + 1))
        assertNull(LedgerForms.checkCharge(600, "Quiz", 29))
    }

    @Test
    fun chargePlusItsPayout_fitInOneFirestoreBatch() {
        assertEquals(500, LedgerForms.MAX_CHARGED + 1)
    }
}
