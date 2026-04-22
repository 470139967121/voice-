package com.shyden.shytalk.core.di

import com.shyden.shytalk.core.util.logE
import com.shyden.shytalk.core.util.logI
import org.koin.core.context.startKoin
import org.koin.mp.KoinPlatformTools

/**
 * Initializes Koin for the iOS app.
 *
 * Called from Swift: `KoinHelperKt.doInitKoin()` in iOSApp.swift's init().
 * Loads the shared ViewModel module alongside the iOS platform module.
 * Guarded against double invocation — SwiftUI's @main struct init can
 * be called more than once during lifecycle events.
 */
fun doInitKoin() {
    if (KoinPlatformTools.defaultContext().getOrNull() != null) {
        logI("KoinHelper", "Koin already initialised — skipping")
        return
    }
    try {
        startKoin {
            modules(viewModelModule, iosPlatformModule)
        }
        logI("KoinHelper", "Koin initialised successfully")
    } catch (e: Exception) {
        logE("KoinHelper", "Koin initialisation failed", e)
        throw e
    }
}
