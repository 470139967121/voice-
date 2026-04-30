package com.shyden.shytalk.core.push

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

data class PushDeepLink(
    val otherUserId: String,
    val conversationId: String,
    val isGroup: Boolean,
)

private val pendingChatDeepLink = MutableStateFlow<PushDeepLink?>(null)

/** Latest pending chat deep link from a notification tap, or null if none. The
 *  consumer (MainViewController) collects this StateFlow, navigates on a non-null
 *  value, then calls [consumeChatDeepLink] to clear it. Using a nullable StateFlow
 *  (vs SharedFlow with replay) means a re-subscription after sign-out / NavGraph
 *  recreation does NOT re-fire a stale link from a previous user session. */
val chatDeepLinks: StateFlow<PushDeepLink?> = pendingChatDeepLink.asStateFlow()

/** Called from Swift (AppDelegate) when the user taps a notification.
 *  Top-level so the auto-emitted Swift symbol is `PushDeepLinkBusKt.emitChatDeepLink(...)`. */
fun emitChatDeepLink(
    otherUserId: String,
    conversationId: String,
    isGroup: Boolean,
) {
    pendingChatDeepLink.value = PushDeepLink(otherUserId, conversationId, isGroup)
}

/** Called by the consumer after navigating to clear the pending link.
 *  Idempotent — clearing twice is safe. */
fun consumeChatDeepLink() {
    pendingChatDeepLink.update { null }
}
