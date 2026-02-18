package com.shyden.shytalk.feature.messaging

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Done
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.shyden.shytalk.core.model.PrivateMessage
import com.shyden.shytalk.core.model.PrivateMessageType
import com.shyden.shytalk.core.model.SendStatus
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.formatRelativeTime

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun PrivateMessageBubble(
    message: PrivateMessage,
    isSent: Boolean,
    isRead: Boolean,
    showTimestamp: Boolean,
    otherUserId: String,
    currentUserId: String = "",
    onEdit: () -> Unit,
    onReply: () -> Unit,
    onViewEditHistory: () -> Unit,
    onRetry: () -> Unit,
    onReportMessage: () -> Unit,
    onToggleReaction: (String) -> Unit = {},
    onTapReplyPreview: (() -> Unit)? = null,
    onImageClick: ((List<String>, Int) -> Unit)? = null,
    modifier: Modifier = Modifier
) {
    val clipboardManager = LocalClipboardManager.current
    var showContextMenu by remember { mutableStateOf(false) }
    var showReactionPicker by remember { mutableStateOf(false) }

    val canEdit = isSent &&
        message.sendStatus == SendStatus.SENT &&
        (currentTimeMillis() - message.createdAt) < Constants.PM_EDIT_WINDOW_MS

    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 2.dp),
        horizontalArrangement = if (isSent) Arrangement.End else Arrangement.Start,
        verticalAlignment = Alignment.Bottom
    ) {
        // Failed message retry icon
        if (isSent && message.sendStatus == SendStatus.FAILED) {
            IconButton(
                onClick = onRetry,
                modifier = Modifier.size(24.dp)
            ) {
                Icon(
                    Icons.Default.ErrorOutline,
                    contentDescription = "Retry",
                    tint = MaterialTheme.colorScheme.error,
                    modifier = Modifier.size(20.dp)
                )
            }
            Spacer(modifier = Modifier.width(4.dp))
        }

        Box {
            Column(
                modifier = Modifier
                    .widthIn(max = 280.dp)
                    .clip(
                        RoundedCornerShape(
                            topStart = 16.dp,
                            topEnd = 16.dp,
                            bottomStart = if (isSent) 16.dp else 4.dp,
                            bottomEnd = if (isSent) 4.dp else 16.dp
                        )
                    )
                    .background(
                        if (isSent) MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.surfaceVariant
                    )
                    .combinedClickable(
                        onClick = {},
                        onLongClick = { showContextMenu = true }
                    )
                    .padding(horizontal = 12.dp, vertical = 8.dp)
            ) {
                // Reply preview
                if (message.replyToMessageId != null && message.replyToSenderName != null) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(
                                if (isSent) MaterialTheme.colorScheme.primary.copy(alpha = 0.7f)
                                else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.7f)
                            )
                            .then(
                                if (onTapReplyPreview != null) Modifier.clickable { onTapReplyPreview() }
                                else Modifier
                            )
                            .padding(8.dp)
                    ) {
                        Column {
                            Text(
                                text = message.replyToSenderName!!,
                                style = MaterialTheme.typography.labelSmall,
                                color = if (isSent) MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.8f)
                                else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.8f),
                                maxLines = 1
                            )
                            Text(
                                text = message.replyToText ?: "",
                                style = MaterialTheme.typography.bodySmall,
                                color = if (isSent) MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.6f)
                                else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis
                            )
                        }
                    }
                    Spacer(modifier = Modifier.height(4.dp))
                }

                // Image grid
                if (message.type == PrivateMessageType.IMAGE && message.imageUrls.isNotEmpty()) {
                    ImageGrid(
                        imageUrls = message.imageUrls,
                        onImageClick = onImageClick
                    )
                    if (message.text.isNotBlank()) {
                        Spacer(modifier = Modifier.height(4.dp))
                    }
                }

                // Text content
                if (message.text.isNotBlank()) {
                    Text(
                        text = message.text,
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (isSent) MaterialTheme.colorScheme.onPrimary
                        else MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                // Bottom row: edited indicator + timestamp + read receipt
                Row(
                    modifier = Modifier.align(Alignment.End),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    // Edited indicator
                    if (message.editCount > 0) {
                        Text(
                            text = "Edited (${message.editCount})",
                            style = MaterialTheme.typography.labelSmall,
                            color = if (isSent) MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.6f)
                            else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                            modifier = Modifier.clickable { onViewEditHistory() }
                        )
                    }

                    // Timestamp
                    if (showTimestamp) {
                        Text(
                            text = formatRelativeTime(message.createdAt),
                            style = MaterialTheme.typography.labelSmall,
                            color = if (isSent) MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.6f)
                            else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)
                        )
                    }

                    // Read receipt (sent messages only)
                    if (isSent && message.sendStatus == SendStatus.SENT) {
                        Icon(
                            imageVector = if (isRead) Icons.Default.DoneAll else Icons.Default.Done,
                            contentDescription = if (isRead) "Read" else "Sent",
                            modifier = Modifier.size(14.dp),
                            tint = if (isSent) MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.6f)
                            else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)
                        )
                    }
                }
            }

            // Reaction badges below the bubble
            if (message.reactions.isNotEmpty()) {
                ReactionBadges(
                    reactions = message.reactions,
                    currentUserId = currentUserId,
                    onToggleReaction = onToggleReaction
                )
            }

            // Reaction picker popup
            if (showReactionPicker) {
                ReactionPicker(
                    onReact = { emoji ->
                        showReactionPicker = false
                        onToggleReaction(emoji)
                    }
                )
            }

            // Context menu
            DropdownMenu(
                expanded = showContextMenu,
                onDismissRequest = { showContextMenu = false }
            ) {
                DropdownMenuItem(
                    text = { Text("React") },
                    onClick = {
                        showContextMenu = false
                        showReactionPicker = !showReactionPicker
                    }
                )
                DropdownMenuItem(
                    text = { Text("Reply") },
                    onClick = {
                        showContextMenu = false
                        onReply()
                    }
                )
                DropdownMenuItem(
                    text = { Text("Copy") },
                    onClick = {
                        showContextMenu = false
                        clipboardManager.setText(AnnotatedString(message.text))
                    }
                )
                if (canEdit) {
                    DropdownMenuItem(
                        text = { Text("Edit") },
                        onClick = {
                            showContextMenu = false
                            onEdit()
                        }
                    )
                }
                if (!isSent) {
                    DropdownMenuItem(
                        text = { Text("Report Message") },
                        onClick = {
                            showContextMenu = false
                            onReportMessage()
                        }
                    )
                }
            }
        }
    }
}

