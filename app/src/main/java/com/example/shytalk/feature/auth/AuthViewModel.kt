package com.example.shytalk.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.shytalk.core.util.Resource
import com.example.shytalk.data.repository.AuthRepository
import com.example.shytalk.data.repository.UserRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class AuthUiState(
    val isLoading: Boolean = false,
    val error: String? = null,
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
