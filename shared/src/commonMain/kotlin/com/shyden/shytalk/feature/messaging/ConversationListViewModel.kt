package com.shyden.shytalk.feature.messaging

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.Conversation
import com.shyden.shytalk.core.model.ConversationSettings
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.PrivateMessageRepository
import com.shyden.shytalk.data.repository.UserRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ConversationWithUser(
    val conversation: Conversation,
    val otherUser: User? = null,
    val settings: ConversationSettings? = null,
    val isBlocked: Boolean = false
)

data class ConversationListUiState(
    val conversations: List<ConversationWithUser> = emptyList(),
    val isLoading: Boolean = true,
    val error: String? = null,
    val totalUnreadCount: Long = 0,
    val searchQuery: String = ""
)

class ConversationListViewModel(
    private val pmRepository: PrivateMessageRepository,
    private val userRepository: UserRepository,
    private val authRepository: AuthRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(ConversationListUiState())
    val uiState: StateFlow<ConversationListUiState> = _uiState.asStateFlow()

    val currentUserId: String = authRepository.currentUserId ?: ""

    // Cache for user data and settings to avoid refetching every time
    private val userCache = mutableMapOf<String, User>()
    private val settingsCache = mutableMapOf<String, ConversationSettings>()

    init {
        if (currentUserId.isNotEmpty()) {
            observeConversations()
        }
    }

    private fun observeConversations() {
        viewModelScope.launch {
            pmRepository.getConversations(currentUserId)
                .catch { e ->
                    _uiState.update {
                        it.copy(isLoading = false, error = e.message ?: "Failed to load conversations")
                    }
                }
                .collect { conversations ->
                    loadConversationDetails(conversations)
                }
        }
    }

    private suspend fun loadConversationDetails(conversations: List<Conversation>) {
        // Get current user's blocked list
        val currentUser = when (val result = userRepository.getUser(currentUserId)) {
            is Resource.Success -> result.data
            else -> null
        }
        val blockedByMe = currentUser?.blockedUserIds ?: emptySet()

        // Collect other user IDs we need to fetch
        val otherUserIds = conversations.mapNotNull { it.otherUserId(currentUserId) }
        val uncachedIds = otherUserIds.filter { it !in userCache }

        // Batch fetch uncached users
        if (uncachedIds.isNotEmpty()) {
            when (val result = userRepository.getUsers(uncachedIds)) {
                is Resource.Success -> {
                    result.data.forEach { user -> userCache[user.uid] = user }
                }
                else -> {}
            }
        }

        // Fetch settings for each conversation
        val conversationsWithDetails = conversations.mapNotNull { conversation ->
            val otherUserId = conversation.otherUserId(currentUserId) ?: return@mapNotNull null
            val otherUser = userCache[otherUserId]

            // Check block status bidirectionally
            val blockedByTarget = otherUser?.blockedUserIds?.contains(currentUserId) == true
            val isBlocked = otherUserId in blockedByMe || blockedByTarget

            // Skip blocked conversations
            if (isBlocked) return@mapNotNull null

            // Fetch settings
            val settings = settingsCache[conversation.conversationId]
                ?: when (val result = pmRepository.getConversationSettings(conversation.conversationId, currentUserId)) {
                    is Resource.Success -> {
                        settingsCache[conversation.conversationId] = result.data
                        result.data
                    }
                    else -> null
                }

            // Filter hidden conversations (unless a new message arrived after hiding)
            if (settings?.isHidden == true) {
                val hiddenAt = settings.hiddenAt ?: 0
                if (conversation.lastMessageAt <= hiddenAt) return@mapNotNull null
            }

            ConversationWithUser(
                conversation = conversation,
                otherUser = otherUser,
                settings = settings,
                isBlocked = isBlocked
            )
        }

        // Sort: pinned first (by lastMessageAt desc), then unpinned (by lastMessageAt desc)
        val sorted = conversationsWithDetails.sortedWith(
            compareByDescending<ConversationWithUser> { it.settings?.isPinned == true }
                .thenByDescending { it.conversation.lastMessageAt }
        )

        val totalUnread = sorted.sumOf { it.settings?.unreadCount ?: 0 }

        _uiState.update {
            it.copy(
                conversations = sorted,
                isLoading = false,
                totalUnreadCount = totalUnread
            )
        }
    }

    fun onSearchQueryChanged(query: String) {
        _uiState.update { it.copy(searchQuery = query) }
    }

    fun getFilteredConversations(): List<ConversationWithUser> {
        val query = _uiState.value.searchQuery
        val conversations = _uiState.value.conversations
        return if (query.isBlank()) {
            conversations
        } else {
            conversations.filter { cw ->
                cw.otherUser?.displayName?.contains(query, ignoreCase = true) == true
            }
        }
    }

    fun hideConversation(conversationId: String) {
        viewModelScope.launch {
            pmRepository.hideConversation(conversationId, currentUserId)
            // Update cache so it's filtered out immediately
            settingsCache[conversationId] = (settingsCache[conversationId] ?: ConversationSettings(userId = currentUserId))
                .copy(isHidden = true, hiddenAt = com.shyden.shytalk.core.util.currentTimeMillis())
            // Remove from UI
            _uiState.update { state ->
                state.copy(
                    conversations = state.conversations.filter { it.conversation.conversationId != conversationId }
                )
            }
        }
    }

    fun pinConversation(conversationId: String) {
        viewModelScope.launch {
            val current = settingsCache[conversationId]
            val newPinned = !(current?.isPinned ?: false)
            pmRepository.pinConversation(conversationId, currentUserId, newPinned)
            settingsCache[conversationId] = (current ?: ConversationSettings(userId = currentUserId))
                .copy(isPinned = newPinned)
            // Re-sort
            _uiState.update { state ->
                val updated = state.conversations.map { cw ->
                    if (cw.conversation.conversationId == conversationId) {
                        cw.copy(settings = cw.settings?.copy(isPinned = newPinned))
                    } else cw
                }.sortedWith(
                    compareByDescending<ConversationWithUser> { it.settings?.isPinned == true }
                        .thenByDescending { it.conversation.lastMessageAt }
                )
                state.copy(conversations = updated)
            }
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}
