package com.shyden.shytalk.core.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class ResourceTest {

    @Test
    fun `Success holds data`() {
        val resource = Resource.Success("hello")
        assertEquals("hello", resource.data)
    }

    @Test
    fun `Error holds message without exception`() {
        val resource = Resource.Error("something failed")
        assertEquals("something failed", resource.message)
        assertNull(resource.exception)
    }

    @Test
    fun `Error holds message with exception`() {
        val ex = RuntimeException("boom")
        val resource = Resource.Error("something failed", ex)
        assertEquals("something failed", resource.message)
        assertSame(ex, resource.exception)
    }

    @Test
    fun `Loading is singleton`() {
        assertSame(Resource.Loading, Resource.Loading)
    }

    @Test
    fun `when expression covers all branches`() {
        val resources: List<Resource<String>> = listOf(
            Resource.Success("data"),
            Resource.Error("err"),
            Resource.Loading
        )
        val results = resources.map { resource ->
            when (resource) {
                is Resource.Success -> "success"
                is Resource.Error -> "error"
                is Resource.Loading -> "loading"
            }
        }
        assertEquals(listOf("success", "error", "loading"), results)
    }
}
