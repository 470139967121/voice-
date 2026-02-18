package com.shyden.shytalk.feature.legal

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TermsAndConditionsScreen(
    onNavigateBack: () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Terms & Conditions") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 16.dp)
                .verticalScroll(rememberScrollState())
        ) {
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "ShyTalk Terms & Conditions",
                style = MaterialTheme.typography.headlineSmall
            )
            Spacer(modifier = Modifier.height(16.dp))

            SectionTitle("1. Acceptance of Terms")
            SectionBody("By creating an account and using ShyTalk, you agree to be bound by these Terms & Conditions, our Privacy Policy, and our Community Standards. If you do not agree, you may not use the service.")

            SectionTitle("2. Account Responsibilities")
            SectionBody("You are responsible for maintaining the security of your account. You must provide accurate information during registration. You must be at least 13 years old to use ShyTalk. One account per person is allowed.")

            SectionTitle("3. Acceptable Use")
            SectionBody("You agree to use ShyTalk only for lawful purposes and in accordance with our Community Standards. You will not use the service to distribute malware, collect user data without consent, or engage in any activity that disrupts the service.")

            SectionTitle("4. Content Ownership")
            SectionBody("You retain ownership of content you create on ShyTalk. By posting content, you grant ShyTalk a non-exclusive, royalty-free license to display and distribute your content within the platform. ShyTalk does not claim ownership of user-generated content.")

            SectionTitle("5. Privacy")
            SectionBody("Your use of ShyTalk is subject to our Privacy Policy. Private messages are stored on our servers and are accessible to our moderation team when investigating reported content. We do not sell your personal data to third parties.")

            SectionTitle("6. Termination")
            SectionBody("ShyTalk reserves the right to suspend or terminate your account at any time for violations of these terms or our Community Standards. You may delete your account at any time by contacting support.")

            SectionTitle("7. Limitation of Liability")
            SectionBody("ShyTalk is provided \"as is\" without warranties of any kind. We are not liable for any damages arising from your use of the service, including but not limited to loss of data, interruption of service, or actions of other users.")

            SectionTitle("8. Changes to Terms")
            SectionBody("We may update these Terms & Conditions at any time. Continued use of ShyTalk after changes constitutes acceptance of the new terms. Significant changes will require re-acceptance within the app.")

            SectionTitle("9. Contact")
            SectionBody("For questions about these terms, contact us at shytalk.help@gmail.com.")

            Spacer(modifier = Modifier.height(32.dp))
        }
    }
}

@Composable
private fun SectionTitle(title: String) {
    Spacer(modifier = Modifier.height(16.dp))
    Text(
        text = title,
        style = MaterialTheme.typography.titleMedium
    )
    Spacer(modifier = Modifier.height(4.dp))
}

@Composable
private fun SectionBody(body: String) {
    Text(
        text = body,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant
    )
}
