package com.shyden.shytalk.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.DeviceRepository
import com.shyden.shytalk.data.repository.UserRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Named

data class AuthUiState(
    val isLoading: Boolean = false,
    val error: String? = null,
    val isAuthenticated: Boolean = false,
    val hasProfile: Boolean = false,
    val isDeviceLocked: Boolean = false
)

@HiltViewModel
class AuthViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val userRepository: UserRepository,
    private val deviceRepository: DeviceRepository,
    @param:Named("deviceId") private val deviceId: String
) : ViewModel() {

    private val _uiState = MutableStateFlow(AuthUiState())
    val uiState: StateFlow<AuthUiState> = _uiState.asStateFlow()

    init {
        checkAuthState()
    }

    private fun checkAuthState() {
        if (!authRepository.isAuthenticated) {
            return
        }

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true)
            val userId = authRepository.currentUser?.uid
            if (userId == null) {
                _uiState.value = _uiState.value.copy(isLoading = false)
                return@launch
            }

            when (val binding = deviceRepository.getDeviceBinding(deviceId)) {
                is Resource.Success -> {
                    val boundUserId = binding.data
                    if (boundUserId != null && boundUserId != userId) {
                        authRepository.signOut()
                        _uiState.value = _uiState.value.copy(
                            isLoading = false,
                            isDeviceLocked = true
                        )
                        return@launch
                    }
                    if (boundUserId == null) {
                        deviceRepository.bindDevice(deviceId, userId)
                    }
                }
                is Resource.Error -> {
                    // Lenient: let user through on network failure
                }
                is Resource.Loading -> {}
            }

            when (val result = userRepository.userExists(userId)) {
                is Resource.Success -> {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        isAuthenticated = true,
                        hasProfile = result.data
                    )
                }
                is Resource.Error -> {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        isAuthenticated = true,
                        hasProfile = false
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

                    when (val binding = deviceRepository.getDeviceBinding(deviceId)) {
                        is Resource.Success -> {
                            val boundUserId = binding.data
                            if (boundUserId != null && boundUserId != user.uid) {
                                authRepository.signOut()
                                _uiState.value = _uiState.value.copy(
                                    isLoading = false,
                                    isDeviceLocked = true
                                )
                                return@launch
                            }
                            if (boundUserId == null) {
                                deviceRepository.bindDevice(deviceId, user.uid)
                            }
                        }
                        is Resource.Error -> {
                            // Lenient: let user through on network failure
                        }
                        is Resource.Loading -> {}
                    }

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

    fun clearDeviceLocked() {
        _uiState.value = _uiState.value.copy(isDeviceLocked = false)
    }

    fun signOut() {
        authRepository.signOut()
        _uiState.value = AuthUiState()
    }
}
