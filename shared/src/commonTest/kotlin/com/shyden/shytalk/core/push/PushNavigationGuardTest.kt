package com.shyden.shytalk.core.push

import com.shyden.shytalk.core.model.Conversation
import com.shyden.shytalk.core.util.Resource
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class PushNavigationGuardTest {
    // ── Identity gate ────────────────────────────────────────────────

    @Test
    fun emptyCurrentUserId_dropsBeforeAnyLookup() =
        runTest {
            var blockedCalled = false
            var convCalled = false
            val ok =
                verifyPushNavigation(
                    currentUserId = "",
                    targetId = "user-x",
                    isGroup = false,
                    fetchBlockedUserIds = {
                        blockedCalled = true
                        Resource.Success(emptySet())
                    },
                    fetchConversation = {
                        convCalled = true
                        Resource.Success(Conversation())
                    },
                )
            assertFalse(ok)
            assertFalse(blockedCalled, "block-list lookup must not run for empty userId")
            assertFalse(convCalled, "conversation lookup must not run for empty userId")
        }

    // ── Block-list gate (private chats) ──────────────────────────────

    @Test
    fun privateChat_blockedUser_dropsAndDoesNotCheckConversation() =
        runTest {
            var convCalled = false
            val ok =
                verifyPushNavigation(
                    currentUserId = "10000001",
                    targetId = "10000099",
                    isGroup = false,
                    fetchBlockedUserIds = { Resource.Success(setOf("10000099")) },
                    fetchConversation = {
                        convCalled = true
                        Resource.Success(Conversation())
                    },
                )
            assertFalse(ok)
            assertFalse(convCalled, "conversation lookup must never run for private chats")
        }

    @Test
    fun privateChat_notBlocked_proceeds() =
        runTest {
            val ok =
                verifyPushNavigation(
                    currentUserId = "10000001",
                    targetId = "10000099",
                    isGroup = false,
                    fetchBlockedUserIds = { Resource.Success(setOf("10000044")) },
                    fetchConversation = { error("not used") },
                )
            assertTrue(ok)
        }

    @Test
    fun privateChat_blockListError_failsClosed() =
        runTest {
            val ok =
                verifyPushNavigation(
                    currentUserId = "10000001",
                    targetId = "10000099",
                    isGroup = false,
                    fetchBlockedUserIds = { Resource.Error("network down") },
                    fetchConversation = { error("not used") },
                )
            assertFalse(ok, "Resource.Error must fail closed, not let navigation through")
        }

    @Test
    fun privateChat_blockListLoading_failsClosed() =
        runTest {
            val ok =
                verifyPushNavigation(
                    currentUserId = "10000001",
                    targetId = "10000099",
                    isGroup = false,
                    fetchBlockedUserIds = { Resource.Loading },
                    fetchConversation = { error("not used") },
                )
            assertFalse(ok, "Resource.Loading from a one-shot fetch must fail closed")
        }

    @Test
    fun privateChat_blockListTimeout_failsClosed() =
        runTest {
            val ok =
                verifyPushNavigation(
                    currentUserId = "10000001",
                    targetId = "10000099",
                    isGroup = false,
                    fetchBlockedUserIds = {
                        // Hang past the 5s LOOKUP_TIMEOUT_MS — withTimeoutOrNull
                        // should kill it and return null (fail closed).
                        delay(60_000)
                        Resource.Success(emptySet())
                    },
                    fetchConversation = { error("not used") },
                )
            assertFalse(ok, "A hung block-list fetch must fail closed via the timeout, not block navigation forever")
        }

    // ── Conversation gate (groups) ───────────────────────────────────

    @Test
    fun groupChat_userIsParticipant_proceeds() =
        runTest {
            val ok =
                verifyPushNavigation(
                    currentUserId = "10000001",
                    targetId = "conv-abc",
                    isGroup = true,
                    fetchBlockedUserIds = { error("not used") },
                    fetchConversation = {
                        Resource.Success(
                            Conversation(
                                isGroup = true,
                                participantIds = listOf("10000001", "10000002", "10000003"),
                            ),
                        )
                    },
                )
            assertTrue(ok)
        }

    @Test
    fun groupChat_userNotInParticipants_dropsEvenOnReadSuccess() =
        runTest {
            val ok =
                verifyPushNavigation(
                    currentUserId = "10000001",
                    targetId = "conv-abc",
                    isGroup = true,
                    fetchBlockedUserIds = { error("not used") },
                    fetchConversation = {
                        // Defence in depth: even if Firestore rules let the read
                        // through (e.g. rules drift), the participantIds check
                        // catches the mismatch.
                        Resource.Success(
                            Conversation(
                                isGroup = true,
                                participantIds = listOf("10000002", "10000003"),
                            ),
                        )
                    },
                )
            assertFalse(ok)
        }

    @Test
    fun groupChat_conversationReadError_failsClosed() =
        runTest {
            val ok =
                verifyPushNavigation(
                    currentUserId = "10000001",
                    targetId = "conv-abc",
                    isGroup = true,
                    fetchBlockedUserIds = { error("not used") },
                    fetchConversation = { Resource.Error("permission denied") },
                )
            assertFalse(ok, "A failed conversation read must fail closed (no metadata flash)")
        }

    @Test
    fun groupChat_conversationReadTimeout_failsClosed() =
        runTest {
            val ok =
                verifyPushNavigation(
                    currentUserId = "10000001",
                    targetId = "conv-abc",
                    isGroup = true,
                    fetchBlockedUserIds = { error("not used") },
                    fetchConversation = {
                        delay(60_000)
                        Resource.Success(Conversation())
                    },
                )
            assertFalse(ok)
        }

    @Test
    fun groupChat_payloadIsGroupTrue_butConversationIs1on1_dropsToPreventBlockBypass() =
        runTest {
            // Block-bypass attack: a malicious payload claims isGroup=true for
            // a 1:1 conversationId. Without the type gate, this would skip the
            // block-list check (the participant gate alone would pass since
            // 1:1 conversations also have participantIds).
            val ok =
                verifyPushNavigation(
                    currentUserId = "10000001",
                    targetId = "conv-1on1",
                    isGroup = true,
                    fetchBlockedUserIds = { error("not used") },
                    fetchConversation = {
                        Resource.Success(
                            Conversation(
                                isGroup = false, // 1:1 conversation
                                participantIds = listOf("10000001", "10000099"),
                            ),
                        )
                    },
                )
            assertFalse(ok, "Type-gate must reject group payloads pointing at 1:1 conversations")
        }

    @Test
    fun privateChat_blockListLambdaThrows_failsClosed() =
        runTest {
            // Repository contract is to return Resource.Error, but a faulty /
            // future impl could throw synchronously. The throwable must NOT
            // propagate out — it would crash LaunchedEffect.collect and bring
            // down the Compose root.
            val ok =
                verifyPushNavigation(
                    currentUserId = "10000001",
                    targetId = "10000099",
                    isGroup = false,
                    fetchBlockedUserIds = { throw IllegalStateException("repo broken") },
                    fetchConversation = { error("not used") },
                )
            assertFalse(ok, "Synchronous throw must be caught and treated as fail-closed")
        }

    @Test
    fun groupChat_conversationLambdaThrows_failsClosed() =
        runTest {
            val ok =
                verifyPushNavigation(
                    currentUserId = "10000001",
                    targetId = "conv-abc",
                    isGroup = true,
                    fetchBlockedUserIds = { error("not used") },
                    fetchConversation = { throw RuntimeException("net glitch") },
                )
            assertFalse(ok, "Synchronous throw must be caught and treated as fail-closed")
        }

    @Test
    fun groupChat_skipsBlockListLookup() =
        runTest {
            var blockedCalled = false
            verifyPushNavigation(
                currentUserId = "10000001",
                targetId = "conv-abc",
                isGroup = true,
                fetchBlockedUserIds = {
                    blockedCalled = true
                    Resource.Success(emptySet())
                },
                fetchConversation = {
                    Resource.Success(Conversation(participantIds = listOf("10000001")))
                },
            )
            assertFalse(blockedCalled, "block-list lookup must never run for group chats")
        }
}
