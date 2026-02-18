package com.shyden.shytalk.feature.messaging

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material3.Badge
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.formatRelativeTime
import com.shyden.shytalk.ui.theme.SpeakingGreen

@Composable
fun ConversationListItem(
    otherUser: User?,
    lastMessageText: String?,
    lastMessageType: String?,
    lastMessageAt: Long,
    unreadCount: Long,
    isMuted: Boolean,
    isPinned: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Avatar
        val photoUrl = otherUser?.photoUrl
        if (photoUrl != null) {
            AsyncImage(
                model = photoUrl,
                contentDescription = otherUser.displayName,
                modifier = Modifier
                    .size(52.dp)
                    .clip(CircleShape),
                contentScale = ContentScale.Crop
            )
        } else {
            Surface(
                modifier = Modifier.size(52.dp),
                shape = CircleShape,
                color = MaterialTheme.colorScheme.primaryContainer
            ) {
                Icon(
                    Icons.Default.Person,
                    contentDescription = null,
                    modifier = Modifier.padding(14.dp),
                    tint = MaterialTheme.colorScheme.onPrimaryContainer
                )
            }
        }

        Spacer(modifier = Modifier.width(12.dp))

        // Name + message preview
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                Text(
                    text = otherUser?.displayName ?: "Unknown",
                    style = MaterialTheme.typography.bodyLarge,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false)
                )
                if (isPinned) {
                    Icon(
                        Icons.Default.PushPin,
                        contentDescription = "Pinned",
                        modifier = Modifier.size(14.dp),
                        tint = MaterialTheme.colorScheme.primary
                    )
                }
                if (isMuted) {
                    Icon(
                        Icons.Default.NotificationsOff,
                        contentDescription = "Muted",
                        modifier = Modifier.size(14.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            // Online status or last message preview
            val onlineThreshold = currentTimeMillis() - Constants.ONLINE_THRESHOLD_MS
            val isOnline = otherUser?.hideOnlineStatus != true &&
                (otherUser?.lastSeenAt ?: 0) > onlineThreshold

            val previewText = when {
                lastMessageType == "IMAGE" -> "[Image]"
                !lastMessageText.isNullOrBlank() -> lastMessageText
                else -> "Start a conversation"
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (isOnline) {
                    Box(
                        modifier = Modifier
                            .size(8.dp)
                            .clip(CircleShape)
                            .background(SpeakingGreen)
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                }
                Text(
                    text = previewText,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }

        Spacer(modifier = Modifier.width(8.dp))

        // Timestamp + unread badge
        Column(
            horizontalAlignment = Alignment.End,
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Text(
                text = formatRelativeTime(lastMessageAt),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            if (unreadCount > 0) {
                Badge(
                    containerColor = MaterialTheme.colorScheme.primary
                ) {
                    Text(
                        text = if (unreadCount > 99) "99+" else "$unreadCount",
                        style = MaterialTheme.typography.labelSmall
                    )
                }
            }
        }
    }
}
