package com.seanxxotick.classhub.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.auth.FirebaseAuthInvalidCredentialsException
import com.seanxxotick.classhub.data.model.AppUser
import com.seanxxotick.classhub.data.repository.AuthRepository
import com.seanxxotick.classhub.domain.NameRules
import com.seanxxotick.classhub.domain.PasswordRules
import com.seanxxotick.classhub.domain.PersonName
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

/** [notice] is a success message, for example after a reset link is sent. */
data class AuthUiState(val busy: Boolean = false, val error: String? = null, val notice: String? = null)

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

    fun signUp(name: PersonName, email: String, password: String) {
        val nameProblem = NameRules.check(name)
        when {
            nameProblem != null -> _ui.value = AuthUiState(error = nameProblem)
            email.isBlank() -> _ui.value = AuthUiState(error = "Enter your email.")
            else -> PasswordRules.strength(password, email)?.let { _ui.value = AuthUiState(error = it) }
                ?: launchAction { repo.signUp(name, email, password) }
        }
    }

    /** Validates and saves a new password. [onDone] runs after it is saved. */
    fun changePassword(password: String, confirm: String, email: String, onDone: () -> Unit = {}) {
        PasswordRules.check(password, confirm, email)?.let {
            _ui.value = AuthUiState(error = it)
            return
        }
        viewModelScope.launch {
            _ui.value = AuthUiState(busy = true)
            _ui.value = try {
                repo.changePassword(password)
                onDone()
                AuthUiState()
            } catch (e: Exception) {
                AuthUiState(error = friendlyMessage(e))
            }
        }
    }

    /** Emails a reset link. The message is the same whether or not the email has an account. */
    fun sendPasswordReset(email: String) {
        if (email.isBlank()) {
            _ui.value = AuthUiState(error = "Enter the email you use to sign in.")
            return
        }
        viewModelScope.launch {
            _ui.value = AuthUiState(busy = true)
            _ui.value = try {
                repo.sendPasswordReset(email)
                AuthUiState(notice = "If an account exists for ${email.trim()}, a reset link is on its way. Check your inbox and your junk or spam folder.")
            } catch (_: FirebaseAuthInvalidCredentialsException) {
                AuthUiState(error = "That email does not look right. Check it and try again.")
            } catch (e: Exception) {
                AuthUiState(error = friendlyMessage(e))
            }
        }
    }

    fun signOut() = repo.signOut()

    /** Clears both the error and the success notice. */
    fun clearError() {
        _ui.value = _ui.value.copy(error = null, notice = null)
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
