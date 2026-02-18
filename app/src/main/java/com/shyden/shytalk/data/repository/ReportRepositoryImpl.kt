package com.shyden.shytalk.data.repository

import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import com.shyden.shytalk.core.util.millisToTimestamp
import com.shyden.shytalk.core.util.timestampToMillis
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.feature.messaging.Report
import kotlinx.coroutines.tasks.await
import java.util.UUID

class ReportRepositoryImpl(
    private val firestore: FirebaseFirestore
) : ReportRepository {

    override suspend fun reportMessage(
        reporterId: String,
        reportedUserId: String,
        conversationId: String,
        messageId: String,
        messageText: String,
        reason: String,
        description: String
    ): Resource<Unit> = firebaseCall("Failed to submit report") {
        val reportId = UUID.randomUUID().toString()
        firestore.collection("reports").document(reportId).set(
            mapOf(
                "reporterId" to reporterId,
                "reportedUserId" to reportedUserId,
                "conversationId" to conversationId,
                "messageId" to messageId,
                "messageText" to messageText,
                "reason" to reason,
                "description" to description,
                "type" to "MESSAGE",
                "timestamp" to millisToTimestamp(currentTimeMillis()),
                "status" to "PENDING"
            )
        ).await()
    }

    override suspend fun reportUser(
        reporterId: String,
        reportedUserId: String,
        conversationId: String,
        reason: String,
        description: String
    ): Resource<Unit> = firebaseCall("Failed to submit report") {
        val reportId = UUID.randomUUID().toString()
        firestore.collection("reports").document(reportId).set(
            mapOf(
                "reporterId" to reporterId,
                "reportedUserId" to reportedUserId,
                "conversationId" to conversationId,
                "reason" to reason,
                "description" to description,
                "type" to "USER",
                "timestamp" to millisToTimestamp(currentTimeMillis()),
                "status" to "PENDING"
            )
        ).await()
    }

    override suspend fun getPendingReports(): Resource<List<Report>> =
        firebaseCall("Failed to load reports") {
            val snapshot = firestore.collection("reports")
                .whereEqualTo("status", "PENDING")
                .orderBy("timestamp", Query.Direction.DESCENDING)
                .limit(50)
                .get()
                .await()

            snapshot.documents.map { doc ->
                val data = doc.data ?: emptyMap()
                Report(
                    reportId = doc.id,
                    reporterId = data["reporterId"] as? String ?: "",
                    reporterName = data["reporterName"] as? String ?: "",
                    reportedUserId = data["reportedUserId"] as? String ?: "",
                    reportedUserName = data["reportedUserName"] as? String ?: "",
                    conversationId = data["conversationId"] as? String ?: "",
                    messageId = data["messageId"] as? String ?: "",
                    messageText = data["messageText"] as? String ?: "",
                    reason = data["reason"] as? String ?: "",
                    description = data["description"] as? String ?: "",
                    type = (data["type"] as? String ?: "").lowercase(),
                    timestamp = timestampToMillis(data["timestamp"]),
                    status = data["status"] as? String ?: "pending"
                )
            }
        }

    override suspend fun resolveReport(reportId: String, action: String): Resource<Unit> =
        firebaseCall("Failed to resolve report") {
            firestore.collection("reports").document(reportId).update(
                mapOf(
                    "status" to "RESOLVED",
                    "resolvedAction" to action,
                    "resolvedAt" to millisToTimestamp(currentTimeMillis())
                )
            ).await()
        }
}
