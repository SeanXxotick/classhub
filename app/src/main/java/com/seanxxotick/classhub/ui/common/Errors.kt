package com.seanxxotick.classhub.ui.common

import com.google.firebase.FirebaseNetworkException
import com.google.firebase.auth.FirebaseAuthInvalidCredentialsException
import com.google.firebase.auth.FirebaseAuthInvalidUserException
import com.google.firebase.auth.FirebaseAuthUserCollisionException
import com.google.firebase.auth.FirebaseAuthWeakPasswordException
import com.google.firebase.firestore.FirebaseFirestoreException

/** Turns an exception into a sentence a classmate can act on. */
fun friendlyMessage(error: Throwable): String = when (error) {
    // WeakPassword extends InvalidCredentials, so it must come first.
    is FirebaseAuthWeakPasswordException -> "Use a password with at least 6 characters."
    is FirebaseAuthUserCollisionException -> "An account with that email already exists. Try signing in instead."
    is FirebaseAuthInvalidUserException -> "No account was found for that email."
    is FirebaseAuthInvalidCredentialsException -> "The email or password is incorrect."
    is FirebaseNetworkException -> "No internet connection. Check your connection and try again."
    is FirebaseFirestoreException -> when (error.code) {
        FirebaseFirestoreException.Code.PERMISSION_DENIED -> "You do not have permission to do that."
        FirebaseFirestoreException.Code.UNAVAILABLE -> "Cannot reach the server. Check your connection and try again."
        else -> "Something went wrong (${error.code.name}). Please try again."
    }
    else -> error.message?.takeIf { it.isNotBlank() } ?: "Something went wrong. Please try again."
}
