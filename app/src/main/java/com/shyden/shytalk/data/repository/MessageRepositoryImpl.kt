package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.Message
import com.shyden.shytalk.core.model.MessageType
import com.shyden.shytalk.core.util.Resource
import com.google.firebase.Timestamp
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import java.util.UUID
import javax.inject.Inject

class MessageRepositoryImpl @Inject constructor(
    private val firestore: FirebaseFirestore
) : MessageRepository {

    private fun messagesCollection(roomId: String) =
        firestore.collection("rooms").document(roomId).collection("messages")

    override fun getMessages(roomId: String): Flow<List<Message>> = callbackFlow {
        val listener = messagesCollection(roomId)
            .orderBy("createdAt", Query.Direction.ASCENDING)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    close(error)
                    return@addSnapshotListener
                }
                val messages = snapshot?.documents?.mapNotNull { doc ->
                    doc.data?.let { Message.fromMap(it, doc.id) }
                } ?: emptyList()
                trySend(messages)
            }
        awaitClose { listener.remove() }
    }

    override suspend fun sendMessage(
        roomId: String,
        senderId: String,
        senderName: String,
        text: String
    ): Resource<Unit> {
        return try {
            val messageId = UUID.randomUUID().toString()
            val message = Message(
                messageId = messageId,
                senderId = senderId,
                senderName = senderName,
                text = text,
                createdAt = Timestamp.now(),
                type = MessageType.TEXT
            )
            messagesCollection(roomId).document(messageId).set(message.toMap()).await()
            Resource.Success(Unit)
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to send message", e)
        }
    }

    override suspend fun sendSystemMessage(roomId: String, text: String): Resource<Unit> {
        return try {
            val messageId = UUID.randomUUID().toString()
            val message = Message(
                messageId = messageId,
                senderId = "system",
                senderName = "System",
                text = text,
                createdAt = Timestamp.now(),
                type = MessageType.SYSTEM
            )
            messagesCollection(roomId).document(messageId).set(message.toMap()).await()
            Resource.Success(Unit)
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to send system message", e)
        }
    }

    override suspend fun sendJoinMessage(
        roomId: String,
        senderId: String,
        senderName: String,
        text: String
    ): Resource<Unit> {
        return try {
            val messageId = UUID.randomUUID().toString()
            val message = Message(
                messageId = messageId,
                senderId = senderId,
                senderName = senderName,
                text = text,
                createdAt = Timestamp.now(),
                type = MessageType.JOIN
            )
            messagesCollection(roomId).document(messageId).set(message.toMap()).await()
            Resource.Success(Unit)
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to send join message", e)
        }
    }
}
