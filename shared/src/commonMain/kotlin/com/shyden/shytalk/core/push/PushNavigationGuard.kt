package com.shyden.shytalk.core.push

import com.shyden.shytalk.core.model.Conversation
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.logE
import com.shyden.shytalk.core.util.logW
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Single source of truth for push deep-link authorisation. Both Android
 * (`MainActivity.LaunchedEffect`) and iOS (`MainViewController.LaunchedEffect`)
 * call [verifyPushNavigation] before navigating from a notification tap, so the
 * platforms cannot drift on the security check.
 *
 * The check runs three gates in order, all fail-closed:
 *   1. **Identity gate** — caller must pass a non-empty resolved uniqueId
 *      (NOT the raw Firebase UID — block lookups would silently no-op against
 *      `users/{firebaseUid}` which doesn't exist).
 *   2. **Block-list gate** — for private chats, the target uniqueId must not
 *      be in the current user's blocked set. `Resource.Error`/`Loading` are
 *      both treated as fail-closed so a transient backend issue can't leak
 *      a chat-header flash.
 *   3. **Conversation-membership gate** — for groups, the conversation read
 *      must succeed AND list the current user as a participant. Firestore
 *      rules also enforce this server-side, but checking client-side first
 *      avoids the navigation-flash leak (target conversation name / photo
 *      header rendering before the rule denies the message read).
 *
 * Each lookup is wrapped in [withTimeoutOrNull] so a stalled network can't
 * pin the deep-link coroutine indefinitely. A null timeout result is itself
 * fail-closed.
 *
 * Lookups are passed as suspending lambdas (rather than the repository
 * interfaces) so this helper is trivially mockable from commonTest without
 * having to stub 80+ methods across both repository contracts.
 *
 * @return `true` if the navigation may proceed, `false` if it must be dropped.
 */
private const val TAG = "PushNavGuard"
private const val LOOKUP_TIMEOUT_MS = 5_000L

suspend fun verifyPushNavigation(
    currentUserId: String,
    targetId: String,
    isGroup: Boolean,
    fetchBlockedUserIds: suspend (userId: String) -> Resource<Set<String>>,
    fetchConversation: suspend (conversationId: String) -> Resource<Conversation>,
): Boolean {
    if (currentUserId.isEmpty()) {
        logW(TAG, "Push deep-link dropped — empty currentUserId")
        return false
    }
    return if (isGroup) {
        verifyGroupConversationAccess(
            currentUserId = currentUserId,
            conversationId = targetId,
            fetchConversation = fetchConversation,
        )
    } else {
        verifyNotBlocked(
            currentUserId = currentUserId,
            otherUserId = targetId,
            fetchBlockedUserIds = fetchBlockedUserIds,
        )
    }
}

private suspend fun verifyNotBlocked(
    currentUserId: String,
    otherUserId: String,
    fetchBlockedUserIds: suspend (String) -> Resource<Set<String>>,
): Boolean {
    val result =
        withTimeoutOrNull(LOOKUP_TIMEOUT_MS) {
            fetchBlockedUserIds(currentUserId)
        }
    return when (result) {
        is Resource.Success -> {
            if (result.data.contains(otherUserId)) {
                logW(TAG, "Push deep-link dropped — target user is blocked")
                false
            } else {
                true
            }
        }

        is Resource.Error -> {
            logE(TAG, "Push deep-link dropped — block-status check failed: ${result.message}")
            false
        }

        is Resource.Loading -> {
            // Loading is not expected from a suspending one-shot repo call. If
            // a fake / future implementation does emit it, fail closed rather
            // than silently letting navigation proceed.
            logE(TAG, "Push deep-link dropped — block-status check returned Loading (unexpected)")
            false
        }

        null -> {
            logE(TAG, "Push deep-link dropped — block-status check timed out after ${LOOKUP_TIMEOUT_MS}ms")
            false
        }
    }
}

private suspend fun verifyGroupConversationAccess(
    currentUserId: String,
    conversationId: String,
    fetchConversation: suspend (String) -> Resource<Conversation>,
): Boolean {
    val result =
        withTimeoutOrNull(LOOKUP_TIMEOUT_MS) {
            fetchConversation(conversationId)
        }
    return when (result) {
        is Resource.Success -> {
            val isParticipant = result.data.participantIds.contains(currentUserId)
            if (!isParticipant) {
                logW(TAG, "Push deep-link dropped — current user not in conversation participants")
            }
            isParticipant
        }

        is Resource.Error -> {
            logE(TAG, "Push deep-link dropped — conversation read failed: ${result.message}")
            false
        }

        is Resource.Loading -> {
            logE(TAG, "Push deep-link dropped — conversation read returned Loading (unexpected)")
            false
        }

        null -> {
            logE(TAG, "Push deep-link dropped — conversation read timed out after ${LOOKUP_TIMEOUT_MS}ms")
            false
        }
    }
}
