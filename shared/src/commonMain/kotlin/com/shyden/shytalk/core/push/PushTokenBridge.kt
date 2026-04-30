package com.shyden.shytalk.core.push

interface PushTokenBridge {
    fun currentFcmToken(): String?

    fun lastRegisteredToken(): String?

    fun setLastRegisteredToken(token: String?)
}
