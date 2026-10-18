package com.seanxxotick.classhub.ui.classes

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.seanxxotick.classhub.data.model.ClassMembership
import com.seanxxotick.classhub.data.repository.ClassRepository
import com.seanxxotick.classhub.data.repository.PhotoRepository
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import com.seanxxotick.classhub.domain.InviteCode
import com.seanxxotick.classhub.ui.common.friendlyMessage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class ClassActionState(val busy: Boolean = false, val error: String? = null)

/** "My classes", plus creating and joining a class. One instance per signed-in user. */
class ClassesViewModel(
    private val uid: String,
    private val repo: ClassRepository = ClassRepository(),
    private val photos: PhotoRepository = PhotoRepository(),
) : ViewModel() {
    private val _action = MutableStateFlow(ClassActionState())
    val action: StateFlow<ClassActionState> = _action.asStateFlow()

    /** Null while loading. */
    val classes: StateFlow<List<ClassMembership>?> = repo.observeMyClasses(uid)
        .map<List<ClassMembership>, List<ClassMembership>?> { it }
        .catch { error ->
            _action.value = ClassActionState(error = friendlyMessage(error))
            emit(emptyList())
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** Class pictures for the "My classes" list, as classId to photo. */
    @OptIn(ExperimentalCoroutinesApi::class)
    val classPhotos: StateFlow<Map<String, String>> = classes
        .map { list -> list.orEmpty().map { it.classId }.sorted() }
        .distinctUntilChanged()
        .flatMapLatest { ids -> photos.observeClassPhotos(ids) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyMap())

    fun createClass(name: String, description: String, accent: String, ownerName: String, onCreated: (String) -> Unit) {
        val trimmed = name.trim()
        when {
            trimmed.isEmpty() -> _action.value = ClassActionState(error = "Give the class a name.")
            trimmed.length > MAX_NAME -> _action.value = ClassActionState(error = "Keep the class name under $MAX_NAME characters.")
            else -> launchAction {
                val classId = repo.createClass(trimmed, description, accent, uid, ownerName)
                onCreated(classId)
            }
        }
    }

    fun joinClass(rawCode: String, displayName: String, onJoined: (String) -> Unit) {
        val code = InviteCode.normalize(rawCode)
        if (!InviteCode.isValid(code)) {
            _action.value = ClassActionState(error = "Invite codes have ${InviteCode.LENGTH} letters and numbers.")
            return
        }
        launchAction {
            val classId = repo.joinClass(code, uid, displayName)
            onJoined(classId)
        }
    }

    fun clearError() {
        _action.value = _action.value.copy(error = null)
    }

    private fun launchAction(block: suspend () -> Unit) {
        viewModelScope.launch {
            _action.value = ClassActionState(busy = true)
            _action.value = try {
                block()
                ClassActionState()
            } catch (e: Exception) {
                ClassActionState(error = friendlyMessage(e))
            }
        }
    }

    private companion object {
        const val MAX_NAME = 40
    }
}
