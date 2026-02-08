package com.example.shytalk.data.repository

import com.example.shytalk.core.model.ChatRoom
import com.example.shytalk.core.model.Seat
import com.example.shytalk.core.model.SeatState
import com.example.shytalk.core.util.Resource
import kotlinx.coroutines.flow.Flow

interface RoomRepository {
    fun getActiveRooms(): Flow<List<ChatRoom>>
    fun getRoomFlow(roomId: String): Flow<ChatRoom?>
    suspend fun createRoom(name: String, ownerId: String): Resource<String>
    suspend fun joinRoom(roomId: String, userId: String): Resource<Unit>
    suspend fun leaveRoom(roomId: String, userId: String): Resource<Unit>
    suspend fun takeSeat(roomId: String, seatIndex: Int, userId: String): Resource<Unit>
    suspend fun leaveSeat(roomId: String, seatIndex: Int): Resource<Unit>
    suspend fun removeFromSeat(roomId: String, seatIndex: Int): Resource<Unit>
    suspend fun moveSeat(roomId: String, fromIndex: Int, toIndex: Int, userId: String): Resource<Unit>
    suspend fun kickUser(roomId: String, userId: String, seatIndex: Int?): Resource<Unit>
    suspend fun toggleMute(roomId: String, seatIndex: Int, isMuted: Boolean): Resource<Unit>
    suspend fun addHost(roomId: String, userId: String): Resource<Unit>
    suspend fun removeHost(roomId: String, userId: String): Resource<Unit>
    suspend fun setRequireApproval(roomId: String, requireApproval: Boolean): Resource<Unit>
    suspend fun setOwnerAway(roomId: String): Resource<Unit>
    suspend fun setOwnerReturned(roomId: String, ownerId: String): Resource<Unit>
    suspend fun sendInvite(roomId: String, userId: String, invitedBy: String): Resource<Unit>
    suspend fun cancelInvite(roomId: String, userId: String): Resource<Unit>
    suspend fun acceptInvite(roomId: String, userId: String, seatIndex: Int): Resource<Unit>
    suspend fun closeRoom(roomId: String): Resource<Unit>
    suspend fun findActiveRoomByOwner(ownerId: String): String?
}
