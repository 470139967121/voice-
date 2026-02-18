package com.shyden.shytalk.feature.messaging

import com.shyden.shytalk.core.model.Conversation
import com.shyden.shytalk.core.model.ConversationSettings
import com.shyden.shytalk.core.model.PmPrivacy
import com.shyden.shytalk.core.model.PrivateMessage
import com.shyden.shytalk.core.model.PrivateMessageType
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.core.util.ModerationFilter
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.PrivateMessageRepository
import com.shyden.shytalk.data.repository.ReportRepository
import com.shyden.shytalk.data.repository.TypingRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.testutil.MainDispatcherRule
import com.shyden.shytalk.testutil.TestData
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PrivateChatViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val authRepository = mockk<AuthRepository>(relaxed = true)
    private val userRepository = mockk<UserRepository>(relaxed = true)
    private val pmRepository = mockk<PrivateMessageRepository>(relaxed = true)
    private val typingRepository = mockk<TypingRepository>(relaxed = true)
    private val reportRepository = mockk<ReportRepository>(relaxed = true)

    private val currentUserId = "current-user"
    private val otherUserId = "other-user"
    private val conversationId = "current-user_other-user"

    private val messagesFlow = MutableSharedFlow<List<PrivateMessage>>()
    private val settingsFlow = MutableSharedFlow<ConversationSettings>()
    private val typingFlow = MutableSharedFlow<Boolean>()

    @Before
    fun setup() {
        ModerationFilter.reset()
        ModerationFilter.updateProhibitedWords(emptyList())

        every { authRepository.currentUserId } returns currentUserId

        val currentUser = TestData.createTestUser(uid = currentUserId, displayName = "Current")
        val otherUser = TestData.createTestUser(uid = otherUserId, displayName = "Other")

        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(currentUser)
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(otherUser)

        val conversation = TestData.createTestConversation(
            conversationId = conversationId,
            participantIds = listOf(currentUserId, otherUserId)
        )
        coEvery { pmRepository.getOrCreateConversation(currentUserId, otherUserId) } returns
                Resource.Success(conversation)

        every { pmRepository.getMessages(conversationId, any()) } returns messagesFlow
        every { pmRepository.observeConversationSettings(conversationId, currentUserId) } returns settingsFlow
        every { typingRepository.observeTyping(conversationId, otherUserId) } returns typingFlow
    }

    private fun createViewModel(): PrivateChatViewModel {
        return PrivateChatViewModel(
            otherUserId = otherUserId,
            pmRepository = pmRepository,
            userRepository = userRepository,
            authRepository = authRepository,
            typingRepository = typingRepository,
            reportRepository = reportRepository
        )
    }

    // ===== Init =====

    @Test
    fun `init loads users and conversationId`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        val state = vm.uiState.value
        assertEquals(conversationId, state.conversationId)
        assertEquals(currentUserId, state.currentUserId)
        assertEquals("Current", state.currentUserName)
        assertNotNull(state.otherUser)
        assertNotNull(state.currentUser)
        assertFalse(state.isLoading)
    }

    @Test
    fun `init handles getOrCreateConversation failure`() = runTest {
        coEvery { pmRepository.getOrCreateConversation(currentUserId, otherUserId) } returns
                Resource.Error("network error")

        val vm = createViewModel()
        advanceUntilIdle()

        assertEquals("network error", vm.uiState.value.error)
        assertEquals("", vm.uiState.value.conversationId)
    }

    @Test
    fun `init skips when no currentUserId`() = runTest {
        every { authRepository.currentUserId } returns null

        val vm = PrivateChatViewModel(
            otherUserId = otherUserId,
            pmRepository = pmRepository,
            userRepository = userRepository,
            authRepository = mockk { every { currentUserId } returns null },
            typingRepository = typingRepository,
            reportRepository = reportRepository
        )
        advanceUntilIdle()

        // Should not have loaded anything
        assertNull(vm.uiState.value.currentUser)
        assertNull(vm.uiState.value.otherUser)
    }

    // ===== Restrictions =====

    @Test
    fun `blocked by other user sets isBlocked`() = runTest {
        val otherUser = TestData.createTestUser(
            uid = otherUserId,
            blockedUserIds = setOf(currentUserId)
        )
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(otherUser)

        val vm = createViewModel()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isBlocked)
        assertTrue(vm.uiState.value.blockReason!!.contains("blocked by this user"))
    }

    @Test
    fun `blocked by self sets isBlocked`() = runTest {
        val currentUser = TestData.createTestUser(
            uid = currentUserId,
            blockedUserIds = setOf(otherUserId)
        )
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(currentUser)

        val vm = createViewModel()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isBlocked)
        assertTrue(vm.uiState.value.blockReason!!.contains("blocked this user"))
    }

    @Test
    fun `pmPrivacy NO_ONE blocks messaging`() = runTest {
        val otherUser = TestData.createTestUser(uid = otherUserId).copy(pmPrivacy = PmPrivacy.NO_ONE)
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(otherUser)

        val vm = createViewModel()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isBlocked)
        assertTrue(vm.uiState.value.blockReason!!.contains("does not accept"))
    }

    @Test
    fun `pmPrivacy FOLLOWERS_ONLY blocks when not followed`() = runTest {
        val otherUser = TestData.createTestUser(uid = otherUserId).copy(
            pmPrivacy = PmPrivacy.FOLLOWERS_ONLY,
            followingIds = emptySet()
        )
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(otherUser)

        val vm = createViewModel()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isBlocked)
        assertTrue(vm.uiState.value.blockReason!!.contains("people they follow"))
    }

    @Test
    fun `pmPrivacy FOLLOWERS_ONLY allows when followed`() = runTest {
        val otherUser = TestData.createTestUser(uid = otherUserId).copy(
            pmPrivacy = PmPrivacy.FOLLOWERS_ONLY,
            followingIds = setOf(currentUserId)
        )
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(otherUser)

        val vm = createViewModel()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isBlocked)
    }

    @Test
    fun `pmPrivacy EVERYONE does not block`() = runTest {
        val otherUser = TestData.createTestUser(uid = otherUserId).copy(pmPrivacy = PmPrivacy.EVERYONE)
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(otherUser)

        val vm = createViewModel()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isBlocked)
    }

    // ===== Send Message =====

    @Test
    fun `sendMessage calls repo with correct params`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        coEvery { pmRepository.sendTextMessage(any(), any(), any(), any(), any(), any(), any()) } returns
                Resource.Success(Unit)

        vm.sendMessage("Hello!")
        advanceUntilIdle()

        coVerify {
            pmRepository.sendTextMessage(
                conversationId = conversationId,
                senderId = currentUserId,
                senderName = "Current",
                text = "Hello!",
                replyToMessageId = null,
                replyToText = null,
                replyToSenderName = null
            )
        }
    }

    @Test
    fun `sendMessage trims whitespace`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        coEvery { pmRepository.sendTextMessage(any(), any(), any(), any(), any(), any(), any()) } returns
                Resource.Success(Unit)

        vm.sendMessage("  Hello!  ")
        advanceUntilIdle()

        coVerify {
            pmRepository.sendTextMessage(
                conversationId = any(),
                senderId = any(),
                senderName = any(),
                text = "Hello!",
                replyToMessageId = any(),
                replyToText = any(),
                replyToSenderName = any()
            )
        }
    }

    @Test
    fun `sendMessage rejects empty text`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.sendMessage("")
        vm.sendMessage("   ")
        advanceUntilIdle()

        coVerify(exactly = 0) { pmRepository.sendTextMessage(any(), any(), any(), any(), any(), any(), any()) }
    }

    @Test
    fun `sendMessage rejects overlength text`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        val longText = "A".repeat(Constants.MAX_PM_MESSAGE_LENGTH + 1)
        vm.sendMessage(longText)
        advanceUntilIdle()

        coVerify(exactly = 0) { pmRepository.sendTextMessage(any(), any(), any(), any(), any(), any(), any()) }
    }

    @Test
    fun `sendMessage moderation filter blocks`() = runTest {
        ModerationFilter.updateProhibitedWords(listOf("badword"))

        val vm = createViewModel()
        advanceUntilIdle()

        vm.sendMessage("This has badword in it")
        advanceUntilIdle()

        assertNotNull(vm.uiState.value.error)
        assertTrue(vm.uiState.value.error!!.contains("inappropriate"))
        coVerify(exactly = 0) { pmRepository.sendTextMessage(any(), any(), any(), any(), any(), any(), any()) }
    }

    @Test
    fun `sendMessage spam filter blocks`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        coEvery { pmRepository.sendTextMessage(any(), any(), any(), any(), any(), any(), any()) } returns
                Resource.Success(Unit)

        vm.sendMessage("spam")
        vm.sendMessage("spam")
        vm.sendMessage("spam") // 3rd identical
        advanceUntilIdle()

        assertEquals("Please wait before sending the same message again.", vm.uiState.value.error)
    }

    @Test
    fun `sendMessage clears reply`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        val replyMsg = TestData.createTestPrivateMessage(messageId = "reply-1", text = "Reply text", senderName = "Bob")
        vm.startReply(replyMsg)
        assertNotNull(vm.uiState.value.replyingToMessage)

        coEvery { pmRepository.sendTextMessage(any(), any(), any(), any(), any(), any(), any()) } returns
                Resource.Success(Unit)
        vm.sendMessage("With reply")
        advanceUntilIdle()

        assertNull(vm.uiState.value.replyingToMessage)
    }

    @Test
    fun `sendMessage repo failure sets error`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        coEvery { pmRepository.sendTextMessage(any(), any(), any(), any(), any(), any(), any()) } returns
                Resource.Error("send failed")

        vm.sendMessage("Hello!")
        advanceUntilIdle()

        assertEquals("Failed to send message", vm.uiState.value.error)
    }

    // ===== Send Images =====

    @Test
    fun `sendImages calls repo with correct params`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        coEvery { pmRepository.sendImageMessage(any(), any(), any(), any(), any(), any(), any()) } returns
                Resource.Success(Unit)

        vm.sendImages(listOf("https://img1.png", "https://img2.png"))
        advanceUntilIdle()

        coVerify {
            pmRepository.sendImageMessage(
                conversationId = conversationId,
                senderId = currentUserId,
                senderName = "Current",
                imageUrls = listOf("https://img1.png", "https://img2.png"),
                replyToMessageId = null,
                replyToText = null,
                replyToSenderName = null
            )
        }
    }

    @Test
    fun `sendImages rejects empty list`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.sendImages(emptyList())
        advanceUntilIdle()

        coVerify(exactly = 0) { pmRepository.sendImageMessage(any(), any(), any(), any(), any(), any(), any()) }
    }

    @Test
    fun `sendImages clears reply`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        val replyMsg = TestData.createTestPrivateMessage(messageId = "reply-1")
        vm.startReply(replyMsg)
        assertNotNull(vm.uiState.value.replyingToMessage)

        coEvery { pmRepository.sendImageMessage(any(), any(), any(), any(), any(), any(), any()) } returns
                Resource.Success(Unit)
        vm.sendImages(listOf("https://img.png"))
        advanceUntilIdle()

        assertNull(vm.uiState.value.replyingToMessage)
    }

    // ===== Edit =====

    @Test
    fun `startEditing sets editing state`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        val msg = TestData.createTestPrivateMessage(
            messageId = "msg-1",
            senderId = currentUserId,
            text = "Original",
            createdAt = System.currentTimeMillis() // within edit window
        )
        vm.startEditing(msg)

        assertEquals("msg-1", vm.uiState.value.editingMessageId)
        assertEquals("Original", vm.uiState.value.editingOriginalText)
    }

    @Test
    fun `startEditing rejects other users message`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        val msg = TestData.createTestPrivateMessage(
            senderId = otherUserId,
            createdAt = System.currentTimeMillis()
        )
        vm.startEditing(msg)

        assertNull(vm.uiState.value.editingMessageId)
    }

    @Test
    fun `startEditing rejects expired window`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        val msg = TestData.createTestPrivateMessage(
            senderId = currentUserId,
            createdAt = System.currentTimeMillis() - Constants.PM_EDIT_WINDOW_MS - 1000
        )
        vm.startEditing(msg)

        assertNull(vm.uiState.value.editingMessageId)
    }

    @Test
    fun `cancelEditing clears editing state`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        val msg = TestData.createTestPrivateMessage(
            senderId = currentUserId,
            createdAt = System.currentTimeMillis()
        )
        vm.startEditing(msg)
        assertNotNull(vm.uiState.value.editingMessageId)

        vm.cancelEditing()
        assertNull(vm.uiState.value.editingMessageId)
        assertEquals("", vm.uiState.value.editingOriginalText)
    }

    @Test
    fun `submitEdit calls repo`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        val msg = TestData.createTestPrivateMessage(
            messageId = "msg-edit",
            senderId = currentUserId,
            createdAt = System.currentTimeMillis()
        )
        vm.startEditing(msg)

        coEvery { pmRepository.editMessage(any(), any(), any()) } returns Resource.Success(Unit)
        vm.submitEdit("New text")
        advanceUntilIdle()

        coVerify { pmRepository.editMessage(conversationId, "msg-edit", "New text") }
        assertNull(vm.uiState.value.editingMessageId)
    }

    // ===== Reply =====

    @Test
    fun `startReply sets state`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        val msg = TestData.createTestPrivateMessage(messageId = "r-1", text = "Reply target")
        vm.startReply(msg)

        assertEquals(msg, vm.uiState.value.replyingToMessage)
    }

    @Test
    fun `cancelReply clears state`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.startReply(TestData.createTestPrivateMessage())
        assertNotNull(vm.uiState.value.replyingToMessage)

        vm.cancelReply()
        assertNull(vm.uiState.value.replyingToMessage)
    }

    // ===== Toggles =====

    @Test
    fun `toggleMute calls repo with inverted value`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        // Default isMuted is false, so toggle should pass true
        coEvery { pmRepository.muteConversation(any(), any(), any()) } returns Resource.Success(Unit)
        vm.toggleMute()
        advanceUntilIdle()

        coVerify { pmRepository.muteConversation(conversationId, currentUserId, true) }
    }

    @Test
    fun `toggleSilent calls repo with inverted value`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        coEvery { pmRepository.silentConversation(any(), any(), any()) } returns Resource.Success(Unit)
        vm.toggleSilent()
        advanceUntilIdle()

        coVerify { pmRepository.silentConversation(conversationId, currentUserId, true) }
    }

    @Test
    fun `togglePin calls repo with inverted value`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        coEvery { pmRepository.pinConversation(any(), any(), any()) } returns Resource.Success(Unit)
        vm.togglePin()
        advanceUntilIdle()

        coVerify { pmRepository.pinConversation(conversationId, currentUserId, true) }
    }

    @Test
    fun `hideConversation calls repo`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        coEvery { pmRepository.hideConversation(any(), any()) } returns Resource.Success(Unit)
        vm.hideConversation()
        advanceUntilIdle()

        coVerify { pmRepository.hideConversation(conversationId, currentUserId) }
    }

    // ===== Search =====

    @Test
    fun `toggleSearch enables and disables`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.toggleSearch()
        assertTrue(vm.uiState.value.isSearching)

        vm.toggleSearch()
        assertFalse(vm.uiState.value.isSearching)
        assertEquals("", vm.uiState.value.searchQuery)
        assertEquals(emptyList<PrivateMessage>(), vm.uiState.value.searchResults)
    }

    @Test
    fun `searchMessages short query clears results`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.searchMessages("a") // too short (< 2)
        advanceUntilIdle()

        assertEquals(emptyList<PrivateMessage>(), vm.uiState.value.searchResults)
    }

    @Test
    fun `searchMessages updates results`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        val results = listOf(TestData.createTestPrivateMessage(text = "Hello world"))
        coEvery { pmRepository.searchMessages(conversationId, "Hello") } returns Resource.Success(results)

        vm.searchMessages("Hello")
        advanceUntilIdle()

        assertEquals(results, vm.uiState.value.searchResults)
        assertEquals("Hello", vm.uiState.value.searchQuery)
    }

    // ===== Typing =====

    @Test
    fun `onTextChanged sets typing`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.onTextChanged()

        verify { typingRepository.setTyping(conversationId, currentUserId, true) }
    }

    @Test
    fun `observeTyping updates state`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isOtherUserTyping)

        typingFlow.emit(true)
        advanceUntilIdle()
        assertTrue(vm.uiState.value.isOtherUserTyping)

        typingFlow.emit(false)
        advanceUntilIdle()
        assertFalse(vm.uiState.value.isOtherUserTyping)
    }

    // ===== Reaction =====

    @Test
    fun `toggleReaction calls repo with correct params`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        coEvery { pmRepository.toggleReaction(any(), any(), any(), any()) } returns Resource.Success(Unit)
        vm.toggleReaction("msg-1", "👍")
        advanceUntilIdle()

        coVerify { pmRepository.toggleReaction(conversationId, "msg-1", "👍", currentUserId) }
    }

    // ===== Report =====

    @Test
    fun `reportMessage calls reportRepo on success`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        coEvery { reportRepository.reportMessage(any(), any(), any(), any(), any(), any(), any()) } returns
                Resource.Success(Unit)

        val msg = TestData.createTestPrivateMessage(messageId = "msg-r", senderId = otherUserId, text = "Bad msg")
        vm.reportMessage(msg, "spam", "It's spam")
        advanceUntilIdle()

        coVerify {
            reportRepository.reportMessage(
                reporterId = currentUserId,
                reportedUserId = otherUserId,
                conversationId = conversationId,
                messageId = "msg-r",
                messageText = "Bad msg",
                reason = "spam",
                description = "It's spam"
            )
        }
        assertEquals("Report submitted", vm.uiState.value.error)
    }

    @Test
    fun `reportMessage sets error on failure`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        coEvery { reportRepository.reportMessage(any(), any(), any(), any(), any(), any(), any()) } returns
                Resource.Error("report failed")

        val msg = TestData.createTestPrivateMessage(messageId = "msg-r", senderId = otherUserId)
        vm.reportMessage(msg, "spam", "desc")
        advanceUntilIdle()

        assertEquals("Failed to submit report", vm.uiState.value.error)
    }

    // ===== clearError =====

    @Test
    fun `clearError clears error state`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        ModerationFilter.updateProhibitedWords(listOf("badword"))
        vm.sendMessage("badword")
        advanceUntilIdle()
        assertNotNull(vm.uiState.value.error)

        vm.clearError()
        assertNull(vm.uiState.value.error)
    }

    // ===== Messages flow =====

    @Test
    fun `messages flow updates state`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        val msgs = listOf(
            TestData.createTestPrivateMessage(messageId = "m1"),
            TestData.createTestPrivateMessage(messageId = "m2")
        )
        messagesFlow.emit(msgs)
        advanceUntilIdle()

        assertEquals(2, vm.uiState.value.messages.size)
        assertEquals("m1", vm.uiState.value.messages[0].messageId)
    }

    // ===== Settings flow =====

    @Test
    fun `settings flow updates mute silent pin state`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        settingsFlow.emit(ConversationSettings(isMuted = true, isSilent = true, isPinned = true))
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isMuted)
        assertTrue(vm.uiState.value.isSilent)
        assertTrue(vm.uiState.value.isPinned)
    }
}
