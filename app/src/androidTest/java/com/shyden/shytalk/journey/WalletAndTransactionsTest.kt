package com.shyden.shytalk.journey

import android.view.KeyEvent
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.shyden.shytalk.navigation.Screen
import com.shyden.shytalk.util.ResetFakesRule
import com.shyden.shytalk.util.ScreenshotRule
import com.shyden.shytalk.util.launchNavGraph
import com.shyden.shytalk.util.waitForTag
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class WalletAndTransactionsTest {
    @get:Rule(order = 0)
    val resetFakes = ResetFakesRule()

    @get:Rule(order = 1)
    val composeTestRule = createComposeRule()

    @get:Rule(order = 2)
    val screenshotRule = ScreenshotRule(composeTestRule)

    @Test
    fun walletScreen_showsBalance() {
        composeTestRule.launchNavGraph(startDestination = Screen.Wallet.route)
        composeTestRule.waitForTag("wallet_balance")
        composeTestRule.onNodeWithTag("wallet_balance").assertIsDisplayed()
    }

    @Test
    fun walletScreen_transactionsButton_navigates() {
        composeTestRule.launchNavGraph(startDestination = Screen.Wallet.route)
        composeTestRule.waitForTag("wallet_transactionsButton")
        composeTestRule.onNodeWithTag("wallet_transactionsButton").performClick()
        composeTestRule.waitForTag("transactions_list")
        composeTestRule.onNodeWithTag("transactions_list").assertIsDisplayed()
    }

    @Test
    fun transactionHistory_showsTransactions() {
        composeTestRule.launchNavGraph(startDestination = Screen.Transactions.route)
        composeTestRule.waitForTag("transactions_list")
        composeTestRule.onNodeWithTag("transactions_list").assertIsDisplayed()
    }

    @Test
    fun transactionHistory_backButton_returnsToWallet() {
        composeTestRule.launchNavGraph(startDestination = Screen.Wallet.route)
        composeTestRule.waitForTag("wallet_transactionsButton")
        composeTestRule.onNodeWithTag("wallet_transactionsButton").performClick()
        composeTestRule.waitForTag("transactions_list")
        composeTestRule.waitForIdle()
        // Use the Instrumentation key-event API instead of Espresso.pressBack().
        // Espresso polls for window focus before dispatching the back press,
        // and that poll deterministically times out (RootViewWithoutFocusException
        // after 10s) when running with `mainClock.autoAdvance = false` because
        // the Compose nav-transition frames don't render to drive focus
        // settlement. sendKeyDownUpSync bypasses the focus poll — it sends
        // the KEYCODE_BACK event directly to the Activity, matching what a
        // real hardware/gesture back press does at the system layer.
        InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
        composeTestRule.waitForTag("wallet_balance")
        composeTestRule.onNodeWithTag("wallet_balance").assertIsDisplayed()
    }
}
