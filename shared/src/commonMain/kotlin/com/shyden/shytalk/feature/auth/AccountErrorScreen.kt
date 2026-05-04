package com.shyden.shytalk.feature.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.resources.account_error_body
import com.shyden.shytalk.resources.account_error_code_label
import com.shyden.shytalk.resources.account_error_sign_out
import com.shyden.shytalk.resources.account_error_title
import org.jetbrains.compose.resources.stringResource

/**
 * Generic "your account is in a state we cannot resolve from the
 * client" screen. Shown by [SignInScreen] when sign-in resolution
 * detected an inconsistent server-side state — currently only
 * triggered by `ageVerified=true` AND `dateOfBirth=null`
 * (`AGE_VERIF_NO_DOB_E001`), but the screen is generic so future
 * inconsistency codes can route through the same surface.
 *
 * The user is shown a static error code to quote to support; the code
 * resolves to a specific underlying cause in our internal docs so
 * support can fix the data without the user having to describe the
 * symptom.
 */
@Composable
fun AccountErrorScreen(
    errorCode: String,
    onSignOut: () -> Unit,
) {
    Scaffold { padding ->
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .padding(horizontal = 32.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                stringResource(Res.string.account_error_title),
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(16.dp))
            Text(
                stringResource(Res.string.account_error_body),
                style = MaterialTheme.typography.bodyMedium,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(24.dp))
            // Code is shown in a Surface so users can read + screenshot
            // it without it visually merging into the body copy. testTag
            // for E2E reliability.
            Surface(
                shape = RoundedCornerShape(8.dp),
                color = MaterialTheme.colorScheme.surfaceVariant,
                modifier = Modifier.testTag(TAG_ACCOUNT_ERROR_CODE),
            ) {
                Box(
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                ) {
                    Text(
                        text = stringResource(Res.string.account_error_code_label, errorCode),
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center,
                    )
                }
            }
            Spacer(Modifier.height(32.dp))
            Button(
                onClick = onSignOut,
                modifier = Modifier.testTag(TAG_ACCOUNT_ERROR_SIGN_OUT),
            ) {
                Text(stringResource(Res.string.account_error_sign_out))
            }
        }
    }
}

const val TAG_ACCOUNT_ERROR_CODE = "accountError_code"
const val TAG_ACCOUNT_ERROR_SIGN_OUT = "accountError_signOut"
