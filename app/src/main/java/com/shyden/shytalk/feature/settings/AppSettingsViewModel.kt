package com.shyden.shytalk.feature.settings

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.firestore.FirebaseFirestore
import com.shyden.shytalk.BuildConfig
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.UserRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeout
import javax.inject.Inject

sealed class UpdateCheckResult {
    data object UpToDate : UpdateCheckResult()
    data class UpdateAvailable(val versionName: String) : UpdateCheckResult()
    data class Error(val message: String) : UpdateCheckResult()
}

data class AppSettingsUiState(
    val isLoading: Boolean = true,
    val error: String? = null,
    val user: User? = null,
    val blockedUsers: List<User> = emptyList(),
    val hideFollowing: Boolean = false,
    val hideOnlineStatus: Boolean = false,
    val hideAge: Boolean = false,
    val cacheCleared: Boolean = false,
    val updateCheckResult: UpdateCheckResult? = null,
    val isCheckingUpdate: Boolean = false
)

@HiltViewModel
class AppSettingsViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val authRepository: AuthRepository,
    private val userRepository: UserRepository,
    private val firestore: FirebaseFirestore
) : ViewModel() {

    private val _uiState = MutableStateFlow(AppSettingsUiState())
    val uiState: StateFlow<AppSettingsUiState> = _uiState.asStateFlow()

    private val currentUserId: String = authRepository.currentUser?.uid ?: ""

    init {
        loadSettings()
    }

    private fun loadSettings() {
        if (currentUserId.isEmpty()) return
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            when (val result = userRepository.getUser(currentUserId)) {
                is Resource.Success -> {
                    val user = result.data
                    val blockedUsers = if (user.blockedUserIds.isNotEmpty()) {
                        (userRepository.getUsers(user.blockedUserIds.toList()) as? Resource.Success)?.data
                            ?: emptyList()
                    } else emptyList()

                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            user = user,
                            blockedUsers = blockedUsers,
                            hideFollowing = user.hideFollowing,
                            hideOnlineStatus = user.hideOnlineStatus,
                            hideAge = user.hideAge
                        )
                    }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(isLoading = false, error = result.message) }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun unblockUser(targetUserId: String) {
        viewModelScope.launch {
            when (userRepository.unblockUser(currentUserId, targetUserId)) {
                is Resource.Success -> {
                    _uiState.update {
                        it.copy(
                            blockedUsers = it.blockedUsers.filter { u -> u.uid != targetUserId },
                            user = it.user?.copy(
                                blockedUserIds = it.user.blockedUserIds - targetUserId
                            )
                        )
                    }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(error = "Failed to unblock user") }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun toggleHideFollowing() = togglePrivacySetting(
        key = "hideFollowing",
        currentValue = _uiState.value.hideFollowing,
        applyOptimistic = { value -> _uiState.update { it.copy(hideFollowing = value) } }
    )

    fun toggleHideOnlineStatus() = togglePrivacySetting(
        key = "hideOnlineStatus",
        currentValue = _uiState.value.hideOnlineStatus,
        applyOptimistic = { value -> _uiState.update { it.copy(hideOnlineStatus = value) } }
    )

    fun toggleHideAge() = togglePrivacySetting(
        key = "hideAge",
        currentValue = _uiState.value.hideAge,
        applyOptimistic = { value -> _uiState.update { it.copy(hideAge = value) } }
    )

    private fun togglePrivacySetting(
        key: String,
        currentValue: Boolean,
        applyOptimistic: (Boolean) -> Unit
    ) {
        val newValue = !currentValue
        applyOptimistic(newValue)
        viewModelScope.launch {
            when (userRepository.updateProfile(currentUserId, mapOf(key to newValue))) {
                is Resource.Success -> {}
                is Resource.Error -> {
                    applyOptimistic(currentValue)
                    _uiState.update { it.copy(error = "Failed to update privacy setting") }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun clearCache() {
        context.cacheDir.listFiles()?.forEach { file -> file.deleteRecursively() }
        _uiState.update { it.copy(cacheCleared = true) }
    }

    fun resetCacheCleared() {
        _uiState.update { it.copy(cacheCleared = false) }
    }

    fun checkForUpdates() {
        viewModelScope.launch {
            _uiState.update { it.copy(isCheckingUpdate = true, updateCheckResult = null) }
            try {
                val doc = withTimeout(10_000L) {
                    firestore.collection("config").document("app").get().await()
                }
                val latestVersionCode = (doc.getLong("latestVersionCode") ?: 0).toInt()
                val latestVersionName = doc.getString("latestVersionName") ?: ""

                val result = if (BuildConfig.VERSION_CODE >= latestVersionCode) {
                    UpdateCheckResult.UpToDate
                } else {
                    UpdateCheckResult.UpdateAvailable(latestVersionName)
                }
                _uiState.update { it.copy(isCheckingUpdate = false, updateCheckResult = result) }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isCheckingUpdate = false,
                        updateCheckResult = UpdateCheckResult.Error("Failed to check for updates")
                    )
                }
            }
        }
    }

    fun dismissUpdateResult() {
        _uiState.update { it.copy(updateCheckResult = null) }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}
