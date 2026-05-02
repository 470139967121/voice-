package com.shyden.shytalk.data.repository

import com.shyden.shytalk.feature.messaging.Report
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

/**
 * Parses a single report JSON object as emitted by `GET /api/reports`
 * (Express route at `express-api/src/routes/reports.js`). Lives in
 * commonMain so the iOS-side parser stays in sync with what the admin
 * web client expects — the previous bespoke iOS parsing diverged from
 * Android (wrong JSON key for the timestamp; missing `.lowercase()` on
 * the `type` field that admin filters compare case-insensitively).
 */
internal fun parseReportFromApi(obj: JsonObject): Report =
    Report(
        reportId = obj["id"]?.jsonPrimitive?.contentOrNull ?: "",
        reporterId = obj["reporterId"]?.jsonPrimitive?.contentOrNull ?: "",
        reporterName = obj["reporterName"]?.jsonPrimitive?.contentOrNull ?: "",
        reporterUniqueId = obj["reporterUniqueId"]?.jsonPrimitive?.longOrNull ?: 0L,
        reportedUserId = obj["reportedUserId"]?.jsonPrimitive?.contentOrNull ?: "",
        reportedUserName = obj["reportedUserName"]?.jsonPrimitive?.contentOrNull ?: "",
        reportedUserUniqueId = obj["reportedUserUniqueId"]?.jsonPrimitive?.longOrNull ?: 0L,
        conversationId = obj["conversationId"]?.jsonPrimitive?.contentOrNull ?: "",
        messageId = obj["messageId"]?.jsonPrimitive?.contentOrNull ?: "",
        messageText = obj["messageText"]?.jsonPrimitive?.contentOrNull ?: "",
        reason = obj["reason"]?.jsonPrimitive?.contentOrNull ?: "",
        description = obj["description"]?.jsonPrimitive?.contentOrNull ?: "",
        type = (obj["type"]?.jsonPrimitive?.contentOrNull ?: "").lowercase(),
        timestamp = obj["createdAt"]?.jsonPrimitive?.longOrNull ?: 0L,
        status = obj["status"]?.jsonPrimitive?.contentOrNull ?: "pending",
    )
