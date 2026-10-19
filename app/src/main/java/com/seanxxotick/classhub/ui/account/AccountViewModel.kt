package com.seanxxotick.classhub.ui.account

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.seanxxotick.classhub.data.repository.AuthRepository
import com.seanxxotick.classhub.data.repository.PhotoRepository
import com.seanxxotick.classhub.domain.NameRules
import com.seanxxotick.classhub.domain.PersonName
import com.seanxxotick.classhub.ui.common.friendlyMessage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** What the delete account dialog shows. */
sealed interface DeleteStep {
    /** Checking whether the user is the Mayor of any class. */
    data object Checking : DeleteStep

    /** The user is the Mayor of these classes and must hand them over first. */
    data class MustHandOver(val classNames: List<String>) : DeleteStep

    /** Ready: asks for the password. [error] is shown under the password box. */
    data class Confirm(val error: String? = null) : DeleteStep
}

/** The signed-in user's own profile: picture, name, and deleting the account. */
class AccountViewModel(
    private val uid: String,
    private val photos: PhotoRepository = PhotoRepository(),
    private val auth: AuthRepository = AuthRepository(),
) : ViewModel() {
    val photo: StateFlow<String?> = photos.observeAvatar(uid)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    private val _notice = MutableStateFlow<String?>(null)
    val notice: StateFlow<String?> = _notice.asStateFlow()

    private val _deleteStep = MutableStateFlow<DeleteStep?>(null)
    val deleteStep: StateFlow<DeleteStep?> = _deleteStep.asStateFlow()

    fun setPhoto(photo: String) = run("Profile photo updated.") { photos.setAvatar(uid, photo) }

    fun removePhoto() = run("Profile photo removed.") { photos.removeAvatar(uid) }

    /** Checks the name first; [onSaved] closes the editor only when it was saved. */
    fun saveName(name: PersonName, onSaved: () -> Unit) {
        NameRules.check(name)?.let {
            _notice.value = it
            return
        }
        run("Name saved. It now shows in all your classes.", onSaved) { auth.updateName(name) }
    }

    /** Opens the delete dialog, first checking that the user is not the Mayor of any class. */
    fun startDelete() {
        _deleteStep.value = DeleteStep.Checking
        viewModelScope.launch {
            _deleteStep.value = try {
                val owned = auth.classesIOwn()
                if (owned.isEmpty()) DeleteStep.Confirm() else DeleteStep.MustHandOver(owned)
            } catch (e: Exception) {
                _notice.value = friendlyMessage(e)
                null
            }
        }
    }

    fun cancelDelete() {
        if (!_busy.value) _deleteStep.value = null
    }

    /** On success the sign-in is gone, so the app returns to the sign-in screen by itself. */
    fun deleteAccount(password: String) {
        if (_busy.value) return
        if (password.isEmpty()) {
            _deleteStep.value = DeleteStep.Confirm("Enter your password.")
            return
        }
        viewModelScope.launch {
            _busy.value = true
            try {
                auth.deleteAccount(password)
                _deleteStep.value = null
            } catch (e: Exception) {
                _deleteStep.value = DeleteStep.Confirm(friendlyMessage(e).replace("The email or password is incorrect.", "That password is incorrect."))
            }
            _busy.value = false
        }
    }

    fun showNotice(message: String) {
        _notice.value = message
    }

    fun clearNotice() {
        _notice.value = null
    }

    private fun run(success: String, onDone: () -> Unit = {}, block: suspend () -> Unit) {
        if (_busy.value) return
        viewModelScope.launch {
            _busy.value = true
            _notice.value = try {
                block()
                onDone()
                success
            } catch (e: Exception) {
                friendlyMessage(e)
            }
            _busy.value = false
        }
    }
}
