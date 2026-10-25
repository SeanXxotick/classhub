package com.seanxxotick.classhub.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppUpdateTest {
    private val release = AppRelease(versionCode = 6, versionName = "1.3.2", downloadUrl = "https://drive.google.com/uc?id=x")

    @Test fun noRelease_noNotice() = assertNull(UpdateRules.check(5, null))

    @Test fun sameVersion_noNotice() = assertNull(UpdateRules.check(6, release))

    @Test fun newerThanPublished_noNotice() = assertNull(UpdateRules.check(7, release))

    @Test fun olderVersion_isAvailable() = assertEquals(UpdateNotice.Available(release), UpdateRules.check(5, release))

    @Test fun belowTheMinimum_isRequired() =
        assertTrue(UpdateRules.check(4, release.copy(minVersionCode = 5)) is UpdateNotice.Required)

    @Test fun atTheMinimum_isOnlyAvailable() =
        assertTrue(UpdateRules.check(5, release.copy(minVersionCode = 5)) is UpdateNotice.Available)

    @Test fun linkThatIsNotHttps_noNotice() {
        assertNull(UpdateRules.check(5, release.copy(downloadUrl = "http://example.com/a.apk")))
        assertNull(UpdateRules.check(5, release.copy(downloadUrl = "")))
    }
}
