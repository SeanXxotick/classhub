package com.seanxxotick.classhub.domain

/** A person's name as the account screen edits it. [middleInitial] is one or two letters, or empty. */
data class PersonName(val first: String = "", val middleInitial: String = "", val last: String = "")

/** Building, splitting and checking names. Shown as "Juan D. Dela Cruz" everywhere in the app. */
object NameRules {
    const val MAX_PART_LENGTH = 40

    const val MAX_INITIAL_LETTERS = 2

    /**
     * "Juan", "d", "Santos" becomes "Juan D. Santos", and a two-letter initial such as "DC" (for a middle
     * name like Dela Cruz) becomes "Juan D.C. Santos". Without a middle initial, "Juan Santos".
     */
    fun display(name: PersonName): String {
        val initial = cleanInitial(name.middleInitial).takeIf { it.isNotEmpty() }?.map { "$it." }?.joinToString("")
        return listOfNotNull(tidy(name.first), initial, tidy(name.last)).filter { it.isNotEmpty() }.joinToString(" ")
    }

    /**
     * A best guess at the parts of a name saved as one line, for accounts made before names had parts.
     * Words before an initial ("D." or "D.C.") are the first name and words after it the last name.
     * Without an initial, the last word is taken as the last name, which the student can correct.
     */
    fun split(displayName: String): PersonName {
        val words = tidy(displayName).split(' ').filter { it.isNotEmpty() }
        val initialAt = words.indexOfFirst { INITIAL.matches(it) }
        return when {
            words.isEmpty() -> PersonName()
            initialAt in 1 until words.lastIndex -> PersonName(
                first = words.take(initialAt).joinToString(" "),
                middleInitial = cleanInitial(words[initialAt]),
                last = words.drop(initialAt + 1).joinToString(" "),
            )
            words.size == 1 -> PersonName(first = words[0])
            else -> PersonName(first = words.dropLast(1).joinToString(" "), last = words.last())
        }
    }

    /** Returns what to fix, or null when the name can be saved. */
    fun check(name: PersonName): String? = when {
        tidy(name.first).isEmpty() -> "Enter your first name."
        tidy(name.last).isEmpty() -> "Enter your last name."
        tidy(name.first).length > MAX_PART_LENGTH || tidy(name.last).length > MAX_PART_LENGTH ->
            "Names can be at most $MAX_PART_LENGTH characters."
        name.middleInitial.isNotBlank() && cleanInitial(name.middleInitial).isEmpty() -> "The middle initial must be letters only."
        else -> null
    }

    /** The cleaned parts to save: single spaces, and the initial as one or two capital letters. */
    fun cleaned(name: PersonName): PersonName =
        PersonName(tidy(name.first), cleanInitial(name.middleInitial), tidy(name.last))

    /** Keeps the first two letters typed into the middle initial box, capitalized ("d.c." becomes "DC"). */
    fun cleanInitial(text: String): String = text.filter { it.isLetter() }.take(MAX_INITIAL_LETTERS).uppercase()

    private fun tidy(text: String): String = text.trim().replace(Regex("\\s+"), " ")

    // "D.", "D.C." or "DC."
    private val INITIAL = Regex("\\p{L}\\.(\\p{L}\\.)?|\\p{L}{2}\\.")
}
