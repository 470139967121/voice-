package com.example.shytalk.feature.profile

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.shytalk.core.model.User
import com.example.shytalk.core.util.Resource
import com.example.shytalk.data.repository.AuthRepository
import com.example.shytalk.data.repository.UserRepository
import com.google.firebase.Timestamp
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ProfileUiState(
    val isLoading: Boolean = false,
    val error: String? = null,
    val profileSaved: Boolean = false,
    val user: User? = null
)

@HiltViewModel
class ProfileViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val userRepository: UserRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(ProfileUiState())
    val uiState: StateFlow<ProfileUiState> = _uiState.asStateFlow()

    init {
        loadProfile()
    }

    private fun loadProfile() {
        val userId = authRepository.currentUser?.uid ?: return
        viewModelScope.launch {
            when (val result = userRepository.getUser(userId)) {
                is Resource.Success -> {
                    _uiState.value = _uiState.value.copy(user = result.data)
                }
                is Resource.Error -> { /* User might not exist yet */ }
                is Resource.Loading -> {}
            }
        }
    }

    fun saveProfile(displayName: String) {
        val firebaseUser = authRepository.currentUser ?: return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            val user = User(
                uid = firebaseUser.uid,
                displayName = displayName,
                phoneNumber = firebaseUser.phoneNumber,
                email = firebaseUser.email,
                createdAt = Timestamp.now(),
                lastSeenAt = Timestamp.now()
            )
            when (val result = userRepository.createOrUpdateUser(user)) {
                is Resource.Success -> {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        profileSaved = true,
                        user = user
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

    fun updateDisplayName(displayName: String) {
        val userId = authRepository.currentUser?.uid ?: return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            when (val result = userRepository.updateDisplayName(userId, displayName)) {
                is Resource.Success -> {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        user = _uiState.value.user?.copy(displayName = displayName)
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
}
