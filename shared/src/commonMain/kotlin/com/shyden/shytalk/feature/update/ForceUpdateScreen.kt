package com.shyden.shytalk.feature.update

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.SystemUpdate
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.shyden.shytalk.core.platform.PlatformSettingsService
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.resources.update_now
import com.shyden.shytalk.resources.update_open_store_failed
import com.shyden.shytalk.resources.update_required
import com.shyden.shytalk.resources.update_required_description
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.koinInject

private const val APP_BUNDLE_ID = "com.shyden.shytalk"

@Composable
fun ForceUpdateScreen(platformSettings: PlatformSettingsService = koinInject()) {
    var openFailed by remember { mutableStateOf(false) }
    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Icon(
                imageVector = Icons.Default.SystemUpdate,
                contentDescription = null,
                modifier = Modifier.size(80.dp),
                tint = MaterialTheme.colorScheme.primary,
            )

            Spacer(modifier = Modifier.height(24.dp))

            Text(
                text = stringResource(Res.string.update_required),
                style = MaterialTheme.typography.headlineMedium,
                textAlign = TextAlign.Center,
                modifier = Modifier.testTag("forceUpdate_title"),
            )

            Spacer(modifier = Modifier.height(12.dp))

            Text(
                text = stringResource(Res.string.update_required_description),
                style = MaterialTheme.typography.bodyLarge,
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Spacer(modifier = Modifier.height(32.dp))

            Button(
                onClick = {
                    // PlatformSettingsService.openPlayStore opens the Play Store
                    // page on Android and the App Store page on iOS, abstracting
                    // the platform-specific Intent / UIApplication.openURL.
                    // Returns false when no store app/handler is available
                    // (e.g. Huawei devices, iOS Restrictions); we surface a
                    // manual-update fallback rather than leave the user stuck
                    // on this blocking screen.
                    openFailed = !platformSettings.openPlayStore(APP_BUNDLE_ID)
                },
                modifier = Modifier.testTag("forceUpdate_updateButton"),
            ) {
                Text(stringResource(Res.string.update_now))
            }

            if (openFailed) {
                Spacer(modifier = Modifier.height(16.dp))
                Text(
                    text = stringResource(Res.string.update_open_store_failed),
                    style = MaterialTheme.typography.bodySmall,
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.testTag("forceUpdate_openStoreFailed"),
                )
            }
        }
    }
}
