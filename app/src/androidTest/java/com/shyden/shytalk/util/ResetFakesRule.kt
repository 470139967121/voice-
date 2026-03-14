package com.shyden.shytalk.util

import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.fake.FakeAuthRepository
import org.junit.rules.TestWatcher
import org.junit.runner.Description
import org.koin.java.KoinJavaComponent.getKoin

/**
 * JUnit rule that resets all fake repositories to their default state before each test.
 * Prevents state leakage between test classes when Koin singletons persist across the run.
 */
class ResetFakesRule : TestWatcher() {
    override fun starting(description: Description) {
        val auth = getKoin().get<AuthRepository>() as? FakeAuthRepository
        auth?.reset()
    }
}
