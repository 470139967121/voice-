package com.shyden.shytalk.feature.profile

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.Timestamp
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.UserRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class RequiredDOBUiState(
    val isLoading: Boolean = false,
    val error: String? = null,
    val saved: Boolean = false
)

@HiltViewModel
class RequiredDOBViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val userRepository: UserRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(RequiredDOBUiState())
    val uiState: StateFlow<RequiredDOBUiState> = _uiState.asStateFlow()

    fun saveDateOfBirth(dateOfBirth: Timestamp) {
        val userId = authRepository.currentUser?.uid ?: return
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            when (userRepository.updateProfile(userId, mapOf("dateOfBirth" to dateOfBirth))) {
                is Resource.Success -> {
                    _uiState.update { it.copy(isLoading = false, saved = true) }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(isLoading = false, error = "Failed to save date of birth") }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}
