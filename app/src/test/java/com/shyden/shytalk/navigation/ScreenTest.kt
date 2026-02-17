package com.shyden.shytalk.navigation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class ScreenTest {

    @Test
    fun `SignIn has correct route`() {
        assertEquals("sign_in", Screen.SignIn.route)
    }

    @Test
    fun `ProfileSetup has correct route`() {
        assertEquals("profile_setup", Screen.ProfileSetup.route)
    }

    @Test
    fun `Main has correct route`() {
        assertEquals("main", Screen.Main.route)
    }

    @Test
    fun `Room route contains roomId placeholder`() {
        assertEquals("room/{roomId}", Screen.Room.route)
    }

    @Test
    fun `Room createRoute substitutes roomId`() {
        assertEquals("room/abc-123", Screen.Room.createRoute("abc-123"))
    }

    @Test
    fun `UserProfile route contains userId placeholder`() {
        assertEquals("profile/{userId}", Screen.UserProfile.route)
    }

    @Test
    fun `UserProfile createRoute substitutes userId`() {
        assertEquals("profile/user-42", Screen.UserProfile.createRoute("user-42"))
    }

    @Test
    fun `FollowList route contains both placeholders`() {
        assertEquals("follow_list/{userId}/{tab}", Screen.FollowList.route)
    }

    @Test
    fun `FollowList createRoute substitutes both params`() {
        assertEquals(
            "follow_list/user-42/followers",
            Screen.FollowList.createRoute("user-42", "followers")
        )
    }

    @Test
    fun `RequiredDOB has correct route`() {
        assertEquals("required_dob", Screen.RequiredDOB.route)
    }

    @Test
    fun `LunarNewYear has correct route`() {
        assertEquals("lunar_new_year", Screen.LunarNewYear.route)
    }

    @Test
    fun `Settings has correct route`() {
        assertEquals("settings", Screen.Settings.route)
    }

    @Test
    fun `PrivacyPolicy has correct route`() {
        assertEquals("privacy_policy", Screen.PrivacyPolicy.route)
    }

    @Test
    fun `all static routes are unique`() {
        val routes = listOf(
            Screen.SignIn.route,
            Screen.ProfileSetup.route,
            Screen.Main.route,
            Screen.Room.route,
            Screen.UserProfile.route,
            Screen.FollowList.route,
            Screen.RequiredDOB.route,
            Screen.PrivacyPolicy.route,
            Screen.LunarNewYear.route,
            Screen.Settings.route
        )
        assertEquals(routes.size, routes.toSet().size)
    }

    @Test
    fun `Room createRoute with special characters`() {
        assertEquals("room/room%20id", Screen.Room.createRoute("room%20id"))
    }

    @Test
    fun `FollowList createRoute with following tab`() {
        assertEquals(
            "follow_list/user-1/following",
            Screen.FollowList.createRoute("user-1", "following")
        )
    }
}
