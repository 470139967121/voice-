package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.model.RoomState
import com.shyden.shytalk.core.model.Seat
import com.shyden.shytalk.core.model.SeatState
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import com.google.firebase.Timestamp
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.tasks.await
import java.util.UUID
import javax.inject.Inject

class RoomRepositoryImpl @Inject constructor(
    private val firestore: FirebaseFirestore
) : RoomRepository {

    private val roomsCollection = firestore.collection("rooms")

    override fun getActiveRooms(): Flow<List<ChatRoom>> = callbackFlow {
        val listener = roomsCollection
            .whereIn("state", listOf(RoomState.ACTIVE.name, RoomState.OWNER_AWAY.name))
            .limit(Constants.ACTIVE_ROOMS_QUERY_LIMIT)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    close(error)
                    return@addSnapshotListener
                }
                val rooms = snapshot?.documents?.mapNotNull { doc ->
                    doc.data?.let { ChatRoom.fromMap(it, doc.id) }
                } ?: emptyList()
                trySend(rooms)
            }
        awaitClose { listener.remove() }
    }.distinctUntilChanged()

    override fun getRoomFlow(roomId: String): Flow<ChatRoom?> = callbackFlow {
        val listener = roomsCollection.document(roomId)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    close(error)
                    return@addSnapshotListener
                }
                val room = snapshot?.data?.let { ChatRoom.fromMap(it, snapshot.id) }
                trySend(room)
            }
        awaitClose { listener.remove() }
    }.distinctUntilChanged()

    override suspend fun createRoom(name: String, ownerId: String): Resource<String> = firebaseCall("Failed to create room") {
        val roomId = UUID.randomUUID().toString()
        val seats = (0 until Constants.MAX_SEATS).associate { i ->
            i.toString() to if (i == Constants.OWNER_SEAT_INDEX) {
                Seat(userId = ownerId, state = SeatState.OCCUPIED)
            } else {
                Seat()
            }
        }
        val room = ChatRoom(
            roomId = roomId,
            name = name,
            ownerId = ownerId,
            state = RoomState.ACTIVE,
            createdAt = Timestamp.now(),
            participantIds = setOf(ownerId),
            seats = seats,
            agoraChannelName = roomId
        )
        roomsCollection.document(roomId).set(room.toMap()).await()
        roomId
    }

    override suspend fun joinRoom(roomId: String, userId: String): Resource<Unit> = firebaseCall("Failed to join room") {
        roomsCollection.document(roomId).update(
            "participantIds", FieldValue.arrayUnion(userId)
        ).await()
    }

    override suspend fun leaveRoom(roomId: String, userId: String): Resource<Unit> = firebaseCall("Failed to leave room") {
        val docRef = roomsCollection.document(roomId)
        firestore.runTransaction { transaction ->
            val snapshot = transaction.get(docRef)
            val room = snapshot.data?.let { ChatRoom.fromMap(it, snapshot.id) }
                ?: return@runTransaction

            val remaining = room.participantIds - userId

            if (remaining.isEmpty() ||
                (remaining.singleOrNull() == room.ownerId && room.state == RoomState.OWNER_AWAY)) {
                // Room is empty — close it
                val updates = emptySeatsUpdate() + mapOf(
                    "state" to RoomState.CLOSED.name,
                    "closedAt" to Timestamp.now(),
                    "participantIds" to emptyList<String>()
                )
                transaction.update(docRef, updates)
            } else {
                transaction.update(docRef, mapOf(
                    "participantIds" to FieldValue.arrayRemove(userId)
                ))
            }
        }.await()
    }

    override suspend fun takeSeat(roomId: String, seatIndex: Int, userId: String): Resource<Unit> = firebaseCall("Failed to take seat") {
        val docRef = roomsCollection.document(roomId)
        firestore.runTransaction { transaction ->
            val snapshot = transaction.get(docRef)
            val room = snapshot.data?.let { ChatRoom.fromMap(it, snapshot.id) }
                ?: throw Exception("Room not found")

            val updates = clearUserSeats(room, userId)
            updates["seats.$seatIndex"] = Seat(userId = userId, state = SeatState.OCCUPIED).toMap()
            transaction.update(docRef, updates)
        }.await()
    }

    override suspend fun leaveSeat(roomId: String, seatIndex: Int): Resource<Unit> = firebaseCall("Failed to leave seat") {
        roomsCollection.document(roomId).update(
            "seats.$seatIndex", Seat().toMap()
        ).await()
    }

    override suspend fun removeFromSeat(roomId: String, seatIndex: Int): Resource<Unit> {
        return leaveSeat(roomId, seatIndex)
    }

    override suspend fun moveSeat(roomId: String, fromIndex: Int, toIndex: Int, userId: String): Resource<Unit> = firebaseCall("Failed to move seat") {
        roomsCollection.document(roomId).update(
            mapOf(
                "seats.$fromIndex" to Seat().toMap(),
                "seats.$toIndex" to Seat(userId = userId, state = SeatState.OCCUPIED).toMap()
            )
        ).await()
    }

    override suspend fun kickUser(roomId: String, userId: String, seatIndex: Int?): Resource<Unit> = firebaseCall("Failed to kick user") {
        val updates = mutableMapOf<String, Any>(
            "participantIds" to FieldValue.arrayRemove(userId),
            "bannedUserIds" to FieldValue.arrayUnion(userId)
        )
        if (seatIndex != null) {
            updates["seats.$seatIndex"] = Seat().toMap()
        }
        roomsCollection.document(roomId).update(updates).await()
    }

    override suspend fun toggleMute(roomId: String, seatIndex: Int, isMuted: Boolean): Resource<Unit> = firebaseCall("Failed to toggle mute") {
        roomsCollection.document(roomId).update(
            "seats.$seatIndex.isMuted", isMuted
        ).await()
    }

    override suspend fun addHost(roomId: String, userId: String): Resource<Unit> = firebaseCall("Failed to add host") {
        roomsCollection.document(roomId).update(
            "hostIds", FieldValue.arrayUnion(userId)
        ).await()
    }

    override suspend fun removeHost(roomId: String, userId: String): Resource<Unit> = firebaseCall("Failed to remove host") {
        roomsCollection.document(roomId).update(
            "hostIds", FieldValue.arrayRemove(userId)
        ).await()
    }

    override suspend fun setRequireApproval(roomId: String, requireApproval: Boolean): Resource<Unit> = firebaseCall("Failed to update approval setting") {
        roomsCollection.document(roomId).update(
            "requireApproval", requireApproval
        ).await()
    }

    override suspend fun setOwnerAway(roomId: String): Resource<Unit> = firebaseCall("Failed to set owner away") {
        roomsCollection.document(roomId).update(
            mapOf(
                "state" to RoomState.OWNER_AWAY.name,
                "ownerLeftAt" to Timestamp.now()
            )
        ).await()
    }

    override suspend fun setOwnerReturned(roomId: String, ownerId: String): Resource<Unit> = firebaseCall("Failed to set owner returned") {
        val seat = Seat(userId = ownerId, state = SeatState.OCCUPIED)
        roomsCollection.document(roomId).update(
            mapOf(
                "state" to RoomState.ACTIVE.name,
                "ownerLeftAt" to null,
                "seats.${Constants.OWNER_SEAT_INDEX}" to seat.toMap()
            )
        ).await()
    }

    override suspend fun sendInvite(roomId: String, userId: String, invitedBy: String): Resource<Unit> = firebaseCall("Failed to send invite") {
        roomsCollection.document(roomId).update(
            "pendingInvites.$userId", invitedBy
        ).await()
    }

    override suspend fun cancelInvite(roomId: String, userId: String): Resource<Unit> = firebaseCall("Failed to cancel invite") {
        roomsCollection.document(roomId).update(
            "pendingInvites.$userId", FieldValue.delete()
        ).await()
    }

    override suspend fun acceptInvite(roomId: String, userId: String, seatIndex: Int): Resource<Unit> = firebaseCall("Failed to accept invite") {
        val docRef = roomsCollection.document(roomId)
        firestore.runTransaction { transaction ->
            val snapshot = transaction.get(docRef)
            val room = snapshot.data?.let { ChatRoom.fromMap(it, snapshot.id) }
                ?: throw Exception("Room not found")

            val updates = clearUserSeats(room, userId)
            updates["pendingInvites.$userId"] = FieldValue.delete()
            updates["seats.$seatIndex"] = Seat(userId = userId, state = SeatState.OCCUPIED).toMap()
            transaction.update(docRef, updates)
        }.await()
    }

    override suspend fun findActiveRoomByOwner(ownerId: String): String? {
        return try {
            val snapshot = roomsCollection
                .whereEqualTo("ownerId", ownerId)
                .whereIn("state", listOf(RoomState.ACTIVE.name, RoomState.OWNER_AWAY.name))
                .get()
                .await()
            snapshot.documents.firstOrNull()?.id
        } catch (e: Exception) {
            null
        }
    }

    override suspend fun recordFirstJoinTimestamp(roomId: String, userId: String): Resource<Unit> = firebaseCall("Failed to record first join timestamp") {
        val docRef = roomsCollection.document(roomId)
        firestore.runTransaction { transaction ->
            val snapshot = transaction.get(docRef)
            val existing = (snapshot.get("firstJoinTimestamps") as? Map<*, *>)
            if (existing == null || !existing.containsKey(userId)) {
                transaction.update(docRef, "firstJoinTimestamps.$userId", Timestamp.now())
            }
        }.await()
    }

    override suspend fun leaveAllRooms(userId: String, exceptRoomId: String?): Resource<Unit> = firebaseCall("Failed to leave all rooms") {
        val snapshot = roomsCollection
            .whereArrayContains("participantIds", userId)
            .whereIn("state", listOf(RoomState.ACTIVE.name, RoomState.OWNER_AWAY.name))
            .get()
            .await()
        val docsToUpdate = snapshot.documents.filter { it.id != exceptRoomId }
        if (docsToUpdate.isEmpty()) return@firebaseCall

        val batch = firestore.batch()
        for (doc in docsToUpdate) {
            val room = doc.data?.let { ChatRoom.fromMap(it, doc.id) } ?: continue
            val updates = clearUserSeats(room, userId)
            updates["participantIds"] = FieldValue.arrayRemove(userId)
            if (room.ownerId == userId) {
                updates["state"] = RoomState.OWNER_AWAY.name
                updates["ownerLeftAt"] = Timestamp.now()
            }
            batch.update(roomsCollection.document(doc.id), updates)
        }
        batch.commit().await()
    }

    override suspend fun closeAllRoomsByOwner(ownerId: String): Resource<Unit> = firebaseCall("Failed to close rooms") {
        val snapshot = roomsCollection
            .whereEqualTo("ownerId", ownerId)
            .whereIn("state", listOf(RoomState.ACTIVE.name, RoomState.OWNER_AWAY.name))
            .get()
            .await()
        if (snapshot.documents.isEmpty()) return@firebaseCall
        val batch = firestore.batch()
        val closeUpdates = emptySeatsUpdate() + mapOf(
            "state" to RoomState.CLOSED.name,
            "closedAt" to Timestamp.now(),
            "participantIds" to emptyList<String>()
        )
        for (doc in snapshot.documents) {
            batch.update(roomsCollection.document(doc.id), closeUpdates)
        }
        batch.commit().await()
    }

    override suspend fun removeDisconnectedUser(roomId: String, userId: String): Resource<Unit> = firebaseCall("Failed to remove disconnected user") {
        val docRef = roomsCollection.document(roomId)
        firestore.runTransaction { transaction ->
            val snapshot = transaction.get(docRef)
            val room = snapshot.data?.let { ChatRoom.fromMap(it, snapshot.id) }
                ?: throw Exception("Room not found")

            if (userId !in room.participantIds) return@runTransaction

            val updates = clearUserSeats(room, userId)

            val remainingParticipants = room.participantIds - userId

            if (remainingParticipants.isEmpty()) {
                // Room is now empty — close it
                updates.putAll(emptySeatsUpdate())
                updates["state"] = RoomState.CLOSED.name
                updates["closedAt"] = Timestamp.now()
                updates["participantIds"] = emptyList<String>()
            } else if (room.ownerId == userId) {
                updates["state"] = RoomState.OWNER_AWAY.name
                updates["ownerLeftAt"] = Timestamp.now()
            } else {
                updates["participantIds"] = FieldValue.arrayRemove(userId)
                // If only the owner remains and they're away, close the room
                if (remainingParticipants.singleOrNull() == room.ownerId && room.state == RoomState.OWNER_AWAY) {
                    updates.putAll(emptySeatsUpdate())
                    updates["state"] = RoomState.CLOSED.name
                    updates["closedAt"] = Timestamp.now()
                    updates["participantIds"] = emptyList<String>()
                }
            }

            if (updates.isNotEmpty()) {
                transaction.update(docRef, updates)
            }
        }.await()
    }

    override suspend fun closeRoom(roomId: String): Resource<Unit> = firebaseCall("Failed to close room") {
        val updates = emptySeatsUpdate() + mapOf(
            "state" to RoomState.CLOSED.name,
            "closedAt" to Timestamp.now(),
            "participantIds" to emptyList<String>()
        )
        roomsCollection.document(roomId).update(updates).await()
    }

    private fun emptySeatsUpdate(): Map<String, Any> =
        (0 until Constants.MAX_SEATS).associate { i -> "seats.$i" to Seat().toMap() }

    private fun clearUserSeats(room: ChatRoom, userId: String): MutableMap<String, Any> {
        val updates = mutableMapOf<String, Any>()
        for ((idx, seat) in room.seats) {
            if (seat.isOccupiedBy(userId)) {
                updates["seats.$idx"] = Seat().toMap()
            }
        }
        return updates
    }
}
