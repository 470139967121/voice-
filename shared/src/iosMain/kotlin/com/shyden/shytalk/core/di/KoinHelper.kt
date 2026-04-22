package com.shyden.shytalk.core.di

import org.koin.core.context.startKoin

/**
 * Initializes Koin for the iOS app.
 *
 * Called from Swift: `KoinHelperKt.doInitKoin()` in iOSApp.swift's init().
 * Loads the shared ViewModel module alongside the iOS platform module.
 */
fun doInitKoin() {
    startKoin {
        modules(viewModelModule, iosPlatformModule)
    }
}
