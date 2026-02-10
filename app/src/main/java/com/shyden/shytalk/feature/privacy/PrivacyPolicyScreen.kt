package com.shyden.shytalk.feature.privacy

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp

@Composable
fun PrivacyPolicyScreen(
    onAccept: () -> Unit,
    onDecline: () -> Unit,
    showActions: Boolean = true
) {
    Scaffold { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            Column(
                modifier = Modifier
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 20.dp, vertical = 16.dp)
            ) {
                Text(
                    text = "ShyTalk Privacy Policy",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = "Effective date: February 9, 2026",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(modifier = Modifier.height(16.dp))

                Text(
                    text = "ShyTalk (\"we\", \"our\", \"the app\") is a social voice-chat application. This policy describes what information we collect, how we use it, and your choices regarding your data.",
                    style = MaterialTheme.typography.bodyMedium
                )

                SectionTitle("1. Information We Collect")
                BulletItem(buildAnnotatedString {
                    withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append("Account information") }
                    append(" \u2013 display name, profile photo, and nationality you provide during setup.")
                })
                BulletItem(buildAnnotatedString {
                    withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append("Phone number or Google account") }
                    append(" \u2013 used solely for authentication via Firebase Authentication.")
                })
                BulletItem(buildAnnotatedString {
                    withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append("Voice audio") }
                    append(" \u2013 transmitted in real time during voice chat sessions through the Agora SDK. Audio is streamed peer-to-peer and is ")
                    withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append("not") }
                    append(" recorded or stored by ShyTalk.")
                })
                BulletItem(buildAnnotatedString {
                    withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append("Device identifier (Android ID)") }
                    append(" \u2013 a per-device identifier used to enforce a one-account-per-device policy and prevent abuse.")
                })
                BulletItem(buildAnnotatedString {
                    withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append("Usage data") }
                    append(" \u2013 chat room participation and seat activity, stored in Cloud Firestore to operate the service.")
                })

                SectionTitle("2. How We Use Your Information")
                BulletText("Create and manage your account.")
                BulletText("Enable real-time voice communication in chat rooms.")
                BulletText("Display your profile to other users.")
                BulletText("Enforce our one-account-per-device policy to prevent abuse.")
                BulletText("Moderate content and enforce community guidelines.")

                SectionTitle("3. Third-Party Services")
                Text(
                    text = "ShyTalk relies on the following third-party services, each with their own privacy policies:",
                    style = MaterialTheme.typography.bodyMedium
                )
                Spacer(modifier = Modifier.height(4.dp))
                BulletItem(buildAnnotatedString {
                    withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append("Firebase") }
                    append(" (Google) \u2013 authentication, database, and analytics.")
                })
                BulletItem(buildAnnotatedString {
                    withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append("Agora") }
                    append(" \u2013 real-time voice communication.")
                })

                SectionTitle("4. Microphone Permission")
                Text(
                    text = "ShyTalk requests access to your device\u2019s microphone (RECORD_AUDIO) exclusively for real-time voice chat within chat rooms. The microphone is only active while you occupy a seat in a voice room. Audio is streamed in real time and is never recorded or stored.",
                    style = MaterialTheme.typography.bodyMedium
                )

                SectionTitle("5. Data Retention & Deletion")
                Text(
                    text = "Your account data is retained as long as your account exists. You may delete your account at any time from within the app, which will remove your profile information from our systems. Device-binding records may be retained for a limited period to prevent re-abuse.",
                    style = MaterialTheme.typography.bodyMedium
                )

                SectionTitle("6. Requesting Deletion of Your Data")
                Text(
                    text = "If you are unable to delete your account through the app or would like to request that all of your stored personal data be deleted, you may send a request to shytalk.help@gmail.com. Please include the email address associated with your account so we can verify your identity. We will process your request and delete your data within 30 days.",
                    style = MaterialTheme.typography.bodyMedium
                )

                SectionTitle("7. Data Security")
                Text(
                    text = "We use industry-standard security measures provided by Firebase and Agora, including encrypted data transmission (TLS). However, no method of electronic transmission or storage is 100% secure.",
                    style = MaterialTheme.typography.bodyMedium
                )

                SectionTitle("8. Children\u2019s Privacy")
                Text(
                    text = "ShyTalk is not intended for children under 13. We do not knowingly collect personal information from children under 13. If we become aware of such collection, we will promptly delete the data.",
                    style = MaterialTheme.typography.bodyMedium
                )

                SectionTitle("9. Changes to This Policy")
                Text(
                    text = "We may update this policy from time to time. Changes will be posted on this page with an updated effective date.",
                    style = MaterialTheme.typography.bodyMedium
                )

                SectionTitle("10. Contact Us")
                Text(
                    text = "If you have questions about this privacy policy, please contact us at shytalk.help@gmail.com.",
                    style = MaterialTheme.typography.bodyMedium
                )

                Spacer(modifier = Modifier.height(24.dp))
            }

            if (showActions) {
                HorizontalDivider()
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    OutlinedButton(
                        onClick = onDecline,
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.outlinedButtonColors(
                            contentColor = MaterialTheme.colorScheme.error
                        )
                    ) {
                        Text("Decline")
                    }
                    Button(
                        onClick = onAccept,
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("Accept")
                    }
                }
            }
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Spacer(modifier = Modifier.height(16.dp))
    Text(
        text = text,
        style = MaterialTheme.typography.titleSmall,
        fontWeight = FontWeight.Bold
    )
    Spacer(modifier = Modifier.height(4.dp))
}

@Composable
private fun BulletText(text: String) {
    Text(
        text = "\u2022  $text",
        style = MaterialTheme.typography.bodyMedium,
        modifier = Modifier.padding(start = 8.dp, bottom = 4.dp)
    )
}

@Composable
private fun BulletItem(annotatedString: androidx.compose.ui.text.AnnotatedString) {
    Text(
        text = buildAnnotatedString {
            append("\u2022  ")
            append(annotatedString)
        },
        style = MaterialTheme.typography.bodyMedium,
        modifier = Modifier.padding(start = 8.dp, bottom = 4.dp)
    )
}
