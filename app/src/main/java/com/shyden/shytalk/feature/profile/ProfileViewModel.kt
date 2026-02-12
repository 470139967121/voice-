package com.shyden.shytalk.feature.profile

import android.content.Context
import android.net.Uri
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.StorageRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.google.firebase.Timestamp
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
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
    @ApplicationContext private val context: Context,
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
    }

    fun loadProfile(userId: String?) {
        val currentUid = authRepository.currentUser?.uid ?: return
        val profileUserId = if (userId.isNullOrEmpty() || userId == currentUid) currentUid else userId
        val isOwn = profileUserId == currentUid

        val alreadyHasData = _uiState.value.user != null
        _uiState.value = _uiState.value.copy(
            isLoading = !alreadyHasData,
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
                is Resource.Error -> {
                    _uiState.value = _uiState.value.copy(
                        error = result.message ?: "Failed to generate unique ID"
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
        val oldUrl = _uiState.value.user?.profilePhotoUrl
        uploadPhoto(uri, "profile_photos", "profilePhotoUrl", oldUrl) { url ->
            _uiState.value.user?.copy(profilePhotoUrl = url)
        }
    }

    fun uploadCoverPhoto(uri: Uri) {
        val oldUrl = _uiState.value.user?.coverPhotoUrl
        uploadPhoto(uri, "cover_photos", "coverPhotoUrl", oldUrl) { url ->
            _uiState.value.user?.copy(coverPhotoUrl = url)
        }
    }

    private fun uploadPhoto(
        uri: Uri,
        folder: String,
        profileField: String,
        oldUrl: String?,
        updateUser: (String) -> User?
    ) {
        val userId = authRepository.currentUser?.uid ?: return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isUploadingPhoto = true)
            val imageData = try {
                context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
            } catch (e: Exception) {
                null
            }
            if (imageData == null) {
                _uiState.value = _uiState.value.copy(
                    isUploadingPhoto = false,
                    error = "Failed to read image"
                )
                return@launch
            }
            when (val result = storageRepository.uploadImage(userId, folder, imageData)) {
                is Resource.Success -> {
                    val url = result.data
                    when (val saveResult = userRepository.updateProfile(userId, mapOf(profileField to url))) {
                        is Resource.Success -> {
                            _uiState.value = _uiState.value.copy(
                                isUploadingPhoto = false,
                                user = updateUser(url)
                            )
                            // Delete old photo from Firebase Storage
                            if (!oldUrl.isNullOrEmpty()) {
                                storageRepository.deleteImageByUrl(oldUrl)
                            }
                        }
                        is Resource.Error -> {
                            _uiState.value = _uiState.value.copy(
                                isUploadingPhoto = false,
                                error = saveResult.message ?: "Failed to save photo URL"
                            )
                        }
                        is Resource.Loading -> {}
                    }
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
