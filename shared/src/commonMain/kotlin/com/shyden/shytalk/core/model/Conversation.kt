package com.shyden.shytalk.core.model

import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.millisToTimestamp
import com.shyden.shytalk.core.util.timestampToMillis

data class ConversationPreview(
    val text: String = "",
    val senderId: String = "",
    val senderName: String = "",
    val createdAt: Long = currentTimeMillis(),
    val type: String = "TEXT"
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "text" to text,
        "senderId" to senderId,
        "senderName" to senderName,
        "createdAt" to millisToTimestamp(createdAt),
        "type" to type
    )

    companion object {
        fun fromMap(map: Map<String, Any?>): ConversationPreview = ConversationPreview(
            text = map["text"] as? String ?: "",
            senderId = map["senderId"] as? String ?: "",
            senderName = map["senderName"] as? String ?: "",
            createdAt = timestampToMillis(map["createdAt"]),
            type = map["type"] as? String ?: "TEXT"
        )
    }
}

data class Conversation(
    val conversationId: String = "",
    val participantIds: List<String> = emptyList(),
    val lastMessage: ConversationPreview? = null,
    val lastMessageAt: Long = currentTimeMillis(),
    val createdAt: Long = currentTimeMillis(),
    // Group chat fields (all default to 1-on-1 behavior)
    val isGroup: Boolean = false,
    val groupName: String? = null,
    val groupPhotoUrl: String? = null,
    val groupAdminIds: List<String> = emptyList(),
    val createdBy: String? = null
) {
    val isOneOnOne: Boolean get() = !isGroup

    fun otherUserId(currentUid: String): String? =
        participantIds.firstOrNull { it != currentUid }

    fun isAdmin(userId: String): Boolean =
        groupAdminIds.contains(userId) || createdBy == userId

    fun toMap(): Map<String, Any?> = buildMap {
        put("conversationId", conversationId)
        put("participantIds", participantIds)
        put("lastMessage", lastMessage?.toMap())
        put("lastMessageAt", millisToTimestamp(lastMessageAt))
        put("createdAt", millisToTimestamp(createdAt))
        put("isGroup", isGroup)
        if (isGroup) {
            put("groupName", groupName)
            put("groupPhotoUrl", groupPhotoUrl)
            put("groupAdminIds", groupAdminIds)
            put("createdBy", createdBy)
        }
    }

    companion object {
        fun generateId(uid1: String, uid2: String): String =
            listOf(uid1, uid2).sorted().joinToString("_")

        fun fromMap(map: Map<String, Any?>, conversationId: String): Conversation = Conversation(
            conversationId = conversationId,
            participantIds = (map["participantIds"] as? List<*>)
                ?.filterIsInstance<String>() ?: emptyList(),
            lastMessage = (map["lastMessage"] as? Map<*, *>)?.let { raw ->
                ConversationPreview.fromMap(
                    raw.entries.associate { (k, v) -> k.toString() to v }
                )
            },
            lastMessageAt = timestampToMillis(map["lastMessageAt"]),
            createdAt = timestampToMillis(map["createdAt"]),
            isGroup = map["isGroup"] as? Boolean ?: false,
            groupName = map["groupName"] as? String,
            groupPhotoUrl = map["groupPhotoUrl"] as? String,
            groupAdminIds = (map["groupAdminIds"] as? List<*>)
                ?.filterIsInstance<String>() ?: emptyList(),
            createdBy = map["createdBy"] as? String
        )
    }
}
