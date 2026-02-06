package com.example.shytalk.data.repository

import com.example.shytalk.core.model.SeatRequest
import com.example.shytalk.core.util.Resource
import kotlinx.coroutines.flow.Flow

interface SeatRequestRepository {
    fun getPendingRequests(roomId: String): Flow<List<SeatRequest>>
    suspend fun createRequest(roomId: String, userId: String, userName: String, seatIndex: Int): Resource<Unit>
    suspend fun approveRequest(roomId: String, requestId: String, resolvedBy: String): Resource<SeatRequest>
    suspend fun denyRequest(roomId: String, requestId: String, resolvedBy: String): Resource<Unit>
}
