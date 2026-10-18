package com.seanxxotick.classhub.domain

import java.util.Random

/** Six-character class invite codes. No 0/O or 1/I so a code is easy to read aloud and type. */
object InviteCode {
    const val LENGTH = 6
    private const val ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

    /** Pass a SecureRandom in the app; tests pass a seeded Random. */
    fun generate(random: Random): String = buildString {
        repeat(LENGTH) { append(ALPHABET[random.nextInt(ALPHABET.length)]) }
    }

    /** Forgives lowercase, spaces and dashes: " k7m-4qx " -> "K7M4QX". */
    fun normalize(input: String): String =
        input.trim().uppercase().replace(" ", "").replace("-", "")

    fun isValid(code: String): Boolean = code.length == LENGTH && code.all { it in ALPHABET }
}
