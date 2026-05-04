package com.shyden.shytalk.core.util

private const val LOG_TAG = "MapExt"

// Test-injectable type-drift sink. Production callers go through the
// real `logW` so a Firestore field arriving as the wrong shape (e.g.
// a String "true" landing in `isSuspended`) emits a Sentry-visible
// warning instead of silently coercing to `default`. Several call
// sites read security gates (`isSuspended`, `suspensionCanAppeal`,
// `ageVerified`, `pmLocked`); silent type drift on those would let a
// corrupted doc bypass a gate without anyone noticing.
internal var asBoolTypeDriftLogger: (typeName: String, default: Boolean) -> Unit =
    { typeName, default ->
        logW(
            LOG_TAG,
            "asBool type drift: expected Boolean/Number, got $typeName, returning default=$default",
        )
    }

/** Safely converts a value to Boolean, handling integer booleans (0/1). */
fun Any?.asBool(default: Boolean = false): Boolean =
    when (this) {
        is Boolean -> this

        is Number -> toInt() != 0

        null -> default

        else -> {
            asBoolTypeDriftLogger(this::class.simpleName ?: "Unknown", default)
            default
        }
    }
