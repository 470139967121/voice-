package com.shyden.shytalk.core.model

import com.google.firebase.Timestamp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Date

class UserFromMapTest {

    private val ts = Timestamp(Date(1_000_000_000L))

    @Test
    fun `fromMap parses complete valid map`() {
        val map = mapOf<String, Any?>(
            "displayName" to "Alice",
            "avatarUrl" to "https://avatar.png",
            "profilePhotoUrl" to "https://profile.png",
            "coverPhotoUrl" to "https://cover.png",
            "description" to "Hello!",
            "nationality" to "US",
            "uniqueId" to 12345L,
            "blockedUserIds" to listOf("user-2", "user-3"),
            "phoneNumber" to "+1234567890",
            "email" to "alice@example.com",
            "createdAt" to ts,
            "lastSeenAt" to ts
        )
        val user = User.fromMap(map, "user-1")
        assertEquals("user-1", user.uid)
        assertEquals("Alice", user.displayName)
        assertEquals("https://avatar.png", user.avatarUrl)
        assertEquals("https://profile.png", user.profilePhotoUrl)
        assertEquals("https://cover.png", user.coverPhotoUrl)
        assertEquals("Hello!", user.description)
        assertEquals("US", user.nationality)
        assertEquals(12345L, user.uniqueId)
        assertEquals(setOf("user-2", "user-3"), user.blockedUserIds)
        assertEquals("+1234567890", user.phoneNumber)
        assertEquals("alice@example.com", user.email)
        assertEquals(ts, user.createdAt)
        assertEquals(ts, user.lastSeenAt)
    }

    @Test
    fun `fromMap handles empty map with all defaults`() {
        val user = User.fromMap(emptyMap(), "user-1")
        assertEquals("user-1", user.uid)
        assertEquals("", user.displayName)
        assertNull(user.avatarUrl)
        assertNull(user.profilePhotoUrl)
        assertNull(user.coverPhotoUrl)
        assertNull(user.description)
        assertNull(user.nationality)
        assertEquals(0L, user.uniqueId)
        assertEquals(emptySet<String>(), user.blockedUserIds)
        assertNull(user.phoneNumber)
        assertNull(user.email)
    }

    @Test
    fun `fromMap filters non-string items from blockedUserIds`() {
        val map = mapOf<String, Any?>(
            "blockedUserIds" to listOf("user-1", 42, null, "user-2")
        )
        val user = User.fromMap(map, "uid")
        assertEquals(setOf("user-1", "user-2"), user.blockedUserIds)
    }

    @Test
    fun `fromMap defaults blockedUserIds to empty when null`() {
        val map = mapOf<String, Any?>("blockedUserIds" to null)
        val user = User.fromMap(map, "uid")
        assertEquals(emptySet<String>(), user.blockedUserIds)
    }

    @Test
    fun `fromMap defaults uniqueId to 0 when missing`() {
        val user = User.fromMap(emptyMap(), "uid")
        assertEquals(0L, user.uniqueId)
    }

    @Test
    fun `fromMap parses uniqueId from Long`() {
        val map = mapOf<String, Any?>("uniqueId" to 99999999L)
        val user = User.fromMap(map, "uid")
        assertEquals(99999999L, user.uniqueId)
    }

    @Test
    fun `photoUrl prefers profilePhotoUrl over avatarUrl`() {
        val user = User(profilePhotoUrl = "https://profile.png", avatarUrl = "https://avatar.png")
        assertEquals("https://profile.png", user.photoUrl)
    }

    @Test
    fun `photoUrl falls back to avatarUrl when profilePhotoUrl is null`() {
        val user = User(profilePhotoUrl = null, avatarUrl = "https://avatar.png")
        assertEquals("https://avatar.png", user.photoUrl)
    }

    @Test
    fun `photoUrl returns null when both are null`() {
        val user = User(profilePhotoUrl = null, avatarUrl = null)
        assertNull(user.photoUrl)
    }

    @Test
    fun `fromMap parses hideFollowing and hideOnlineStatus`() {
        val map = mapOf<String, Any?>(
            "hideFollowing" to true,
            "hideOnlineStatus" to true
        )
        val user = User.fromMap(map, "uid")
        assertTrue(user.hideFollowing)
        assertTrue(user.hideOnlineStatus)
    }

    @Test
    fun `fromMap defaults hideFollowing and hideOnlineStatus to false`() {
        val user = User.fromMap(emptyMap(), "uid")
        assertFalse(user.hideFollowing)
        assertFalse(user.hideOnlineStatus)
    }

    @Test
    fun `fromMap parses dateOfBirth`() {
        val dob = Timestamp(Date(946684800000L))
        val map = mapOf<String, Any?>("dateOfBirth" to dob)
        val user = User.fromMap(map, "uid")
        assertEquals(dob, user.dateOfBirth)
    }

    @Test
    fun `fromMap defaults dateOfBirth to null`() {
        val user = User.fromMap(emptyMap(), "uid")
        assertNull(user.dateOfBirth)
    }

    @Test
    fun `fromMap parses hideAge`() {
        val map = mapOf<String, Any?>("hideAge" to true)
        val user = User.fromMap(map, "uid")
        assertTrue(user.hideAge)
    }

    @Test
    fun `fromMap defaults hideAge to false`() {
        val user = User.fromMap(emptyMap(), "uid")
        assertFalse(user.hideAge)
    }

    @Test
    fun `fromMap of toMap produces equivalent user`() {
        val original = User(
            uid = "user-1",
            displayName = "Alice",
            avatarUrl = "https://avatar.png",
            profilePhotoUrl = "https://profile.png",
            coverPhotoUrl = "https://cover.png",
            description = "Hello!",
            nationality = "US",
            uniqueId = 12345L,
            blockedUserIds = setOf("user-2", "user-3"),
            dateOfBirth = ts,
            hideFollowing = true,
            hideOnlineStatus = true,
            hideAge = true,
            phoneNumber = "+1234567890",
            email = "alice@example.com",
            createdAt = ts,
            lastSeenAt = ts
        )
        val roundtripped = User.fromMap(original.toMap(), "user-1")
        assertEquals(original, roundtripped)
    }
}
