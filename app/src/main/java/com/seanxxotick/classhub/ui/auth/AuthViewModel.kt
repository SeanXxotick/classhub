package com.seanxxotick.classhub.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.seanxxotick.classhub.data.model.AppUser
import com.seanxxotick.classhub.data.repository.AuthRepository
import com.seanxxotick.classhub.ui.common.friendlyMessage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

sealed interface Session {
    data object Loading : Session
    data object SignedOut : Session
    data class SignedIn(val user: AppUser) : Session
}

data class AuthUiState(val busy: Boolean = false, val error: String? = null)

class AuthViewModel(private val repo: AuthRepository = AuthRepository()) : ViewModel() {
    val session: StateFlow<Session> = repo.observeUser()
        .map { user -> if (user == null) Session.SignedOut else Session.SignedIn(user) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, Session.Loading)

    private val _ui = MutableStateFlow(AuthUiState())
    val ui: StateFlow<AuthUiState> = _ui.asStateFlow()

    fun signIn(email: String, password: String) {
        if (email.isBlank() || password.isEmpty()) {
            _ui.value = AuthUiState(error = "Enter your email and password.")
            return
        }
        launchAction { repo.signIn(email, password) }
    }

    fun signUp(name: String, email: String, password: String) {
        when {
            name.isBlank() -> _ui.value = AuthUiState(error = "Enter your name so classmates can recognize you.")
            email.isBlank() -> _ui.value = AuthUiState(error = "Enter your email.")
            password.length < 6 -> _ui.value = AuthUiState(error = "Use a password with at least 6 characters.")
            else -> launchAction { repo.signUp(name, email, password) }
        }
    }

    fun signOut() = repo.signOut()

    fun clearError() {
        _ui.value = _ui.value.copy(error = null)
    }

    private fun launchAction(block: suspend () -> Unit) {
        viewModelScope.launch {
            _ui.value = AuthUiState(busy = true)
            _ui.value = try {
                block()
                AuthUiState()
            } catch (e: Exception) {
                AuthUiState(error = friendlyMessage(e))
            }
        }
    }
}
