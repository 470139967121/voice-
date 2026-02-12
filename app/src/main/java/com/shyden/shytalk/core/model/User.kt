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
    val blockedUserIds: Set<String> = emptySet(),
    val followingIds: Set<String> = emptySet(),
    val followerIds: Set<String> = emptySet(),
    val dateOfBirth: Timestamp? = null,
    val hideFollowing: Boolean = false,
    val hideOnlineStatus: Boolean = false,
    val hideAge: Boolean = false,
    val phoneNumber: String? = null,
    val email: String? = null,
    val createdAt: Timestamp = Timestamp.now(),
    val lastSeenAt: Timestamp = Timestamp.now()
) {
    /** Resolved photo URL: prefers profilePhotoUrl, falls back to avatarUrl. */
    val photoUrl: String? get() = profilePhotoUrl ?: avatarUrl

    fun toMap(): Map<String, Any?> = mapOf(
        "uid" to uid,
        "displayName" to displayName,
        "avatarUrl" to avatarUrl,
        "profilePhotoUrl" to profilePhotoUrl,
        "coverPhotoUrl" to coverPhotoUrl,
        "description" to description,
        "nationality" to nationality,
        "uniqueId" to uniqueId,
        "blockedUserIds" to blockedUserIds.toList(),
        "followingIds" to followingIds.toList(),
        "followerIds" to followerIds.toList(),
        "dateOfBirth" to dateOfBirth,
        "hideFollowing" to hideFollowing,
        "hideOnlineStatus" to hideOnlineStatus,
        "hideAge" to hideAge,
        "phoneNumber" to phoneNumber,
        "email" to email,
        "createdAt" to createdAt,
        "lastSeenAt" to lastSeenAt
    )

    companion object {
        fun fromMap(map: Map<String, Any?>, uid: String): User = User(
            uid = uid,
            displayName = map["displayName"] as? String ?: "",
            avatarUrl = map["avatarUrl"] as? String,
            profilePhotoUrl = map["profilePhotoUrl"] as? String,
            coverPhotoUrl = map["coverPhotoUrl"] as? String,
            description = map["description"] as? String,
            nationality = map["nationality"] as? String,
            uniqueId = (map["uniqueId"] as? Long) ?: 0L,
            blockedUserIds = (map["blockedUserIds"] as? List<*>)
                ?.filterIsInstance<String>()?.toSet() ?: emptySet(),
            followingIds = (map["followingIds"] as? List<*>)
                ?.filterIsInstance<String>()?.toSet() ?: emptySet(),
            followerIds = (map["followerIds"] as? List<*>)
                ?.filterIsInstance<String>()?.toSet() ?: emptySet(),
            dateOfBirth = map["dateOfBirth"] as? Timestamp,
            hideFollowing = map["hideFollowing"] as? Boolean ?: false,
            hideOnlineStatus = map["hideOnlineStatus"] as? Boolean ?: false,
            hideAge = map["hideAge"] as? Boolean ?: false,
            phoneNumber = map["phoneNumber"] as? String,
            email = map["email"] as? String,
            createdAt = map["createdAt"] as? Timestamp ?: Timestamp.now(),
            lastSeenAt = map["lastSeenAt"] as? Timestamp ?: Timestamp.now()
        )
    }
}
