package com.shyden.shytalk.data.repository

import com.google.android.gms.tasks.Tasks
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.FirebaseFirestore
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.remote.WorkerApiClient
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class NotificationRepositoryImplTest {
    private lateinit var api: WorkerApiClient
    private lateinit var firestore: FirebaseFirestore
    private lateinit var repo: NotificationRepositoryImpl
    private lateinit var mockDocRef: DocumentReference

    @Before
    fun setup() {
        api = mockk(relaxed = true)
        firestore = mockk(relaxed = true)
        mockDocRef = mockk(relaxed = true)
        every { firestore.document(any()) } returns mockDocRef
        every { mockDocRef.update(any<String>(), any()) } returns Tasks.forResult(null)
        repo = NotificationRepositoryImpl(api, firestore)
    }

    @Test
    fun `saveFcmToken returns Success`() =
        runTest {
            coEvery { api.post("/api/notifications/token", any()) } returns
                JSONObject().apply {
                    put("success", true)
                }

            val result = repo.saveFcmToken("user-1", "token-abc")

            assertTrue(result is Resource.Success)
            coVerify { api.post("/api/notifications/token", any()) }
        }

    @Test
    fun `saveFcmToken returns Error on exception`() =
        runTest {
            coEvery { api.post("/api/notifications/token", any()) } throws RuntimeException("Fail")

            val result = repo.saveFcmToken("user-1", "token-abc")

            assertTrue(result is Resource.Error)
        }

    @Test
    fun `removeFcmToken returns Success`() =
        runTest {
            coEvery { api.delete("/api/notifications/token", any()) } returns
                JSONObject().apply {
                    put("success", true)
                }

            val result = repo.removeFcmToken("user-1", "token-abc")

            assertTrue(result is Resource.Success)
        }

    @Test
    fun `removeFcmToken returns Error on exception`() =
        runTest {
            coEvery { api.delete("/api/notifications/token", any()) } throws RuntimeException("Fail")

            val result = repo.removeFcmToken("user-1", "token-abc")

            assertTrue(result is Resource.Error)
        }

    @Test
    fun `setPmNotificationsEnabled hits PATCH api and returns Success`() =
        runTest {
            coEvery { api.patch("/api/notifications/settings", any()) } returns
                JSONObject().apply { put("success", true) }
            val result = repo.setPmNotificationsEnabled("user-1", true)
            assertTrue(result is Resource.Success)
            // Verify the field is included in the request body so we are not
            // silently no-oping on the server side.
            coVerify {
                api.patch(
                    "/api/notifications/settings",
                    match<JSONObject> { it.optBoolean("pmNotificationsEnabled") },
                )
            }
        }

    @Test
    fun `setPmNotificationsEnabled returns Error on api failure`() =
        runTest {
            coEvery { api.patch("/api/notifications/settings", any()) } throws RuntimeException("Fail")
            val result = repo.setPmNotificationsEnabled("user-1", true)
            assertTrue(result is Resource.Error)
        }

    // region getPmNotificationsEnabled — reads from Firestore (tested via integration tests)

    // endregion
}
