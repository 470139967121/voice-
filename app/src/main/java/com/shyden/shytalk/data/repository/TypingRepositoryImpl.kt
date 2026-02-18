package com.shyden.shytalk.data.repository

import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseError
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.database.ValueEventListener
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow

class TypingRepositoryImpl(
    private val database: FirebaseDatabase
) : TypingRepository {

    override fun setTyping(conversationId: String, userId: String, isTyping: Boolean) {
        val ref = database.reference
            .child("typing")
            .child(conversationId)
            .child(userId)

        if (isTyping) {
            ref.setValue(true)
            ref.onDisconnect().removeValue()
        } else {
            ref.removeValue()
        }
    }

    override fun observeTyping(conversationId: String, otherUserId: String): Flow<Boolean> = callbackFlow {
        val ref = database.reference
            .child("typing")
            .child(conversationId)
            .child(otherUserId)

        val listener = object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                val typing = snapshot.getValue(Boolean::class.java) ?: false
                trySend(typing)
            }

            override fun onCancelled(error: DatabaseError) {
                close(error.toException())
            }
        }

        ref.addValueEventListener(listener)
        awaitClose { ref.removeEventListener(listener) }
    }
}
