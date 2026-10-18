package com.seanxxotick.classhub.ui.account

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.seanxxotick.classhub.data.repository.PhotoRepository
import com.seanxxotick.classhub.ui.common.friendlyMessage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** The signed-in user's own profile picture. */
class AccountViewModel(
    private val uid: String,
    private val photos: PhotoRepository = PhotoRepository(),
) : ViewModel() {
    val photo: StateFlow<String?> = photos.observeAvatar(uid)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    private val _notice = MutableStateFlow<String?>(null)
    val notice: StateFlow<String?> = _notice.asStateFlow()

    fun setPhoto(photo: String) = run("Profile photo updated.") { photos.setAvatar(uid, photo) }

    fun removePhoto() = run("Profile photo removed.") { photos.removeAvatar(uid) }

    fun showNotice(message: String) {
        _notice.value = message
    }

    fun clearNotice() {
        _notice.value = null
    }

    private fun run(success: String, block: suspend () -> Unit) {
        if (_busy.value) return
        viewModelScope.launch {
            _busy.value = true
            _notice.value = try {
                block()
                success
            } catch (e: Exception) {
                friendlyMessage(e)
            }
            _busy.value = false
        }
    }
}
