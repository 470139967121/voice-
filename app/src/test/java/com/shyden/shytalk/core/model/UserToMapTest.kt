package com.shyden.shytalk.core.model

import com.google.firebase.Timestamp
import com.shyden.shytalk.testutil.TestData
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Date

class UserToMapTest {

    @Test
    fun `toMap contains all fields`() {
        val user = TestData.createTestUser(
            uid = "u1",
            displayName = "Alice",
            blockedUserIds = setOf("b1", "b2"),
            profilePhotoUrl = "https://example.com/photo.jpg",
            coverPhotoUrl = "https://example.com/cover.jpg",
            uniqueId = 99999L
        )
        val map = user.toMap()

        assertEquals("u1", map["uid"])
        assertEquals("Alice", map["displayName"])
        assertEquals(listOf("b1", "b2"), map["blockedUserIds"])
        assertEquals("https://example.com/photo.jpg", map["profilePhotoUrl"])
        assertEquals("https://example.com/cover.jpg", map["coverPhotoUrl"])
        assertEquals(99999L, map["uniqueId"])
    }

    @Test
    fun `toMap includes null optional fields`() {
        val user = User(
            uid = "u1",
            displayName = "Bob",
            createdAt = TestData.BASE_TIMESTAMP,
            lastSeenAt = TestData.BASE_TIMESTAMP
        )
        val map = user.toMap()

        assertNull(map["avatarUrl"])
        assertNull(map["profilePhotoUrl"])
        assertNull(map["coverPhotoUrl"])
        assertNull(map["description"])
        assertNull(map["nationality"])
        assertNull(map["phoneNumber"])
        assertNull(map["email"])
    }

    @Test
    fun `toMap preserves Timestamp values`() {
        val ts = Timestamp(Date(1_500_000_000_000L))
        val user = User(uid = "u1", displayName = "X", createdAt = ts, lastSeenAt = ts)
        val map = user.toMap()

        assertEquals(ts, map["createdAt"])
        assertEquals(ts, map["lastSeenAt"])
    }

    @Test
    fun `toMap serializes empty blocked list`() {
        val user = TestData.createTestUser(blockedUserIds = emptySet())
        val map = user.toMap()
        assertEquals(emptyList<String>(), map["blockedUserIds"])
    }

    @Test
    fun `toMap contains exactly 19 keys`() {
        val user = TestData.createTestUser()
        val map = user.toMap()
        assertEquals(19, map.size)
    }

    @Test
    fun `toMap keys match expected field names`() {
        val expectedKeys = setOf(
            "uid", "displayName", "avatarUrl", "profilePhotoUrl", "coverPhotoUrl",
            "description", "nationality", "uniqueId", "blockedUserIds",
            "followingIds", "followerIds", "dateOfBirth", "hideFollowing",
            "hideOnlineStatus", "hideAge", "phoneNumber", "email",
            "createdAt", "lastSeenAt"
        )
        val user = TestData.createTestUser()
        assertEquals(expectedKeys, user.toMap().keys)
    }

    @Test
    fun `toMap includes privacy fields`() {
        val user = User(hideFollowing = true, hideOnlineStatus = true, hideAge = true)
        val map = user.toMap()
        assertEquals(true, map["hideFollowing"])
        assertEquals(true, map["hideOnlineStatus"])
        assertEquals(true, map["hideAge"])
    }

    @Test
    fun `toMap defaults privacy fields to false`() {
        val user = User()
        val map = user.toMap()
        assertEquals(false, map["hideFollowing"])
        assertEquals(false, map["hideOnlineStatus"])
        assertEquals(false, map["hideAge"])
    }

    @Test
    fun `toMap includes dateOfBirth when set`() {
        val dob = Timestamp(Date(946684800000L)) // 2000-01-01
        val user = User(dateOfBirth = dob)
        val map = user.toMap()
        assertEquals(dob, map["dateOfBirth"])
    }

    @Test
    fun `toMap includes null dateOfBirth when not set`() {
        val user = User()
        val map = user.toMap()
        assertNull(map["dateOfBirth"])
    }

    @Test
    fun `default constructor has expected defaults`() {
        val user = User()
        assertEquals("", user.uid)
        assertEquals("", user.displayName)
        assertNull(user.avatarUrl)
        assertNull(user.profilePhotoUrl)
        assertNull(user.coverPhotoUrl)
        assertNull(user.description)
        assertNull(user.nationality)
        assertEquals(0L, user.uniqueId)
        assertEquals(emptySet<String>(), user.blockedUserIds)
        assertNull(user.dateOfBirth)
        assertEquals(false, user.hideFollowing)
        assertEquals(false, user.hideOnlineStatus)
        assertEquals(false, user.hideAge)
        assertNull(user.phoneNumber)
        assertNull(user.email)
    }

    @Test
    fun `toMap roundtrip preserves non-null optional fields`() {
        val user = User(
            uid = "u1",
            displayName = "Test",
            avatarUrl = "avatar.png",
            profilePhotoUrl = "profile.png",
            coverPhotoUrl = "cover.png",
            description = "Hello world",
            nationality = "US",
            uniqueId = 42L,
            blockedUserIds = setOf("x"),
            phoneNumber = "+1234567890",
            email = "test@example.com",
            createdAt = TestData.BASE_TIMESTAMP,
            lastSeenAt = TestData.LATER_TIMESTAMP
        )
        val map = user.toMap()

        assertEquals(user.uid, map["uid"])
        assertEquals(user.displayName, map["displayName"])
        assertEquals(user.avatarUrl, map["avatarUrl"])
        assertEquals(user.profilePhotoUrl, map["profilePhotoUrl"])
        assertEquals(user.coverPhotoUrl, map["coverPhotoUrl"])
        assertEquals(user.description, map["description"])
        assertEquals(user.nationality, map["nationality"])
        assertEquals(user.uniqueId, map["uniqueId"])
        assertEquals(user.blockedUserIds.toList(), map["blockedUserIds"])
        assertEquals(user.phoneNumber, map["phoneNumber"])
        assertEquals(user.email, map["email"])
        assertEquals(user.createdAt, map["createdAt"])
        assertEquals(user.lastSeenAt, map["lastSeenAt"])
    }
}
