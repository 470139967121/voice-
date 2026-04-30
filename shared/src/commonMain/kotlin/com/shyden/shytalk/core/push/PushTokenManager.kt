package com.shyden.shytalk.core.push

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.logE
import com.shyden.shytalk.data.repository.NotificationRepository
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class PushTokenManager(
    private val bridgeProvider: () -> PushTokenBridge?,
    private val notificationRepo: NotificationRepository,
) {
    private val mutex = Mutex()

    suspend fun syncToken(userId: String) {
        mutex.withLock {
            val bridge = bridgeProvider() ?: return
            val current = bridge.currentFcmToken() ?: return
            if (bridge.lastRegisteredToken() == current) return
            when (val result = notificationRepo.saveFcmToken(userId, current)) {
                is Resource.Success -> bridge.setLastRegisteredToken(current)

                is Resource.Error -> {
                    // Don't update lastRegisteredToken — a later trigger (sign-in,
                    // foreground retry) will re-attempt with the same currentToken.
                    // logE so backend / network failures surface in telemetry —
                    // a silent swallow here would hide a class of "user mysteriously
                    // stops receiving notifications" bugs.
                    logE(TAG, "saveFcmToken failed for userId=$userId: ${result.message}")
                }

                is Resource.Loading -> Unit // suspending fn — Loading is not emitted by repo impl
            }
        }
    }

    suspend fun clearToken(userId: String) {
        mutex.withLock {
            val bridge = bridgeProvider() ?: return
            val last = bridge.lastRegisteredToken() ?: return
            when (val result = notificationRepo.removeFcmToken(userId, last)) {
                is Resource.Success -> bridge.setLastRegisteredToken(null)

                is Resource.Error -> {
                    // Keep lastRegisteredToken so a later sign-in cycle won't
                    // accidentally re-register the same token under the wrong user
                    // (and the next remove attempt still has the value to delete).
                    logE(TAG, "removeFcmToken failed for userId=$userId: ${result.message}")
                }

                is Resource.Loading -> Unit
            }
        }
    }

    private companion object {
        const val TAG = "PushTokenManager"
    }
}
