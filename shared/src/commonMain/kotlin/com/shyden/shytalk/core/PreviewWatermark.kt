package com.shyden.shytalk.core

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import com.shyden.shytalk.data.repository.AuthRepository
import kotlinx.coroutines.delay
import org.koin.mp.KoinPlatformTools

/**
 * Wraps content in a Box and overlays a "ShyTalk Preview" badge in the
 * top-right of every screen when [BuildVariant.isPreviewBuild] is true
 * (i.e. `BuildVariant.environment != "prod"`). The badge identifies
 * screenshots that are accidentally shared from pre-prod builds —
 * environment, build version, device info, and the signed-in user's
 * uniqueId are all visible at a glance.
 *
 * Wrap the root content (inside `ShyTalkTheme`) on every platform —
 * `MainActivity.setContent` on Android, `MainViewController.IosApp` on
 * iOS. Production builds pass content through unchanged because
 * [BuildVariant.environment] defaults to `"prod"` and the platform
 * initialiser only sets non-prod values on dev/local flavours.
 *
 * The user-id polls the Koin-registered [AuthRepository] every 2s for
 * `resolvedUniqueId` updates rather than wiring a flow through the
 * auth layer for a watermark display. Cost is one mutable-property read
 * per tick on the main dispatcher — negligible.
 */
@Composable
fun PreviewWatermark(content: @Composable () -> Unit) {
    Box(modifier = Modifier.fillMaxSize()) {
        content()
        if (BuildVariant.isPreviewBuild) {
            WatermarkBadge(
                modifier =
                    Modifier
                        .align(Alignment.TopEnd)
                        .padding(top = 4.dp, end = 4.dp)
                        .zIndex(WATERMARK_Z_INDEX),
            )
        }
    }
}

private const val WATERMARK_Z_INDEX = 1000f
private const val USER_ID_POLL_INTERVAL_MS = 2_000L

@Composable
private fun WatermarkBadge(modifier: Modifier = Modifier) {
    var uniqueId by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        // Sample AuthRepository.resolvedUniqueId on a tick rather than
        // observe a flow — `resolvedUniqueId` is a plain `var` and a
        // watermark refresh latency of up to 2s is unnoticeable to the
        // human eye, while threading a StateFlow through every auth
        // call site for this single display would be invasive.
        // `getOrNull()` on the context returns the Koin instance (or
        // null if Koin hasn't started yet — possible early in
        // `setContent` before `doInitKoin` completes).
        while (true) {
            uniqueId =
                runCatching {
                    val koin = KoinPlatformTools.defaultContext().getOrNull()
                    val repo = koin?.getOrNull<AuthRepository>()
                    repo?.resolvedUniqueId
                }.getOrNull()
            delay(USER_ID_POLL_INTERVAL_MS)
        }
    }

    Column(
        modifier =
            modifier
                .background(WatermarkBackgroundColor)
                .padding(horizontal = 6.dp, vertical = 3.dp),
        horizontalAlignment = Alignment.End,
    ) {
        Text(
            text = "ShyTalk Preview",
            color = Color.White,
            fontSize = WATERMARK_TITLE_SIZE_SP.sp,
            fontWeight = FontWeight.Bold,
        )
        Text(
            text = "${BuildVariant.environment} · ${BuildVariant.buildVersion}",
            color = Color.White,
            fontSize = WATERMARK_DETAIL_SIZE_SP.sp,
            fontFamily = FontFamily.Monospace,
        )
        Text(
            text = BuildVariant.deviceInfo,
            color = Color.White,
            fontSize = WATERMARK_DETAIL_SIZE_SP.sp,
            fontFamily = FontFamily.Monospace,
        )
        Text(
            text = "UID: ${uniqueId ?: "-"}",
            color = Color.White,
            fontSize = WATERMARK_DETAIL_SIZE_SP.sp,
            fontFamily = FontFamily.Monospace,
        )
    }
}

private val WatermarkBackgroundColor = Color(0xCCD32F2F)
private const val WATERMARK_TITLE_SIZE_SP = 10
private const val WATERMARK_DETAIL_SIZE_SP = 9
