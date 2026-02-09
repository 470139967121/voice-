package com.shyden.shytalk.core.model

import com.google.firebase.Timestamp

data class User(
    val uid: String = "",
    val displayName: String = "",
    val avatarUrl: String? = null,
    val profilePhotoUrl: String? = null,
    val coverPhotoUrl: String? = null,
    val description: String? = null,
    val nationality: String? = null,
    val uniqueId: Long = 0L,
    val blockedUserIds: List<String> = emptyList(),
    val phoneNumber: String? = null,
    val email: String? = null,
    val createdAt: Timestamp = Timestamp.now(),
    val lastSeenAt: Timestamp = Timestamp.now()
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "uid" to uid,
        "displayName" to displayName,
        "avatarUrl" to avatarUrl,
        "profilePhotoUrl" to profilePhotoUrl,
        "coverPhotoUrl" to coverPhotoUrl,
        "description" to description,
        "nationality" to nationality,
        "uniqueId" to uniqueId,
        "blockedUserIds" to blockedUserIds,
        "phoneNumber" to phoneNumber,
        "email" to email,
        "createdAt" to createdAt,
        "lastSeenAt" to lastSeenAt
    )
}