@Composable
private fun ImageGrid(
    imageUrls: List<String>,
    onImageClick: ((List<String>, Int) -> Unit)? = null
) {
    when (imageUrls.size) {
        1 -> {
            AsyncImage(
                model = imageUrls[0],
                contentDescription = "Image",
                modifier = Modifier
                    .fillMaxWidth()
                    .height(200.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .then(
                        if (onImageClick != null) Modifier.clickable { onImageClick(imageUrls, 0) }
                        else Modifier
                    ),
                contentScale = ContentScale.Crop
            )
        }
        2 -> {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                imageUrls.forEachIndexed { index, url ->
                    AsyncImage(
                        model = url,
                        contentDescription = "Image",
                        modifier = Modifier
                            .weight(1f)
                            .height(150.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .then(
                                if (onImageClick != null) Modifier.clickable { onImageClick(imageUrls, index) }
                                else Modifier
                            ),
                        contentScale = ContentScale.Crop
                    )
                }
            }
        }
        else -> {
            // Grid layout for 3+ images
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                imageUrls.chunked(2).forEachIndexed { rowIndex, row ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        row.forEachIndexed { colIndex, url ->
                            val globalIndex = rowIndex * 2 + colIndex
                            AsyncImage(
                                model = url,
                                contentDescription = "Image",
                                modifier = Modifier
                                    .weight(1f)
                                    .height(120.dp)
                                    .clip(RoundedCornerShape(8.dp))
                                    .then(
                                        if (onImageClick != null) Modifier.clickable { onImageClick(imageUrls, globalIndex) }
                                        else Modifier
                                    ),
                                contentScale = ContentScale.Crop
                            )
                        }
                        // If odd number in last row, add spacer
                        if (row.size == 1) {
                            Spacer(modifier = Modifier.weight(1f))
                        }
                    }
                }
            }
        }
    }
}
