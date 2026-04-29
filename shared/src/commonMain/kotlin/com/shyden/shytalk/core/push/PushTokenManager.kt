package com.shyden.shytalk.core.push

import com.shyden.shytalk.core.util.Resource
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
            val result = notificationRepo.saveFcmToken(userId, current)
            if (result is Resource.Success) {
                bridge.setLastRegisteredToken(current)
            }
        }
    }

    suspend fun clearToken(userId: String) {
        mutex.withLock {
            val bridge = bridgeProvider() ?: return
            val last = bridge.lastRegisteredToken() ?: return
            val result = notificationRepo.removeFcmToken(userId, last)
            if (result is Resource.Success) {
                bridge.setLastRegisteredToken(null)
            }
        }
    }
}
