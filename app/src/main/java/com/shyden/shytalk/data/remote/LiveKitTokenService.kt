package com.shyden.shytalk.data.remote

import com.google.firebase.functions.FirebaseFunctions
import kotlinx.coroutines.tasks.await

/**
 * Fetches LiveKit tokens from a Firebase Cloud Function.
 *
 * The Cloud Function `generateLiveKitToken` should accept:
 *   { roomName: String, identity: String }
 * and return:
 *   { token: String }
 */
class LiveKitTokenService(
    private val functions: FirebaseFunctions = FirebaseFunctions.getInstance()
) : TokenService {

    override suspend fun fetchToken(roomName: String, identity: String): String {
        val data = hashMapOf(
            "roomName" to roomName,
            "identity" to identity
        )
        val result = functions
            .getHttpsCallable("generateLiveKitToken")
            .call(data)
            .await()

        val response = result.getData() as? Map<*, *>
        return response?.get("token") as? String
            ?: throw IllegalStateException("Invalid token response from server")
    }
}
