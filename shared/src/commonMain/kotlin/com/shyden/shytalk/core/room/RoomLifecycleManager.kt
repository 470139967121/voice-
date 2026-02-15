package com.shyden.shytalk.core.room

import com.shyden.shytalk.core.model.ChatRoom
import kotlinx.coroutines.flow.StateFlow

interface RoomLifecycleManager {
    val disconnectedUserIds: StateFlow<Set<String>>
    fun isInRoom(roomId: String): Boolean
    fun trackRoom(roomId: String)
    fun updateTrackedRoom(room: ChatRoom)
    fun untrackRoom()
    fun setRoomScreenVisible(visible: Boolean)
    fun markLeaveStarted(roomId: String)
    fun markLeaveCompleted(roomId: String)
    suspend fun awaitLeaveCompletion(roomId: String)
}
