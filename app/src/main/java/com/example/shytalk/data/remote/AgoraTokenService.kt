package com.example.shytalk.data.remote

import com.google.firebase.functions.FirebaseFunctions
import kotlinx.coroutines.tasks.await
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Fetches Agora RTC tokens from a Firebase Cloud Function.
 *
 * The Cloud Function `generateAgoraToken` should accept:
 *   { channelName: String, uid: Int }
 * and return:
 *   { token: String }
 *
 * Prerequisites:
 * 1. Deploy the `generateAgoraToken` Cloud Function
 * 2. Set Agora App ID and Certificate in Cloud Function config
 */
@Singleton
class AgoraTokenService @Inject constructor() {

    private val functions = FirebaseFunctions.getInstance()

    suspend fun fetchToken(channelName: String, uid: Int): String {
        val data = hashMapOf(
            "channelName" to channelName,
            "uid" to uid
        )
        val result = functions
            .getHttpsCallable("generateAgoraToken")
            .call(data)
            .await()

        val response = result.getData() as? Map<*, *>
        return response?.get("token") as? String
            ?: throw IllegalStateException("Invalid token response from server")
    }
}
