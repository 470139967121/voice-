package com.shyden.shytalk.core.di

import org.koin.dsl.module

/**
 * iOS platform module — provides repository and service implementations for iOS.
 *
 * Currently empty: stub implementations will be added in Phase 2 (Firebase)
 * and Phase 3 (platform services) of the iOS feature parity plan.
 * Until then, the iOS app does not resolve ViewModels at runtime.
 */
val iosPlatformModule =
    module {
        // Phase 2: Firebase instances, HTTP client, API client
        // Phase 3: Repository implementations, services, platform utilities
    }
