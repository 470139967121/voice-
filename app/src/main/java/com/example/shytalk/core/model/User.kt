package com.example.shytalk.core.model

import com.google.firebase.Timestamp

data class User(
    val uid: String = "",
    val displayName: String = "",
    val avatarUrl: String? = null,
    val phoneNumber: String? = null,
    val email: String? = null,
    val createdAt: Timestamp = Timestamp.now(),
    val lastSeenAt: Timestamp = Timestamp.now()
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "uid" to uid,
        "displayName" to displayName,
        "avatarUrl" to avatarUrl,
        "phoneNumber" to phoneNumber,
        "email" to email,
        "createdAt" to createdAt,
        "lastSeenAt" to lastSeenAt
    )
}
