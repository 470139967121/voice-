package com.shyden.shytalk.core.push

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

@OptIn(ExperimentalCoroutinesApi::class)
class PushDeepLinkBusTest {
    @AfterTest
    fun cleanup() {
        // Bus state is process-global — clear between tests.
        consumeChatDeepLink()
    }

    @Test
    fun emit_setsPendingLink() =
        runTest {
            emitChatDeepLink(otherUserId = "user-1", conversationId = "conv-1", isGroup = false)
            assertEquals(
                PushDeepLink(otherUserId = "user-1", conversationId = "conv-1", isGroup = false),
                chatDeepLinks.value,
            )
        }

    @Test
    fun emit_overwritesPreviousLink() =
        runTest {
            emitChatDeepLink(otherUserId = "user-1", conversationId = "conv-1", isGroup = false)
            emitChatDeepLink(otherUserId = "user-2", conversationId = "conv-2", isGroup = true)
            assertEquals(
                PushDeepLink(otherUserId = "user-2", conversationId = "conv-2", isGroup = true),
                chatDeepLinks.value,
            )
        }

    @Test
    fun consume_clearsPendingLink() =
        runTest {
            emitChatDeepLink(otherUserId = "user-1", conversationId = "conv-1", isGroup = false)
            consumeChatDeepLink()
            assertNull(chatDeepLinks.value)
        }

    @Test
    fun consume_isIdempotent() =
        runTest {
            consumeChatDeepLink()
            consumeChatDeepLink()
            assertNull(chatDeepLinks.value)
        }

    @Test
    fun afterConsume_lateSubscriberSeesNoStaleLink() =
        runTest {
            // The CRITICAL bug from the review: a SharedFlow with replay = 1 would
            // re-fire to a late subscriber after sign-out. With StateFlow + consume,
            // the late subscriber sees `null` and skips navigation.
            emitChatDeepLink(otherUserId = "user-A", conversationId = "conv-A", isGroup = false)
            consumeChatDeepLink()
            // Simulate a re-subscribe (e.g. NavGraph recreated after sign-out).
            // The current value is what a late collector sees first.
            assertNull(chatDeepLinks.value, "Late subscriber must NOT see a previous user's deep link")
        }
}
