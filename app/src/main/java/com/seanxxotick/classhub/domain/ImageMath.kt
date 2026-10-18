package com.seanxxotick.classhub.domain

/** A rectangle inside an image, in pixels. */
data class CropRect(val left: Int, val top: Int, val size: Int)

/** Pure math for turning any photo into a small square profile picture. */
object ImageMath {
    /** Profile and class pictures are stored as this many pixels square. */
    const val PHOTO_SIZE = 256

    /** The largest square centered in a [width] x [height] image. */
    fun centerSquare(width: Int, height: Int): CropRect {
        require(width > 0 && height > 0) { "Image has no size" }
        val size = minOf(width, height)
        return CropRect(left = (width - size) / 2, top = (height - size) / 2, size = size)
    }

    /**
     * The biggest power-of-two step that still leaves the shorter side at least [target] pixels,
     * so a large camera photo is decoded small instead of filling the phone's memory.
     */
    fun sampleSize(width: Int, height: Int, target: Int = PHOTO_SIZE): Int {
        var sample = 1
        val shorter = minOf(width, height)
        while (shorter / (sample * 2) >= target) sample *= 2
        return sample
    }
}
