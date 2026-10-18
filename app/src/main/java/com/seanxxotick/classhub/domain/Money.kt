package com.seanxxotick.classhub.domain

import java.math.BigDecimal
import java.math.RoundingMode
import java.util.Locale

object Money {
    /** 425000 -> "₱4,250.00", -800 -> "-₱8.00" */
    fun format(centavos: Long): String {
        val sign = if (centavos < 0) "-" else ""
        val abs = Math.abs(centavos)
        val pesos = String.format(Locale.US, "%,d", abs / 100)
        val cents = String.format(Locale.US, "%02d", abs % 100)
        return "$sign₱$pesos.$cents"
    }

    /** "100" -> 10000, "1,250.50" -> 125050. Returns null for empty, negative, zero or invalid text. */
    fun parsePesos(input: String): Long? {
        val cleaned = input.trim().replace(",", "")
        if (cleaned.isEmpty()) return null
        val value = cleaned.toBigDecimalOrNull() ?: return null
        if (value.signum() <= 0) return null
        if (value.scale() > 2) return null
        return value.setScale(2, RoundingMode.UNNECESSARY).multiply(BigDecimal(100)).longValueExact()
    }
}
