package com.shyden.shytalk.data.repository

import com.google.android.gms.tasks.Tasks
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.QuerySnapshot
import com.shyden.shytalk.core.util.Resource
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import io.mockk.verify
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class ReportRepositoryImplTest {

    private lateinit var firestore: FirebaseFirestore
    private lateinit var reportsCollection: CollectionReference
    private lateinit var reportDoc: DocumentReference
    private lateinit var repo: ReportRepositoryImpl

    @Before
    fun setup() {
        firestore = mockk(relaxed = true)
        reportsCollection = mockk(relaxed = true)
        reportDoc = mockk(relaxed = true)

        every { firestore.collection("reports") } returns reportsCollection
        every { reportsCollection.document(any<String>()) } returns reportDoc
        every { reportDoc.set(any()) } returns Tasks.forResult(null)
        every { reportDoc.update(any<Map<String, Any>>()) } returns Tasks.forResult(null)

        repo = ReportRepositoryImpl(firestore)
    }

    // --- reportMessage ---

    @Test
    fun `reportMessage writes status as lowercase pending`() = runTest {
        val dataSlot = slot<Map<String, Any>>()
        every { reportDoc.set(capture(dataSlot)) } returns Tasks.forResult(null)

        val result = repo.reportMessage(
            reporterId = "reporter-1",
            reporterName = "ReporterName",
            reporterUniqueId = 1001L,
            reportedUserId = "user-1",
            reportedUserName = "OffenderName",
            reportedUserUniqueId = 2002L,
            conversationId = "conv-1",
            messageId = "msg-1",
            messageText = "bad message",
            reason = "Spam",
            description = "This is spam"
        )

        assertTrue(result is Resource.Success)
        assertEquals("pending", dataSlot.captured["status"])
    }

    @Test
    fun `reportMessage writes correct type field`() = runTest {
        val dataSlot = slot<Map<String, Any>>()
        every { reportDoc.set(capture(dataSlot)) } returns Tasks.forResult(null)

        repo.reportMessage(
            reporterId = "r", reporterName = "R", reporterUniqueId = 1L,
            reportedUserId = "u", reportedUserName = "U", reportedUserUniqueId = 2L,
            conversationId = "c", messageId = "m", messageText = "t",
            reason = "Spam", description = "d"
        )

        assertEquals("MESSAGE", dataSlot.captured["type"])
    }

    @Test
    fun `reportMessage includes all required fields`() = runTest {
        val dataSlot = slot<Map<String, Any>>()
        every { reportDoc.set(capture(dataSlot)) } returns Tasks.forResult(null)

        repo.reportMessage(
            reporterId = "reporter-1",
            reporterName = "Reporter One",
            reporterUniqueId = 1001L,
            reportedUserId = "user-1",
            reportedUserName = "User One",
            reportedUserUniqueId = 2002L,
            conversationId = "conv-1",
            messageId = "msg-1",
            messageText = "bad message",
            reason = "Harassment",
            description = "Harassing me"
        )

        val data = dataSlot.captured
        assertEquals("reporter-1", data["reporterId"])
        assertEquals("Reporter One", data["reporterName"])
        assertEquals(1001L, data["reporterUniqueId"])
        assertEquals("user-1", data["reportedUserId"])
        assertEquals("User One", data["reportedUserName"])
        assertEquals(2002L, data["reportedUserUniqueId"])
        assertEquals("conv-1", data["conversationId"])
        assertEquals("msg-1", data["messageId"])
        assertEquals("bad message", data["messageText"])
        assertEquals("Harassment", data["reason"])
        assertEquals("Harassing me", data["description"])
        assertTrue(data.containsKey("timestamp"))
    }

    // --- reportUser ---

    @Test
    fun `reportUser writes status as lowercase pending`() = runTest {
        val dataSlot = slot<Map<String, Any>>()
        every { reportDoc.set(capture(dataSlot)) } returns Tasks.forResult(null)

        val result = repo.reportUser(
            reporterId = "reporter-1",
            reporterName = "Reporter",
            reporterUniqueId = 1001L,
            reportedUserId = "user-1",
            reportedUserName = "User",
            reportedUserUniqueId = 2002L,
            conversationId = "conv-1",
            reason = "Inappropriate Content",
            description = "Bad profile"
        )

        assertTrue(result is Resource.Success)
        assertEquals("pending", dataSlot.captured["status"])
    }

    @Test
    fun `reportUser writes type as USER`() = runTest {
        val dataSlot = slot<Map<String, Any>>()
        every { reportDoc.set(capture(dataSlot)) } returns Tasks.forResult(null)

        repo.reportUser(
            reporterId = "r", reporterName = "R", reporterUniqueId = 1L,
            reportedUserId = "u", reportedUserName = "U", reportedUserUniqueId = 2L,
            conversationId = "c", reason = "Spam", description = "d"
        )

        assertEquals("USER", dataSlot.captured["type"])
    }

    // --- resolveReport ---

    @Test
    fun `resolveReport writes status as lowercase resolved`() = runTest {
        val dataSlot = slot<Map<String, Any>>()
        every { reportDoc.update(capture(dataSlot)) } returns Tasks.forResult(null)

        val result = repo.resolveReport("report-1", "warn")

        assertTrue(result is Resource.Success)
        assertEquals("resolved", dataSlot.captured["status"])
        assertEquals("warn", dataSlot.captured["resolvedAction"])
        assertTrue(dataSlot.captured.containsKey("resolvedAt"))
    }

    // --- getPendingReports ---

    @Test
    fun `getPendingReports queries for lowercase pending`() = runTest {
        val query = mockk<Query>(relaxed = true)
        val orderedQuery = mockk<Query>(relaxed = true)
        val limitedQuery = mockk<Query>(relaxed = true)
        val snapshot = mockk<QuerySnapshot> { every { documents } returns emptyList() }

        every { reportsCollection.whereEqualTo("status", "pending") } returns query
        every { query.orderBy("timestamp", Query.Direction.DESCENDING) } returns orderedQuery
        every { orderedQuery.limit(50) } returns limitedQuery
        every { limitedQuery.get() } returns Tasks.forResult(snapshot)

        val result = repo.getPendingReports()

        assertTrue(result is Resource.Success)
        verify { reportsCollection.whereEqualTo("status", "pending") }
    }

    @Test
    fun `getPendingReports does NOT query for uppercase PENDING`() = runTest {
        val query = mockk<Query>(relaxed = true)
        val orderedQuery = mockk<Query>(relaxed = true)
        val limitedQuery = mockk<Query>(relaxed = true)
        val snapshot = mockk<QuerySnapshot> { every { documents } returns emptyList() }

        every { reportsCollection.whereEqualTo("status", "pending") } returns query
        every { query.orderBy("timestamp", Query.Direction.DESCENDING) } returns orderedQuery
        every { orderedQuery.limit(50) } returns limitedQuery
        every { limitedQuery.get() } returns Tasks.forResult(snapshot)

        repo.getPendingReports()

        verify(exactly = 0) { reportsCollection.whereEqualTo("status", "PENDING") }
    }

    @Test
    fun `getPendingReports maps documents correctly`() = runTest {
        val query = mockk<Query>(relaxed = true)
        val orderedQuery = mockk<Query>(relaxed = true)
        val limitedQuery = mockk<Query>(relaxed = true)

        val docData = mapOf<String, Any>(
            "reporterId" to "reporter-1",
            "reporterName" to "Reporter",
            "reporterUniqueId" to 1001L,
            "reportedUserId" to "user-1",
            "reportedUserName" to "Offender",
            "reportedUserUniqueId" to 2002L,
            "conversationId" to "conv-1",
            "messageId" to "msg-1",
            "messageText" to "bad msg",
            "reason" to "Spam",
            "description" to "spamming",
            "type" to "MESSAGE",
            "status" to "pending"
        )
        val doc = mockk<DocumentSnapshot> {
            every { id } returns "report-123"
            every { data } returns docData
        }
        val snapshot = mockk<QuerySnapshot> { every { documents } returns listOf(doc) }

        every { reportsCollection.whereEqualTo("status", "pending") } returns query
        every { query.orderBy("timestamp", Query.Direction.DESCENDING) } returns orderedQuery
        every { orderedQuery.limit(50) } returns limitedQuery
        every { limitedQuery.get() } returns Tasks.forResult(snapshot)

        val result = repo.getPendingReports()
        assertTrue(result is Resource.Success)
        val reports = (result as Resource.Success).data
        assertEquals(1, reports.size)
        assertEquals("report-123", reports[0].reportId)
        assertEquals("reporter-1", reports[0].reporterId)
        assertEquals("Reporter", reports[0].reporterName)
        assertEquals(1001L, reports[0].reporterUniqueId)
        assertEquals("Offender", reports[0].reportedUserName)
        assertEquals(2002L, reports[0].reportedUserUniqueId)
        assertEquals("Spam", reports[0].reason)
        assertEquals("message", reports[0].type) // type is lowercased
        assertEquals("pending", reports[0].status)
    }
}
