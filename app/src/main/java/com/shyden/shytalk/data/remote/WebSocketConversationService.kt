package com.shyden.shytalk.data.remote

import android.util.Log
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Android WebSocket implementation for real-time conversation events.
 * Mirrors WebSocketPresenceService patterns (reconnect, auth token, etc).
 */
class WebSocketConversationService(
    private val httpClient: OkHttpClient,
    private val baseUrl: String,
    private val auth: FirebaseAuth
) : ConversationWebSocketService {

    companion object {
        private const val TAG = "WsConversationService"
        private const val PING_INTERVAL_MS = 30_000L
        private const val RECONNECT_DELAY_MS = 3_000L
        private const val MAX_RECONNECT_ATTEMPTS = 5
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private var currentWebSocket: WebSocket? = null
    private var currentConversationId: String? = null
    private var currentUserId: String? = null
    private var reconnectAttempts = 0
    private var shouldReconnect = false

    private val _events = MutableSharedFlow<ConversationEvent>(extraBufferCapacity = 16)
    override val events: Flow<ConversationEvent> = _events

    override fun connect(conversationId: String, userId: String) {
        if (currentConversationId != null && currentConversationId != conversationId) {
            disconnect()
        }

        currentConversationId = conversationId
        currentUserId = userId
        shouldReconnect = true
        reconnectAttempts = 0

        scope.launch { connectWebSocket(conversationId, userId) }
        Log.d(TAG, "Connecting to conversation=$conversationId user=$userId")
    }

    override fun disconnect() {
        shouldReconnect = false
        val convId = currentConversationId

        currentWebSocket?.close(1000, "Leaving conversation")
        currentWebSocket = null
        currentConversationId = null
        currentUserId = null
        reconnectAttempts = 0

        Log.d(TAG, "Disconnected from conversation=$convId")
    }

    override fun sendTyping(isTyping: Boolean) {
        val ws = currentWebSocket ?: return
        val msg = JSONObject().apply {
            put("type", if (isTyping) "typing_start" else "typing_stop")
        }
        try {
            ws.send(msg.toString())
        } catch (e: Exception) {
            Log.w(TAG, "Failed to send typing state", e)
        }
    }

    private suspend fun connectWebSocket(conversationId: String, userId: String) {
        val token = try {
            auth.currentUser?.getIdToken(false)?.await()?.token
                ?: throw IllegalStateException("Not signed in")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to get auth token", e)
            scheduleReconnect(conversationId, userId)
            return
        }

        val wsUrl = baseUrl
            .replace("https://", "wss://")
            .replace("http://", "ws://")

        val request = Request.Builder()
            .url("$wsUrl/api/conversations/$conversationId/ws")
            .header("Authorization", "Bearer $token")
            .build()

        val wsClient = httpClient.newBuilder()
            .pingInterval(PING_INTERVAL_MS, TimeUnit.MILLISECONDS)
            .build()

        currentWebSocket = wsClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.d(TAG, "WebSocket connected for conversation=$conversationId")
                reconnectAttempts = 0
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handleMessage(text)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "WebSocket closing: code=$code reason=$reason")
                webSocket.close(1000, null)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "WebSocket closed: code=$code reason=$reason")
                if (currentWebSocket === webSocket) {
                    currentWebSocket = null
                    if (shouldReconnect) {
                        scope.launch { scheduleReconnect(conversationId, userId) }
                    }
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.w(TAG, "WebSocket failure: ${t.message}")
                if (currentWebSocket === webSocket) {
                    currentWebSocket = null
                    if (shouldReconnect) {
                        scope.launch { scheduleReconnect(conversationId, userId) }
                    }
                }
            }
        })
    }

    private suspend fun scheduleReconnect(conversationId: String, userId: String) {
        if (!shouldReconnect || reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            Log.w(TAG, "Giving up reconnection after $reconnectAttempts attempts")
            return
        }

        reconnectAttempts++
        val delayMs = RECONNECT_DELAY_MS * reconnectAttempts
        Log.d(TAG, "Reconnecting in ${delayMs}ms (attempt $reconnectAttempts)")
        delay(delayMs)

        if (shouldReconnect && currentConversationId == conversationId) {
            connectWebSocket(conversationId, userId)
        }
    }

    private fun handleMessage(text: String) {
        try {
            val json = JSONObject(text)
            when (json.optString("type")) {
                "pong" -> { /* keep-alive response, ignore */ }

                "new_message" -> {
                    _events.tryEmit(ConversationEvent.NewMessage)
                }

                "typing" -> {
                    val userId = json.optString("userId")
                    val isTyping = json.optBoolean("isTyping", false)
                    _events.tryEmit(ConversationEvent.Typing(userId, isTyping))
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to parse WebSocket message: $text", e)
        }
    }
}
