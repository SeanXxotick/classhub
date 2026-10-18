package com.seanxxotick.classhub.domain

import java.net.URI

/**
 * Invite links: https://classhub-975eb.web.app/join/K7M4QX opens ClassHub on the Join screen
 * with the code filled in (Android App Links). The web page at the same address helps people
 * who do not have the app yet. classhub://join/K7M4QX is a fallback that only the app handles.
 */
object JoinLinks {
    const val HOST = "classhub-975eb.web.app"
    const val APP_SCHEME = "classhub"

    fun linkFor(code: String): String = "https://$HOST/join/${InviteCode.normalize(code)}"

    /** The message the Share code button sends. */
    fun shareText(className: String, code: String): String =
        "Join $className on ClassHub: ${linkFor(code)}\n\n" +
            "Or open ClassHub, tap Add a class, then Join with a code, and enter ${InviteCode.normalize(code)}."

    /** The invite code inside a ClassHub join link, or null when the link is not one (or the code is malformed). */
    fun codeFrom(link: String): String? {
        val uri = runCatching { URI(link.trim()) }.getOrNull() ?: return null
        val segments = when (uri.scheme?.lowercase()) {
            "https", "http" -> {
                if (uri.host?.lowercase() != HOST) return null
                uri.path.orEmpty().split('/').filter { it.isNotEmpty() }
            }
            APP_SCHEME -> listOfNotNull(uri.host) + uri.path.orEmpty().split('/').filter { it.isNotEmpty() }
            else -> return null
        }
        if (segments.size != 2 || !segments[0].equals("join", ignoreCase = true)) return null
        return InviteCode.normalize(segments[1]).takeIf { InviteCode.isValid(it) }
    }
}
