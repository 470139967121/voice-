package com.example.shytalk.feature.profile

import android.net.Uri
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.shytalk.core.model.User
import com.example.shytalk.core.util.Resource
import com.example.shytalk.data.repository.AuthRepository
import com.example.shytalk.data.repository.StorageRepository
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
    val user: User? = null,
    val isEditing: Boolean = false,
    val isUploadingPhoto: Boolean = false,
    val isOwnProfile: Boolean = true,
    val isBlockedByTarget: Boolean = false,
    val isBlockedByViewer: Boolean = false,
    val currentUserId: String = ""
)

@HiltViewModel
class ProfileViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val authRepository: AuthRepository,
    private val userRepository: UserRepository,
    private val storageRepository: StorageRepository
) : ViewModel() {

    private val targetUserId: String? = savedStateHandle["userId"]

    private val _uiState = MutableStateFlow(ProfileUiState())
    val uiState: StateFlow<ProfileUiState> = _uiState.asStateFlow()

    init {
        val currentUid = authRepository.currentUser?.uid ?: ""
        _uiState.value = _uiState.value.copy(currentUserId = currentUid)
        loadProfile(targetUserId)
    }

    fun loadProfile(userId: String?) {
        val currentUid = authRepository.currentUser?.uid ?: return
        val profileUserId = if (userId.isNullOrEmpty() || userId == currentUid) currentUid else userId
        val isOwn = profileUserId == currentUid

        _uiState.value = _uiState.value.copy(
            isLoading = true,
            isOwnProfile = isOwn,
            currentUserId = currentUid
        )

        viewModelScope.launch {
            when (val result = userRepository.getUser(profileUserId)) {
                is Resource.Success -> {
                    val user = result.data

                    if (!isOwn) {
                        // Check if target has blocked the viewer
                        val blockedByTarget = user.blockedUserIds.contains(currentUid)
                        // Check if viewer has blocked the target
                        val viewerBlockedTarget = when (val blockedResult = userRepository.getBlockedUserIds(currentUid)) {
                            is Resource.Success -> blockedResult.data.contains(profileUserId)
                            else -> false
                        }
                        _uiState.value = _uiState.value.copy(
                            isLoading = false,
                            user = user,
                            isBlockedByTarget = blockedByTarget,
                            isBlockedByViewer = viewerBlockedTarget
                        )
                    } else {
                        _uiState.value = _uiState.value.copy(
                            isLoading = false,
                            user = user
                        )
                        // Auto-generate uniqueId for existing users who don't have one
                        if (user.uniqueId == 0L) {
                            generateUniqueId(currentUid)
                        }
                    }
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
                    // Generate unique ID for new user
                    generateUniqueId(firebaseUser.uid)
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

    private fun generateUniqueId(userId: String) {
        viewModelScope.launch {
            when (val result = userRepository.generateUniqueId(userId)) {
                is Resource.Success -> {
                    _uiState.value = _uiState.value.copy(
                        user = _uiState.value.user?.copy(uniqueId = result.data)
                    )
                }
                else -> {}
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

    fun saveProfileEdits(displayName: String, description: String, nationality: String?) {
        val userId = authRepository.currentUser?.uid ?: return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            val fields = mutableMapOf<String, Any?>(
                "displayName" to displayName,
                "description" to description
            )
            if (nationality != null) {
                fields["nationality"] = nationality
            }
            when (val result = userRepository.updateProfile(userId, fields)) {
                is Resource.Success -> {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        isEditing = false,
                        user = _uiState.value.user?.copy(
                            displayName = displayName,
                            description = description,
                            nationality = nationality ?: _uiState.value.user?.nationality
                        )
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

    fun uploadProfilePhoto(uri: Uri) {
        val userId = authRepository.currentUser?.uid ?: return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isUploadingPhoto = true)
            when (val result = storageRepository.uploadImage(userId, "profile_photos", uri)) {
                is Resource.Success -> {
                    val url = result.data
                    userRepository.updateProfile(userId, mapOf("profilePhotoUrl" to url))
                    _uiState.value = _uiState.value.copy(
                        isUploadingPhoto = false,
                        user = _uiState.value.user?.copy(profilePhotoUrl = url)
                    )
                }
                is Resource.Error -> {
                    _uiState.value = _uiState.value.copy(
                        isUploadingPhoto = false,
                        error = result.message
                    )
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun uploadCoverPhoto(uri: Uri) {
        val userId = authRepository.currentUser?.uid ?: return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isUploadingPhoto = true)
            when (val result = storageRepository.uploadImage(userId, "cover_photos", uri)) {
                is Resource.Success -> {
                    val url = result.data
                    userRepository.updateProfile(userId, mapOf("coverPhotoUrl" to url))
                    _uiState.value = _uiState.value.copy(
                        isUploadingPhoto = false,
                        user = _uiState.value.user?.copy(coverPhotoUrl = url)
                    )
                }
                is Resource.Error -> {
                    _uiState.value = _uiState.value.copy(
                        isUploadingPhoto = false,
                        error = result.message
                    )
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun toggleEditing() {
        _uiState.value = _uiState.value.copy(isEditing = !_uiState.value.isEditing)
    }

    fun blockUser(targetUserId: String) {
        val userId = authRepository.currentUser?.uid ?: return
        viewModelScope.launch {
            when (userRepository.blockUser(userId, targetUserId)) {
                is Resource.Success -> {
                    _uiState.value = _uiState.value.copy(isBlockedByViewer = true)
                }
                is Resource.Error -> {
                    _uiState.value = _uiState.value.copy(error = "Failed to block user")
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun unblockUser(targetUserId: String) {
        val userId = authRepository.currentUser?.uid ?: return
        viewModelScope.launch {
            when (userRepository.unblockUser(userId, targetUserId)) {
                is Resource.Success -> {
                    _uiState.value = _uiState.value.copy(isBlockedByViewer = false)
                }
                is Resource.Error -> {
                    _uiState.value = _uiState.value.copy(error = "Failed to unblock user")
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }
}
