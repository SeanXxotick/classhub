package com.seanxxotick.classhub.domain

import org.junit.Assert.assertEquals
import org.junit.Test

class ImageMathTest {
    @Test
    fun centerSquare_cropsTheMiddleOfAWidePhoto() {
        assertEquals(CropRect(left = 420, top = 0, size = 3000), ImageMath.centerSquare(3840, 3000))
    }

    @Test
    fun centerSquare_cropsTheMiddleOfATallPhoto() {
        assertEquals(CropRect(left = 0, top = 500, size = 1080), ImageMath.centerSquare(1080, 2080))
    }

    @Test
    fun centerSquare_keepsASquarePhotoWhole() {
        assertEquals(CropRect(0, 0, 512), ImageMath.centerSquare(512, 512))
    }

    @Test
    fun sampleSize_shrinksBigPhotos_butNeverBelowTheTarget() {
        assertEquals(8, ImageMath.sampleSize(4000, 3000))
        assertEquals(1, ImageMath.sampleSize(300, 300))
        assertEquals(1, ImageMath.sampleSize(200, 200))
        assertEquals(2, ImageMath.sampleSize(1024, 512))
    }

    @Test(expected = IllegalArgumentException::class)
    fun centerSquare_rejectsAnEmptyImage() {
        ImageMath.centerSquare(0, 100)
    }
}
