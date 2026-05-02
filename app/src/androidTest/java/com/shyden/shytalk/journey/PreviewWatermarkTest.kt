package com.shyden.shytalk.journey

import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.shyden.shytalk.core.BuildVariant
import com.shyden.shytalk.core.PreviewWatermark
import com.shyden.shytalk.util.ResetFakesRule
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * TDD contract for [PreviewWatermark]:
 *
 * 1. On a prod build, the wrapper is a pass-through — the badge nodes
 *    do NOT appear in the semantics tree. Showing a watermark on real
 *    prod would erode trust in the signal that distinguishes
 *    leaked-screenshot builds from genuine production output.
 *
 * 2. On any non-prod build (`local`, `dev`, anything ≠ "prod"), the
 *    badge renders with the literal text "ShyTalk Preview" plus the
 *    environment + build version. This makes screenshots from staging
 *    builds unmistakable at a glance, satisfying the user requirement
 *    "every single screen MUST have a watermark showing 'ShyTalk
 *    Preview'".
 *
 * 3. The wrapped content is always rendered — the watermark is an
 *    overlay, not a replacement.
 */
@RunWith(AndroidJUnit4::class)
class PreviewWatermarkTest {
    @get:Rule(order = 0)
    val resetFakes = ResetFakesRule()

    @get:Rule(order = 1)
    val composeTestRule = createComposeRule()

    @After
    fun resetBuildVariant() {
        // Restore default so a parallel test running after this one
        // doesn't see leftover environment="dev" state.
        BuildVariant.initBuildInfo(environment = "prod", buildVersion = "?")
    }

    @Test
    fun watermark_notShown_whenEnvironmentIsProd() {
        BuildVariant.initBuildInfo(environment = "prod", buildVersion = "2.0.0 (789)")

        composeTestRule.setContent {
            PreviewWatermark {
                Text("inner content", modifier = Modifier.testTag("inner"))
            }
        }

        composeTestRule.onNodeWithTag("inner").assertIsDisplayed()
        // The "ShyTalk Preview" string MUST NOT appear on prod.
        composeTestRule.onAllNodesWithText("ShyTalk Preview").assertCountEquals(0)
    }

    @Test
    fun watermark_shown_whenEnvironmentIsDev() {
        BuildVariant.initBuildInfo(environment = "dev", buildVersion = "1.2.3 (456)")

        composeTestRule.setContent {
            PreviewWatermark {
                Text("inner content", modifier = Modifier.testTag("inner"))
            }
        }

        composeTestRule.onNodeWithTag("inner").assertIsDisplayed()
        composeTestRule.onNodeWithText("ShyTalk Preview").assertIsDisplayed()
    }

    @Test
    fun watermark_shown_whenEnvironmentIsLocal() {
        BuildVariant.initBuildInfo(environment = "local", buildVersion = "1.0.0 (1)")

        composeTestRule.setContent {
            PreviewWatermark {
                Text("inner content", modifier = Modifier.testTag("inner"))
            }
        }

        composeTestRule.onNodeWithText("ShyTalk Preview").assertIsDisplayed()
    }

    @Test
    fun watermark_displaysEnvironmentAndBuildVersion() {
        BuildVariant.initBuildInfo(
            environment = "dev",
            buildVersion = "1.2.3 (456)",
            deviceInfo = "Pixel 6 · Android 14",
        )

        composeTestRule.setContent {
            PreviewWatermark {
                Text("inner content")
            }
        }

        // The environment label, build version, AND device info must
        // all be visible so the screenshot reader knows exactly which
        // build + device the screenshot came from.
        composeTestRule.onNodeWithText("dev", substring = true).assertIsDisplayed()
        composeTestRule.onNodeWithText("1.2.3 (456)", substring = true).assertIsDisplayed()
        composeTestRule.onNodeWithText("Pixel 6", substring = true).assertIsDisplayed()
    }

    @Test
    fun watermark_passesContentThrough_onEveryEnvironment() {
        // The overlay is additive — wrapped content must always render
        // regardless of which environment is set, so the watermark
        // never "hides" the screen content.
        for (env in listOf("prod", "dev", "local")) {
            BuildVariant.initBuildInfo(environment = env, buildVersion = "1.0")
            composeTestRule.setContent {
                PreviewWatermark {
                    Text("inner-$env", modifier = Modifier.testTag("inner-$env"))
                }
            }
            composeTestRule.onNodeWithTag("inner-$env").assertIsDisplayed()
        }
    }
}
