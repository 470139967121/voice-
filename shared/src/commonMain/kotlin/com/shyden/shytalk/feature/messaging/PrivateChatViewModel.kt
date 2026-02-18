package com.shyden.shytalk.feature.messaging

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.Conversation
import com.shyden.shytalk.core.model.ConversationSettings
import com.shyden.shytalk.core.model.MessageEdit
import com.shyden.shytalk.core.model.PmPrivacy
import com.shyden.shytalk.core.model.PrivateMessage
import com.shyden.shytalk.core.model.SendStatus
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.core.util.ModerationFilter
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.PrivateMessageRepository
import com.shyden.shytalk.data.repository.ReportRepository
import com.shyden.shytalk.data.repository.TypingRepository
import com.shyden.shytalk.data.repository.UserRepository
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class PrivateChatUiState(
    val messages: List<PrivateMessage> = emptyList(),
    val otherUser: User? = null,
    val currentUser: User? = null,
    val isLoading: Boolean = true,
    val error: String? = null,
    val isBlocked: Boolean = false,
    val blockReason: String? = null,
    val isMuted: Boolean = false,
    val isSilent: Boolean = false,
    val isPinned: Boolean = false,
    val conversationId: String = "",
    val currentUserId: String = "",
    val currentUserName: String = "",
    val editingMessageId: String? = null,
    val editingOriginalText: String = "",
    val replyingToMessage: PrivateMessage? = null,
    val isLoadingOlder: Boolean = false,
    val hasOlderMessages: Boolean = true,
    val failedMessages: List<PrivateMessage> = emptyList(),
    val isOtherUserTyping: Boolean = false,
    val isSearching: Boolean = false,
    val searchQuery: String = "",
    val searchResults: List<PrivateMessage> = emptyList()
)

