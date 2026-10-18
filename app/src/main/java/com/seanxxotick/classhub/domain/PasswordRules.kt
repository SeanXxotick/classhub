package com.seanxxotick.classhub.domain

/** Rules for choosing a password, used on sign-up, the forced first change and in Account. */
object PasswordRules {
    const val MIN_LENGTH = 8

    /**
     * Returns an error message, or null when [password] can be used. [email] is the account's email;
     * its first part (before the @) is not allowed as the password because it is easy to guess.
     */
    fun strength(password: String, email: String): String? {
        val emailName = email.trim().substringBefore('@')
        return when {
            password.length < MIN_LENGTH -> "Use at least $MIN_LENGTH characters."
            password.none { it.isLetter() } -> "Include at least one letter, so it is not just numbers."
            emailName.isNotEmpty() && password.equals(emailName, ignoreCase = true) ->
                "Do not use the first part of your email as your password. It is too easy to guess."
            else -> null
        }
    }

    /** [strength], plus the two typed passwords must match. */
    fun check(password: String, confirm: String, email: String): String? =
        strength(password, email) ?: if (password != confirm) "The two passwords do not match." else null
}
