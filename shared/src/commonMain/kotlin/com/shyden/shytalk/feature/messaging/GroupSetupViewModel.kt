package com.shyden.shytalk.feature.messaging

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.GroupPermissions
import com.shyden.shytalk.core.model.GroupRole
import com.shyden.shytalk.core.model.SystemMessageConfig
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.compressImage
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.PrivateMessageRepository
import com.shyden.shytalk.data.repository.StorageRepository
import com.shyden.shytalk.data.repository.UserRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class GroupSetupUiState(
    val selectedUsers: List<User> = emptyList(),
    val groupName: String = "",
    val groupDescription: String = "",
    val groupPhotoUri: String? = null,
    val groupPhotoBytes: ByteArray? = null,
    val roles: Map<String, GroupRole> = emptyMap(),
    val permissions: GroupPermissions = GroupPermissions(),
    val systemMessageConfig: SystemMessageConfig = SystemMessageConfig(),
    val isCreating: Boolean = false,
    val error: String? = null,
    val createdConversationId: String? = null,
    val ownedGroupCount: Int = 0,
    val isLoading: Boolean = true
)

class GroupSetupViewModel(
    private val selectedIdsString: String,
    private val pmRepository: PrivateMessageRepository,
    private val userRepository: UserRepository,
    private val authRepository: AuthRepository,
    private val storageRepository: StorageRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(GroupSetupUiState())
    val uiState: StateFlow<GroupSetupUiState> = _uiState.asStateFlow()

    private val currentUserId: String = authRepository.currentUserId ?: ""

    init {
        loadSelectedUsers()
        loadOwnedGroupCount()
    }

    private fun loadSelectedUsers() {
        viewModelScope.launch {
            val ids = selectedIdsString.split(",").filter { it.isNotBlank() }
            if (ids.isEmpty()) {
                _uiState.update { it.copy(isLoading = false, error = "No users selected") }
                return@launch
            }
            when (val result = userRepository.getUsers(ids)) {
                is Resource.Success -> {
                    val initialRoles = ids.associateWith { GroupRole.MEMBER }
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            selectedUsers = result.data,
                            roles = initialRoles
                        )
                    }
                }
                else -> {
                    _uiState.update { it.copy(isLoading = false, error = "Failed to load users") }
                }
            }
        }
    }

    private fun loadOwnedGroupCount() {
        viewModelScope.launch {
            when (val result = pmRepository.getOwnedGroupCount(currentUserId)) {
                is Resource.Success -> {
                    _uiState.update { it.copy(ownedGroupCount = result.data) }
                }
                else -> {}
            }
        }
    }

    fun setGroupName(name: String) {
        _uiState.update { it.copy(groupName = name) }
    }

    fun setGroupDescription(description: String) {
        if (description.length <= Constants.MAX_GROUP_DESCRIPTION_LENGTH) {
            _uiState.update { it.copy(groupDescription = description) }
        }
    }

    fun setGroupPhoto(bytes: ByteArray) {
        _uiState.update { it.copy(groupPhotoBytes = bytes) }
    }

    fun cycleRole(userId: String) {
        _uiState.update { state ->
            val currentRole = state.roles[userId] ?: GroupRole.MEMBER
            val nextRole = when (currentRole) {
                GroupRole.MEMBER -> GroupRole.MOD
                GroupRole.MOD -> GroupRole.ADMIN
                GroupRole.ADMIN -> GroupRole.MEMBER
                GroupRole.OWNER -> GroupRole.OWNER // Can't cycle owner
            }
            state.copy(roles = state.roles + (userId to nextRole))
        }
    }

    fun updatePermission(field: String, level: GroupPermissions.PermissionLevel) {
        _uiState.update { state ->
            val p = state.permissions
            val updated = when (field) {
                "whoCanSend" -> p.copy(whoCanSend = level)
                "whoCanAddMembers" -> p.copy(whoCanAddMembers = level)
                "whoCanEditInfo" -> p.copy(whoCanEditInfo = level)
                "whoCanDeleteMessages" -> p.copy(whoCanDeleteMessages = level)
                "whoCanMuteMembers" -> p.copy(whoCanMuteMembers = level)
                "whoCanRemoveMembers" -> p.copy(whoCanRemoveMembers = level)
                else -> p
            }
            state.copy(permissions = updated)
        }
    }

    fun toggleSystemMessage(field: String) {
        _uiState.update { state ->
            val c = state.systemMessageConfig
            val updated = when (field) {
                "showJoins" -> c.copy(showJoins = !c.showJoins)
                "showLeaves" -> c.copy(showLeaves = !c.showLeaves)
                "showRoleChanges" -> c.copy(showRoleChanges = !c.showRoleChanges)
                "showPermissionChanges" -> c.copy(showPermissionChanges = !c.showPermissionChanges)
                else -> c
            }
            state.copy(systemMessageConfig = updated)
        }
    }

    fun createGroup() {
        val state = _uiState.value
        if (state.groupName.isBlank() || state.isCreating) return

        if (state.ownedGroupCount >= Constants.MAX_OWNED_GROUPS) {
            _uiState.update { it.copy(error = "You can own a maximum of ${Constants.MAX_OWNED_GROUPS} groups") }
            return
        }

        _uiState.update { it.copy(isCreating = true) }
        viewModelScope.launch {
            // Upload group photo if set
            var photoUrl: String? = null
            val photoBytes = state.groupPhotoBytes
            if (photoBytes != null) {
                val compressed = compressImage(photoBytes)
                when (val uploadResult = storageRepository.uploadImage(
                    currentUserId, "group_photos", compressed
                )) {
                    is Resource.Success -> photoUrl = uploadResult.data
                    is Resource.Error -> {
                        _uiState.update { it.copy(isCreating = false, error = "Failed to upload group photo") }
                        return@launch
                    }
                    is Resource.Loading -> {}
                }
            }

            val adminIds = state.roles.filter { it.value == GroupRole.ADMIN }.keys.toList()
            val modIds = state.roles.filter { it.value == GroupRole.MOD }.keys.toList()

            when (val result = pmRepository.createGroupConversation(
                creatorId = currentUserId,
                participantIds = state.selectedUsers.map { it.uid },
                groupName = state.groupName.trim(),
                groupDescription = state.groupDescription.trim().ifBlank { null },
                groupPhotoUrl = photoUrl,
                adminIds = adminIds,
                modIds = modIds,
                permissions = state.permissions,
                systemMessageConfig = state.systemMessageConfig
            )) {
                is Resource.Success -> {
                    _uiState.update {
                        it.copy(isCreating = false, createdConversationId = result.data.conversationId)
                    }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(isCreating = false, error = result.message) }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}