class PrivateChatViewModel(
    private val otherUserId: String,
    private val pmRepository: PrivateMessageRepository,
    private val userRepository: UserRepository,
    private val authRepository: AuthRepository,
    private val typingRepository: TypingRepository,
    private val reportRepository: ReportRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(PrivateChatUiState())
    val uiState: StateFlow<PrivateChatUiState> = _uiState.asStateFlow()

    private val currentUserId: String = authRepository.currentUserId ?: ""
    private var messagesJob: Job? = null
    private var settingsJob: Job? = null
    private var typingJob: Job? = null
    private var typingResetJob: Job? = null

    init {
        if (currentUserId.isNotEmpty()) {
            initChat()
        }
    }

    private fun initChat() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, currentUserId = currentUserId) }

            // Load both users
            val currentUser = when (val result = userRepository.getUser(currentUserId)) {
                is Resource.Success -> result.data
                else -> null
            }
            val otherUser = when (val result = userRepository.getUser(otherUserId)) {
                is Resource.Success -> result.data
                else -> null
            }

            _uiState.update {
                it.copy(
                    currentUser = currentUser,
                    otherUser = otherUser,
                    currentUserName = currentUser?.displayName ?: ""
                )
            }

            // Check block/privacy restrictions
            val blockReason = checkRestrictions(currentUser, otherUser)
            if (blockReason != null) {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        isBlocked = true,
                        blockReason = blockReason
                    )
                }
                // Still try to load existing conversation for viewing
            }

            // Get or create conversation
            when (val result = pmRepository.getOrCreateConversation(currentUserId, otherUserId)) {
                is Resource.Success -> {
                    val conversation = result.data
                    _uiState.update { it.copy(conversationId = conversation.conversationId) }
                    observeMessages(conversation.conversationId)
                    observeSettings(conversation.conversationId)
                    observeTyping(conversation.conversationId)
                }
                is Resource.Error -> {
                    _uiState.update {
                        it.copy(isLoading = false, error = result.message)
                    }
                }
                is Resource.Loading -> {}
            }

            _uiState.update { it.copy(isLoading = false) }
        }
    }

    private fun checkRestrictions(currentUser: User?, otherUser: User?): String? {
        if (currentUser == null || otherUser == null) return null

        // Check if blocked by target
        if (otherUser.blockedUserIds.contains(currentUserId)) {
            return "You are blocked by this user and cannot send messages."
        }
        // Check if you blocked target
        if (currentUser.blockedUserIds.contains(otherUserId)) {
            return "You have blocked this user. Unblock them to send messages."
        }
        // Check PM privacy
        when (otherUser.pmPrivacy) {
            PmPrivacy.NO_ONE -> return "This user does not accept private messages."
            PmPrivacy.FOLLOWERS_ONLY -> {
                // Target must follow the sender
                if (!otherUser.followingIds.contains(currentUserId)) {
                    return "This user only accepts messages from people they follow."
                }
            }
            PmPrivacy.EVERYONE -> {}
        }
        return null
    }

    private fun observeMessages(conversationId: String) {
        messagesJob?.cancel()
        messagesJob = viewModelScope.launch {
            pmRepository.getMessages(conversationId, Constants.PM_MESSAGES_PAGE_SIZE).collect { messages ->
                _uiState.update { it.copy(messages = messages) }
            }
        }
    }

    private fun observeSettings(conversationId: String) {
        settingsJob?.cancel()
        settingsJob = viewModelScope.launch {
            pmRepository.observeConversationSettings(conversationId, currentUserId).collect { settings ->
                _uiState.update {
                    it.copy(
                        isMuted = settings.isMuted,
                        isSilent = settings.isSilent,
                        isPinned = settings.isPinned
                    )
                }
            }
        }
    }

    fun sendMessage(text: String) {
        val trimmed = text.trim()
        if (trimmed.isEmpty() || trimmed.length > Constants.MAX_PM_MESSAGE_LENGTH) return
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return

        // Moderation checks
        val moderationWarning = ModerationFilter.checkMessage(trimmed)
        if (moderationWarning != null) {
            _uiState.update { it.copy(error = moderationWarning) }
            return
        }
        if (ModerationFilter.isSpam(trimmed)) {
            _uiState.update { it.copy(error = "Please wait before sending the same message again.") }
            return
        }

        val replyTo = _uiState.value.replyingToMessage
        cancelReply()
        clearTyping()

        viewModelScope.launch {
            when (pmRepository.sendTextMessage(
                conversationId = conversationId,
                senderId = currentUserId,
                senderName = _uiState.value.currentUserName,
                text = trimmed,
                replyToMessageId = replyTo?.messageId,
                replyToText = replyTo?.text?.take(100),
                replyToSenderName = replyTo?.senderName
            )) {
                is Resource.Error -> {
                    _uiState.update { it.copy(error = "Failed to send message") }
                }
                else -> {}
            }
        }
    }

    fun sendImages(imageUrls: List<String>) {
        if (imageUrls.isEmpty()) return
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return

        val replyTo = _uiState.value.replyingToMessage
        cancelReply()

        viewModelScope.launch {
            when (pmRepository.sendImageMessage(
                conversationId = conversationId,
                senderId = currentUserId,
                senderName = _uiState.value.currentUserName,
                imageUrls = imageUrls,
                replyToMessageId = replyTo?.messageId,
                replyToText = replyTo?.let { if (it.imageUrls.isNotEmpty()) "[Image]" else it.text.take(100) },
                replyToSenderName = replyTo?.senderName
            )) {
                is Resource.Error -> {
                    _uiState.update { it.copy(error = "Failed to send image") }
                }
                else -> {}
            }
        }
    }

    fun startEditing(message: PrivateMessage) {
        // Check edit window
        val elapsed = currentTimeMillis() - message.createdAt
        if (elapsed > Constants.PM_EDIT_WINDOW_MS) return
        if (message.senderId != currentUserId) return

        _uiState.update {
            it.copy(
                editingMessageId = message.messageId,
                editingOriginalText = message.text
            )
        }
    }

    fun cancelEditing() {
        _uiState.update {
            it.copy(editingMessageId = null, editingOriginalText = "")
        }
    }

    fun submitEdit(newText: String) {
        val trimmed = newText.trim()
        val messageId = _uiState.value.editingMessageId ?: return
        val conversationId = _uiState.value.conversationId
        if (trimmed.isEmpty() || conversationId.isEmpty()) return

        cancelEditing()

        viewModelScope.launch {
            when (pmRepository.editMessage(conversationId, messageId, trimmed)) {
                is Resource.Error -> {
                    _uiState.update { it.copy(error = "Failed to edit message") }
                }
                else -> {}
            }
        }
    }

    fun startReply(message: PrivateMessage) {
        _uiState.update { it.copy(replyingToMessage = message) }
    }

    fun cancelReply() {
        _uiState.update { it.copy(replyingToMessage = null) }
    }

    fun markMessagesAsRead() {
        val conversationId = _uiState.value.conversationId
        val messages = _uiState.value.messages
        if (conversationId.isEmpty() || messages.isEmpty()) return

        // Find the last message from the other user
        val lastOtherMessage = messages.lastOrNull { it.senderId == otherUserId } ?: return
        if (currentUserId in lastOtherMessage.readBy) return

        viewModelScope.launch {
            pmRepository.markAsRead(conversationId, currentUserId, lastOtherMessage.messageId)
        }
    }

    fun toggleMute() {
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return
        val newMuted = !_uiState.value.isMuted
        viewModelScope.launch {
            pmRepository.muteConversation(conversationId, currentUserId, newMuted)
        }
    }

    fun toggleSilent() {
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return
        val newSilent = !_uiState.value.isSilent
        viewModelScope.launch {
            pmRepository.silentConversation(conversationId, currentUserId, newSilent)
        }
    }

    fun togglePin() {
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return
        val newPinned = !_uiState.value.isPinned
        viewModelScope.launch {
            pmRepository.pinConversation(conversationId, currentUserId, newPinned)
        }
    }

    fun hideConversation() {
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return
        viewModelScope.launch {
            pmRepository.hideConversation(conversationId, currentUserId)
        }
    }

    fun loadOlderMessages() {
        val conversationId = _uiState.value.conversationId
        val messages = _uiState.value.messages
        if (conversationId.isEmpty() || messages.isEmpty() || _uiState.value.isLoadingOlder) return

        val oldestTimestamp = messages.first().createdAt
        _uiState.update { it.copy(isLoadingOlder = true) }

        viewModelScope.launch {
            when (val result = pmRepository.loadOlderMessages(
                conversationId, oldestTimestamp, Constants.PM_MESSAGES_PAGE_SIZE
            )) {
                is Resource.Success -> {
                    _uiState.update {
                        it.copy(
                            isLoadingOlder = false,
                            hasOlderMessages = result.data.isNotEmpty()
                        )
                    }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(isLoadingOlder = false) }
                }
                is Resource.Loading -> {}
            }
        }
    }

    suspend fun getEditHistory(messageId: String): List<MessageEdit> {
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return emptyList()
        return when (val result = pmRepository.getEditHistory(conversationId, messageId)) {
            is Resource.Success -> result.data
            else -> emptyList()
        }
    }

    fun onTextChanged() {
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return

        typingRepository.setTyping(conversationId, currentUserId, true)

        // Auto-reset typing after debounce
        typingResetJob?.cancel()
        typingResetJob = viewModelScope.launch {
            delay(Constants.TYPING_DEBOUNCE_MS)
            typingRepository.setTyping(conversationId, currentUserId, false)
        }
    }

    private fun observeTyping(conversationId: String) {
        typingJob?.cancel()
        typingJob = viewModelScope.launch {
            typingRepository.observeTyping(conversationId, otherUserId).collect { isTyping ->
                _uiState.update { it.copy(isOtherUserTyping = isTyping) }
            }
        }
    }

    private fun clearTyping() {
        val conversationId = _uiState.value.conversationId
        if (conversationId.isNotEmpty()) {
            typingRepository.setTyping(conversationId, currentUserId, false)
        }
    }

    override fun onCleared() {
        super.onCleared()
        clearTyping()
    }

    fun reportMessage(message: PrivateMessage, reason: String, description: String) {
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return
        viewModelScope.launch {
            when (reportRepository.reportMessage(
                reporterId = currentUserId,
                reportedUserId = message.senderId,
                conversationId = conversationId,
                messageId = message.messageId,
                messageText = message.text,
                reason = reason,
                description = description
            )) {
                is Resource.Success -> {
                    _uiState.update { it.copy(error = "Report submitted") }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(error = "Failed to submit report") }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun toggleReaction(messageId: String, emoji: String) {
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return
        viewModelScope.launch {
            pmRepository.toggleReaction(conversationId, messageId, emoji, currentUserId)
        }
    }

    fun toggleSearch() {
        val searching = !_uiState.value.isSearching
        _uiState.update {
            it.copy(
                isSearching = searching,
                searchQuery = if (!searching) "" else it.searchQuery,
                searchResults = if (!searching) emptyList() else it.searchResults
            )
        }
    }

    fun searchMessages(query: String) {
        _uiState.update { it.copy(searchQuery = query) }
        if (query.length < 2) {
            _uiState.update { it.copy(searchResults = emptyList()) }
            return
        }
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return
        viewModelScope.launch {
            when (val result = pmRepository.searchMessages(conversationId, query)) {
                is Resource.Success -> {
                    _uiState.update { it.copy(searchResults = result.data) }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(error = "Search failed") }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}
