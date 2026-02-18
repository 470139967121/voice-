package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource

interface ReportRepository {
    suspend fun reportMessage(
        reporterId: String,
        reportedUserId: String,
        conversationId: String,
        messageId: String,
        messageText: String,
        reason: String,
        description: String
    ): Resource<Unit>

    suspend fun reportUser(
        reporterId: String,
        reportedUserId: String,
        conversationId: String,
        reason: String,
        description: String
    ): Resource<Unit>

    suspend fun getPendingReports(): Resource<List<com.shyden.shytalk.feature.messaging.Report>>

    suspend fun resolveReport(reportId: String, action: String): Resource<Unit>
}
