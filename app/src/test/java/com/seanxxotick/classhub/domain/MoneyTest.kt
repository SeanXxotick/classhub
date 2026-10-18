package com.seanxxotick.classhub.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MoneyTest {
    @Test
    fun format_addsPesoSignThousandsSeparatorAndTwoDecimals() {
        assertEquals("₱4,250.00", Money.format(425_000))
        assertEquals("₱0.05", Money.format(5))
        assertEquals("₱0.00", Money.format(0))
        assertEquals("₱1,234,567.89", Money.format(123_456_789))
    }

    @Test
    fun format_negativeAmountsPutTheSignFirst() {
        assertEquals("-₱8.00", Money.format(-800))
        assertEquals("-₱0.50", Money.format(-50))
    }

    @Test
    fun parsePesos_acceptsWholeAndDecimalAmounts() {
        assertEquals(10_000L, Money.parsePesos("100"))
        assertEquals(125_050L, Money.parsePesos("1,250.50"))
        assertEquals(5L, Money.parsePesos("0.05"))
        assertEquals(10_000L, Money.parsePesos("  100.00 "))
    }

    @Test
    fun parsePesos_rejectsBadInput() {
        assertNull(Money.parsePesos(""))
        assertNull(Money.parsePesos("abc"))
        assertNull(Money.parsePesos("0"))
        assertNull(Money.parsePesos("-5"))
        assertNull(Money.parsePesos("1.234"))
    }
}
