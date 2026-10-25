package com.seanxxotick.classhub.domain

/** The newest published build, read from the `appConfig/latest` document. */
data class AppRelease(
    val versionCode: Int = 0,
    val versionName: String = "",
    val notes: String = "",
    val downloadUrl: String = "",
    /** Installed builds older than this must update before using the app. 0 means no one is forced. */
    val minVersionCode: Int = 0,
)

sealed interface UpdateNotice {
    val release: AppRelease

    /** A newer build exists; the student may postpone. */
    data class Available(override val release: AppRelease) : UpdateNotice

    /** The installed build is too old to keep working; the student must update. */
    data class Required(override val release: AppRelease) : UpdateNotice
}

object UpdateRules {
    /** What to tell a student running [installedCode], or null when nothing needs saying. */
    fun check(installedCode: Int, release: AppRelease?): UpdateNotice? {
        // Without a safe link there is nothing the student could do about a notice.
        if (release == null || !release.downloadUrl.startsWith("https://")) return null
        return when {
            installedCode < release.minVersionCode -> UpdateNotice.Required(release)
            installedCode < release.versionCode -> UpdateNotice.Available(release)
            else -> null
        }
    }
}
