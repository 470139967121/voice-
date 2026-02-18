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
fun CommunityStandardsScreen(
    onNavigateBack: () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Community Standards") },
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
                text = "ShyTalk Community Standards",
                style = MaterialTheme.typography.headlineSmall
            )
            Spacer(modifier = Modifier.height(16.dp))

            SectionTitle("1. Respectful Behavior")
            SectionBody("Treat all users with respect and kindness. ShyTalk is a community built on positive interactions. Harassment, bullying, intimidation, or threatening behavior toward any user is strictly prohibited.")

            SectionTitle("2. No Hate Speech")
            SectionBody("Content that promotes hatred, discrimination, or violence based on race, ethnicity, national origin, religion, gender, gender identity, sexual orientation, disability, or any other protected characteristic is not allowed.")

            SectionTitle("3. Private Messaging Guidelines")
            SectionBody("Private messages are a privilege, not a right. Do not send unsolicited inappropriate content, spam, or repeated unwanted messages. Respect other users' privacy settings and boundaries. If someone does not wish to communicate with you, respect their decision.")

            SectionTitle("4. No Inappropriate Content")
            SectionBody("Do not share sexually explicit content, graphic violence, or content depicting illegal activities. This applies to text messages, images, profile photos, and voice chat.")

            SectionTitle("5. No Spam or Scams")
            SectionBody("Do not send spam messages, advertisements, or phishing attempts. Do not attempt to deceive users for financial gain or personal information.")

            SectionTitle("6. Account Integrity")
            SectionBody("Do not impersonate other users, public figures, or ShyTalk staff. Do not create multiple accounts to evade bans or restrictions. Do not share your account credentials with others.")

            SectionTitle("7. Reporting Process")
            SectionBody("If you encounter a violation of these standards, please use the in-app reporting feature. Reports are reviewed by our moderation team. False reports intended to harass other users may result in action against the reporter.")

            SectionTitle("8. Consequences")
            SectionBody("Violations of these standards may result in warnings, temporary suspension, or permanent account termination, depending on the severity and frequency of the violation. Decisions are made by the ShyTalk moderation team and may be appealed through the in-app appeal process.")

            SectionTitle("9. Changes to Standards")
            SectionBody("ShyTalk reserves the right to update these Community Standards at any time. Users will be notified of significant changes and may be required to re-accept the updated standards.")

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
