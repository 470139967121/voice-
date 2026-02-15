package com.shyden.shytalk.data.remote

import com.google.android.gms.tasks.Tasks
import com.google.firebase.functions.FirebaseFunctions
import com.google.firebase.functions.HttpsCallableReference
import com.google.firebase.functions.HttpsCallableResult
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

class LiveKitTokenServiceTest {

    private lateinit var functions: FirebaseFunctions
    private lateinit var callable: HttpsCallableReference
    private lateinit var service: LiveKitTokenService

    @Before
    fun setup() {
        functions = mockk(relaxed = true)
        callable = mockk(relaxed = true)
        every { functions.getHttpsCallable("generateLiveKitToken") } returns callable
        service = LiveKitTokenService(functions)
    }

    @Test
    fun `fetchToken returns token from successful response`() = runTest {
        val result = mockk<HttpsCallableResult>()
        every { result.getData() } returns mapOf("token" to "test-jwt-token")
        every { callable.call(any()) } returns Tasks.forResult(result)

        val token = service.fetchToken("room-1", "user-1")

        assertEquals("test-jwt-token", token)
        verify { callable.call(match<HashMap<String, String>> {
            it["roomName"] == "room-1" && it["identity"] == "user-1"
        }) }
    }

    @Test(expected = IllegalStateException::class)
    fun `fetchToken throws when response missing token field`() = runTest {
        val result = mockk<HttpsCallableResult>()
        every { result.getData() } returns mapOf("error" to "no token")
        every { callable.call(any()) } returns Tasks.forResult(result)

        service.fetchToken("room-1", "user-1")
    }

    @Test(expected = IllegalStateException::class)
    fun `fetchToken throws when response is null`() = runTest {
        val result = mockk<HttpsCallableResult>()
        every { result.getData() } returns null
        every { callable.call(any()) } returns Tasks.forResult(result)

        service.fetchToken("room-1", "user-1")
    }

    @Test(expected = RuntimeException::class)
    fun `fetchToken propagates exception from Cloud Function`() = runTest {
        every { callable.call(any()) } returns Tasks.forException(RuntimeException("Network error"))

        service.fetchToken("room-1", "user-1")
    }
}
