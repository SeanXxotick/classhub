package com.seanxxotick.classhub.ui.common

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.seanxxotick.classhub.domain.ImageMath
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream

/** Decoded pictures, so scrolling a list does not decode the same photo again and again. */
private object PhotoCache {
    private val cache = object : android.util.LruCache<String, ImageBitmap>(64) {}

    fun get(photo: String): ImageBitmap? = cache.get(photo.hashCode().toString() + photo.length)

    fun put(photo: String, image: ImageBitmap) {
        cache.put(photo.hashCode().toString() + photo.length, image)
    }
}

private fun decode(photo: String): ImageBitmap? = runCatching {
    val bytes = Base64.decode(photo, Base64.DEFAULT)
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
}.getOrNull()

/**
 * A profile or class picture. Shows the stored photo when there is one, otherwise the colored
 * initials used everywhere else. [circle] is false for class pictures (rounded square).
 */
@Composable
fun Avatar(photo: String?, name: String, color: Color, size: Dp = 42.dp, circle: Boolean = true, modifier: Modifier = Modifier) {
    val image by produceState<ImageBitmap?>(initialValue = photo?.let { PhotoCache.get(it) }, photo) {
        value = if (photo.isNullOrEmpty()) null else PhotoCache.get(photo) ?: withContext(Dispatchers.Default) {
            decode(photo)?.also { PhotoCache.put(photo, it) }
        }
    }
    val current = image
    if (current != null) {
        Image(
            bitmap = current,
            contentDescription = name,
            contentScale = ContentScale.Crop,
            modifier = modifier.size(size).clip(if (circle) CircleShape else RoundedCornerShape(size * 0.33f)),
        )
    } else {
        Initials(initialsOf(name), color, modifier = modifier, circle = circle, size = size)
    }
}

/**
 * Turns a picked image into a small square JPEG as Base64 text: decodes it small, fixes its rotation,
 * crops the centered square and scales it to [ImageMath.PHOTO_SIZE]. Runs off the main thread.
 */
suspend fun preparePhoto(context: Context, uri: Uri): String = withContext(Dispatchers.IO) {
    val resolver = context.contentResolver
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    resolver.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, bounds) }
    require(bounds.outWidth > 0 && bounds.outHeight > 0) { "That file is not a picture ClassHub can read." }

    val options = BitmapFactory.Options().apply { inSampleSize = ImageMath.sampleSize(bounds.outWidth, bounds.outHeight) }
    val decoded = resolver.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, options) }
        ?: throw IllegalArgumentException("That file is not a picture ClassHub can read.")

    // Phone cameras often save photos sideways and record the turn in the EXIF data.
    val degrees = runCatching {
        resolver.openInputStream(uri).use { stream ->
            when (ExifInterface(stream!!).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                else -> 0f
            }
        }
    }.getOrDefault(0f)
    val upright = if (degrees == 0f) decoded else Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, Matrix().apply { postRotate(degrees) }, true)

    val crop = ImageMath.centerSquare(upright.width, upright.height)
    val square = Bitmap.createBitmap(upright, crop.left, crop.top, crop.size, crop.size)
    val small = Bitmap.createScaledBitmap(square, ImageMath.PHOTO_SIZE, ImageMath.PHOTO_SIZE, true)

    val out = ByteArrayOutputStream()
    small.compress(Bitmap.CompressFormat.JPEG, 82, out)
    Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
}

/**
 * Opens the phone's photo picker (no storage permission needed) and returns the prepared photo.
 * Call the returned function to open the picker.
 */
@Composable
fun rememberPhotoPicker(onPicked: (String) -> Unit, onError: (String) -> Unit): () -> Unit {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri: Uri? ->
        if (uri != null) {
            scope.launch {
                runCatching { preparePhoto(context, uri) }
                    .onSuccess(onPicked)
                    .onFailure { onError(it.message ?: "That picture could not be used. Try another one.") }
            }
        }
    }
    return { launcher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }
}
