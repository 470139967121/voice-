package com.example.shytalk.data.repository

import com.example.shytalk.core.model.Message
import com.example.shytalk.core.model.MessageType
import com.example.shytalk.core.util.Resource
import kotlinx.coroutines.flow.Flow

interface MessageRepository {
    fun getMessages(roomId: String): Flow<List<Message>>
    suspend fun sendMessage(roomId: String, senderId: String, senderName: String, text: String): Resource<Unit>
    suspend fun sendSystemMessage(roomId: String, text: String): Resource<Unit>
}
