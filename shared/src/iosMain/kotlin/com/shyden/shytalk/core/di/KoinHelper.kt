package com.shyden.shytalk.core.di

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
    if (KoinPlatformTools.defaultContext().getOrNull() != null) return
    startKoin {
        modules(viewModelModule, iosPlatformModule)
    }
}
