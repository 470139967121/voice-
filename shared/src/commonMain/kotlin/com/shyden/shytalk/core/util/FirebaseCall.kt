package com.shyden.shytalk.core.util

import kotlinx.coroutines.CancellationException

/**
 * Wraps a suspend block in a try-catch and returns [Resource.Success] or [Resource.Error].
 * Eliminates the repeated try-catch-Resource.Error boilerplate across repositories.
 *
 * Catches and logs at error level so Sentry / logcat see the failure even
 * when the calling repository decides to swallow the resulting [Resource.Error]
 * (e.g. for fire-and-forget retries). [CancellationException] is rethrown
 * unchanged to preserve structured concurrency.
 */
suspend inline fun <T> firebaseCall(
    errorMessage: String = "Operation failed",
    crossinline block: suspend () -> T,
): Resource<T> =
    try {
        Resource.Success(block())
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        logE("firebaseCall", errorMessage, e)
        Resource.Error(e.message ?: errorMessage, e)
    }
