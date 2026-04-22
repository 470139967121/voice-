package com.shyden.shytalk.core.di

import org.koin.core.context.startKoin
import org.koin.core.context.stopKoin
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertNotNull

class ViewModelModuleTest {
    @AfterTest
    fun tearDown() {
        stopKoin()
    }

    @Test
    fun `viewModelModule loads without error`() {
        val koinApp = startKoin {
            modules(viewModelModule)
        }
        assertNotNull(koinApp.koin)
    }
}
