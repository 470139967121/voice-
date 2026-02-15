package com.shyden.shytalk.feature.profile

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.UserRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class FollowListUiState(
    val isLoading: Boolean = true,
    val error: String? = null,
    val profileUserId: String = "",
    val currentUserId: String = "",
    val isOwnList: Boolean = false,
    val selectedTab: FollowTab = FollowTab.FOLLOWERS,
    val followers: List<User> = emptyList(),
    val following: List<User> = emptyList(),
    val currentUserFollowingIds: Set<String> = emptySet(),
    val currentUserFollowerIds: Set<String> = emptySet(),
    val currentUserBlockedIds: Set<String> = emptySet(),
    val followingHidden: Boolean = false
)

enum class FollowTab { FOLLOWERS, FOLLOWING }

class FollowListViewModel(
    private val profileUserId: String,
    initialTab: String,
    private val authRepository: AuthRepository,
    private val userRepository: UserRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(FollowListUiState())
    val uiState: StateFlow<FollowListUiState> = _uiState.asStateFlow()

    init {
        val currentUid = authRepository.currentUserId ?: ""
        val tab = if (initialTab == "following") FollowTab.FOLLOWING else FollowTab.FOLLOWERS
        _uiState.value = FollowListUiState(
            profileUserId = profileUserId,
            currentUserId = currentUid,
            isOwnList = profileUserId == currentUid,
            selectedTab = tab
        )
        loadData()
    }

    fun selectTab(tab: FollowTab) {
        _uiState.update { it.copy(selectedTab = tab) }
    }

    private fun loadData() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }

            val profileResult = userRepository.getUser(profileUserId)
            if (profileResult is Resource.Error) {
                _uiState.update { it.copy(isLoading = false, error = profileResult.message) }
                return@launch
            }
            val profileUser = (profileResult as Resource.Success).data
            val followerIdsList = profileUser.followerIds.toList()
            val isFollowingHidden = !_uiState.value.isOwnList && profileUser.hideFollowing
            val followingIdsList = if (isFollowingHidden) emptyList() else profileUser.followingIds.toList()

            // Load current user's follow data for button states
            val currentUid = _uiState.value.currentUserId
            var myFollowingIds: Set<String> = emptySet()
            var myFollowerIds: Set<String> = emptySet()
            var myBlockedIds: Set<String> = emptySet()
            if (_uiState.value.isOwnList) {
                myFollowingIds = profileUser.followingIds
                myFollowerIds = profileUser.followerIds
                myBlockedIds = profileUser.blockedUserIds
            } else if (currentUid.isNotEmpty()) {
                val myResult = userRepository.getUser(currentUid)
                if (myResult is Resource.Success) {
                    myFollowingIds = myResult.data.followingIds
                    myFollowerIds = myResult.data.followerIds
                    myBlockedIds = myResult.data.blockedUserIds
                }
            }

            // Batch-fetch all user objects
            val allIds = (followerIdsList + followingIdsList).distinct()
            val allUsers = if (allIds.isNotEmpty()) {
                when (val result = userRepository.getUsers(allIds)) {
                    is Resource.Success -> result.data.associateBy { it.uid }
                    else -> emptyMap()
                }
            } else emptyMap()

            _uiState.update {
                it.copy(
                    isLoading = false,
                    followers = followerIdsList.mapNotNull { id -> allUsers[id] },
                    following = followingIdsList.mapNotNull { id -> allUsers[id] },
                    currentUserFollowingIds = myFollowingIds,
                    currentUserFollowerIds = myFollowerIds,
                    currentUserBlockedIds = myBlockedIds,
                    followingHidden = isFollowingHidden
                )
            }
        }
    }

    fun toggleFollow(targetUserId: String) {
        val currentUid = _uiState.value.currentUserId
        if (currentUid.isEmpty()) return
        if (targetUserId in _uiState.value.currentUserBlockedIds) return

        val isCurrentlyFollowing = targetUserId in _uiState.value.currentUserFollowingIds

        // Optimistic update
        val newFollowingIds = if (isCurrentlyFollowing) {
            _uiState.value.currentUserFollowingIds - targetUserId
        } else {
            _uiState.value.currentUserFollowingIds + targetUserId
        }
        _uiState.update { it.copy(currentUserFollowingIds = newFollowingIds) }

        viewModelScope.launch {
            val result = if (isCurrentlyFollowing) {
                userRepository.unfollowUser(currentUid, targetUserId)
            } else {
                userRepository.followUser(currentUid, targetUserId)
            }
            if (result is Resource.Error) {
                _uiState.update {
                    val revertedIds = if (isCurrentlyFollowing) {
                        it.currentUserFollowingIds + targetUserId
                    } else {
                        it.currentUserFollowingIds - targetUserId
                    }
                    it.copy(currentUserFollowingIds = revertedIds, error = result.message)
                }
            }
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}
