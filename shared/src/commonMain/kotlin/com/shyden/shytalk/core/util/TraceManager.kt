package com.shyden.shytalk.core.util

import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

object TraceManager {
    @OptIn(ExperimentalUuidApi::class)
    val sessionTraceId: String = Uuid.random().toString()
}
