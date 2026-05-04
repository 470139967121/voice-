package com.shyden.shytalk.feature.ageverification

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.resources.age_restriction_dismiss
import com.shyden.shytalk.resources.age_restriction_needs_verification_body
import com.shyden.shytalk.resources.age_restriction_needs_verification_confirm
import com.shyden.shytalk.resources.age_restriction_needs_verification_title
import com.shyden.shytalk.resources.age_restriction_sub_eighteen_body
import com.shyden.shytalk.resources.age_restriction_sub_eighteen_confirm
import com.shyden.shytalk.resources.age_restriction_sub_eighteen_title
import org.jetbrains.compose.resources.stringResource

/**
 * Two-variant alert dialog rendered when an [AgeRestrictionDialogState]
 * is non-Hidden.
 *
 * - [AgeRestrictionDialogState.NeedsVerification] → "Verify now" CTA
 *   that should route to the verification submit flow (PR 9).
 * - [AgeRestrictionDialogState.SubEighteen] → "Contact support" CTA.
 *   The user CANNOT enter the verification flow until they age in.
 *
 * Renders nothing on [AgeRestrictionDialogState.Hidden] — the host
 * Composable just holds onto the dialog and lets the state transition
 * make it appear.
 */
@Composable
fun AgeRestrictionDialog(
    state: AgeRestrictionDialogState,
    onDismiss: () -> Unit,
    onVerifyNow: () -> Unit,
    onContactSupport: () -> Unit,
) {
    when (state) {
        AgeRestrictionDialogState.Hidden -> Unit

        AgeRestrictionDialogState.NeedsVerification -> {
            AlertDialog(
                onDismissRequest = onDismiss,
                title = {
                    Text(
                        stringResource(Res.string.age_restriction_needs_verification_title),
                        fontWeight = FontWeight.Bold,
                    )
                },
                text = {
                    Text(
                        stringResource(Res.string.age_restriction_needs_verification_body),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                },
                confirmButton = {
                    TextButton(
                        onClick = {
                            onDismiss()
                            onVerifyNow()
                        },
                        modifier = Modifier.testTag(TAG_NEEDS_VERIFICATION_CONFIRM),
                    ) {
                        Text(stringResource(Res.string.age_restriction_needs_verification_confirm))
                    }
                },
                dismissButton = {
                    TextButton(
                        onClick = onDismiss,
                        modifier = Modifier.testTag(TAG_NEEDS_VERIFICATION_DISMISS),
                    ) {
                        Text(stringResource(Res.string.age_restriction_dismiss))
                    }
                },
            )
        }

        AgeRestrictionDialogState.SubEighteen -> {
            AlertDialog(
                onDismissRequest = onDismiss,
                title = {
                    Text(
                        stringResource(Res.string.age_restriction_sub_eighteen_title),
                        fontWeight = FontWeight.Bold,
                    )
                },
                text = {
                    Text(
                        stringResource(Res.string.age_restriction_sub_eighteen_body),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                },
                confirmButton = {
                    TextButton(
                        onClick = {
                            onDismiss()
                            onContactSupport()
                        },
                        modifier = Modifier.testTag(TAG_SUB_EIGHTEEN_CONFIRM),
                    ) {
                        Text(stringResource(Res.string.age_restriction_sub_eighteen_confirm))
                    }
                },
                dismissButton = {
                    TextButton(
                        onClick = onDismiss,
                        modifier = Modifier.testTag(TAG_SUB_EIGHTEEN_DISMISS),
                    ) {
                        Text(stringResource(Res.string.age_restriction_dismiss))
                    }
                },
            )
        }
    }
}

const val TAG_NEEDS_VERIFICATION_CONFIRM = "ageRestriction_needsVerification_confirm"
const val TAG_NEEDS_VERIFICATION_DISMISS = "ageRestriction_needsVerification_dismiss"
const val TAG_SUB_EIGHTEEN_CONFIRM = "ageRestriction_subEighteen_confirm"
const val TAG_SUB_EIGHTEEN_DISMISS = "ageRestriction_subEighteen_dismiss"
