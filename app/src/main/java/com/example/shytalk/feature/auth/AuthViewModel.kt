package com.example.shytalk.feature.auth

import android.app.Activity
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.shytalk.core.model.User
import com.example.shytalk.core.util.Resource
import com.example.shytalk.data.repository.AuthRepository
import com.example.shytalk.data.repository.UserRepository
import com.google.firebase.FirebaseException
import com.google.firebase.auth.PhoneAuthCredential
import com.google.firebase.auth.PhoneAuthProvider
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class AuthUiState(
    val isLoading: Boolean = false,
    val error: String? = null,
    val verificationId: String? = null,
    val codeSent: Boolean = false,
    val isAuthenticated: Boolean = false,
    val hasProfile: Boolean = false
)

@HiltViewModel
class AuthViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val userRepository: UserRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(AuthUiState())
    val uiState: StateFlow<AuthUiState> = _uiState.asStateFlow()

    init {
        checkAuthState()
    }

    private fun checkAuthState() {
        if (authRepository.isAuthenticated) {
            viewModelScope.launch {
                val userId = authRepository.currentUser?.uid ?: return@launch
                when (val result = userRepository.userExists(userId)) {
                    is Resource.Success -> {
                        _uiState.value = _uiState.value.copy(
                            isAuthenticated = true,
                            hasProfile = result.data
                        )
                    }
                    is Resource.Error -> {
                        _uiState.value = _uiState.value.copy(
                            isAuthenticated = true,
                            hasProfile = false
                        )
                    }
                    is Resource.Loading -> {}
                }
            }
        }
    }

    fun sendVerificationCode(phoneNumber: String, activity: Activity) {
        _uiState.value = _uiState.value.copy(isLoading = true, error = null)

        authRepository.sendVerificationCode(
            phoneNumber = phoneNumber,
            activity = activity,
            callbacks = object : PhoneAuthProvider.OnVerificationStateChangedCallbacks() {
                override fun onVerificationCompleted(credential: PhoneAuthCredential) {
                    signInWithPhoneCredential(credential)
                }

                override fun onVerificationFailed(e: FirebaseException) {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = e.message ?: "Verification failed"
                    )
                }

                override fun onCodeSent(
                    verificationId: String,
                    token: PhoneAuthProvider.ForceResendingToken
                ) {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        verificationId = verificationId,
                        codeSent = true
                    )
                }
            }
        )
    }

    fun verifyCode(code: String) {
        val verificationId = _uiState.value.verificationId ?: return
        val credential = PhoneAuthProvider.getCredential(verificationId, code)
        signInWithPhoneCredential(credential)
    }

    private fun signInWithPhoneCredential(credential: PhoneAuthCredential) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            when (val result = authRepository.signInWithPhoneCredential(credential)) {
                is Resource.Success -> {
                    val user = result.data
                    val exists = userRepository.userExists(user.uid)
                    val hasProfile = exists is Resource.Success && exists.data
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        isAuthenticated = true,
                        hasProfile = hasProfile
                    )
                }
                is Resource.Error -> {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = result.message
                    )
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun signInWithGoogle(idToken: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            when (val result = authRepository.signInWithGoogleIdToken(idToken)) {
                is Resource.Success -> {
                    val user = result.data
                    val exists = userRepository.userExists(user.uid)
                    val hasProfile = exists is Resource.Success && exists.data
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        isAuthenticated = true,
                        hasProfile = hasProfile
                    )
                }
                is Resource.Error -> {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = result.message
                    )
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }

    fun signOut() {
        authRepository.signOut()
        _uiState.value = AuthUiState()
    }
}
