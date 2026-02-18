package com.shyden.shytalk.feature.messaging

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.shyden.shytalk.core.model.MessageEdit
import com.shyden.shytalk.core.model.PrivateMessage
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.formatRelativeTime
import com.shyden.shytalk.ui.theme.SpeakingGreen
import kotlinx.coroutines.launch
import org.koin.compose.viewmodel.koinViewModel
import org.koin.core.parameter.parametersOf
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.datetime.Instant
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PrivateChatScreen(
    otherUserId: String,
    onNavigateBack: () -> Unit,
    onNavigateToUserProfile: (String) -> Unit = {},
    modifier: Modifier = Modifier,
    viewModel: PrivateChatViewModel = koinViewModel { parametersOf(otherUserId) }
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()

    var messageText by remember { mutableStateOf("") }
    var showOverflowMenu by remember { mutableStateOf(false) }
    var showEditHistory by remember { mutableStateOf<Pair<String, String>?>(null) } // messageId, currentText
    var editHistoryData by remember { mutableStateOf<List<MessageEdit>>(emptyList()) }
    var reportingMessage by remember { mutableStateOf<PrivateMessage?>(null) }

    // Auto-scroll to bottom when new messages arrive
    LaunchedEffect(uiState.messages.size) {
        if (uiState.messages.isNotEmpty()) {
            listState.animateScrollToItem(uiState.messages.size - 1)
        }
    }

    // Mark messages as read when viewing
    LaunchedEffect(uiState.messages) {
        viewModel.markMessagesAsRead()
    }

    // Pre-populate text field when editing
    LaunchedEffect(uiState.editingMessageId) {
        if (uiState.editingMessageId != null) {
            messageText = uiState.editingOriginalText
        }
    }

    LaunchedEffect(uiState.error) {
        uiState.error?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearError()
        }
    }

    // Fetch edit history when requested
    LaunchedEffect(showEditHistory) {
        showEditHistory?.let { (messageId, _) ->
            editHistoryData = viewModel.getEditHistory(messageId)
        }
    }

    val otherUser = uiState.otherUser
    val isOnline = otherUser?.hideOnlineStatus != true &&
        (otherUser?.lastSeenAt ?: 0) > currentTimeMillis() - Constants.ONLINE_THRESHOLD_MS

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                title = {
                    Row(
                        modifier = Modifier.clickable { otherUser?.uid?.let { onNavigateToUserProfile(it) } },
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        // Avatar
                        val photoUrl = otherUser?.photoUrl
                        if (photoUrl != null) {
                            AsyncImage(
                                model = photoUrl,
                                contentDescription = otherUser.displayName,
                                modifier = Modifier
                                    .size(36.dp)
                                    .clip(CircleShape),
                                contentScale = ContentScale.Crop
                            )
                        } else {
                            Surface(
                                modifier = Modifier.size(36.dp),
                                shape = CircleShape,
                                color = MaterialTheme.colorScheme.primaryContainer
                            ) {
                                Icon(
                                    Icons.Default.Person,
                                    contentDescription = null,
                                    modifier = Modifier.padding(8.dp),
                                    tint = MaterialTheme.colorScheme.onPrimaryContainer
                                )
                            }
                        }
                        Spacer(modifier = Modifier.width(12.dp))
                        Column {
                            Text(
                                text = otherUser?.displayName ?: "Chat",
                                style = MaterialTheme.typography.titleMedium,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            if (uiState.isOtherUserTyping) {
                                Text(
                                    text = "typing...",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = SpeakingGreen
                                )
                            } else if (otherUser?.hideOnlineStatus != true) {
                                Text(
                                    text = if (isOnline) "Online" else otherUser?.lastSeenAt?.let { "Last seen ${formatRelativeTime(it)}" } ?: "",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = if (isOnline) SpeakingGreen else MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.toggleSearch() }) {
                        Icon(Icons.Default.Search, contentDescription = "Search messages")
                    }
                    Box {
                        IconButton(onClick = { showOverflowMenu = true }) {
                            Icon(Icons.Default.MoreVert, contentDescription = "More options")
                        }
                        DropdownMenu(
                            expanded = showOverflowMenu,
                            onDismissRequest = { showOverflowMenu = false }
                        ) {
                            DropdownMenuItem(
                                text = { Text(if (uiState.isMuted) "Unmute Notifications" else "Mute Notifications") },
                                onClick = {
                                    showOverflowMenu = false
                                    viewModel.toggleMute()
                                }
                            )
                            DropdownMenuItem(
                                text = { Text(if (uiState.isSilent) "Disable Silent Mode" else "Silent Mode") },
                                onClick = {
                                    showOverflowMenu = false
                                    viewModel.toggleSilent()
                                }
                            )
                            DropdownMenuItem(
                                text = { Text(if (uiState.isPinned) "Unpin" else "Pin") },
                                onClick = {
                                    showOverflowMenu = false
                                    viewModel.togglePin()
                                }
                            )
                            DropdownMenuItem(
                                text = { Text("View Profile") },
                                onClick = {
                                    showOverflowMenu = false
                                    otherUser?.uid?.let { onNavigateToUserProfile(it) }
                                }
                            )
                            HorizontalDivider()
                            DropdownMenuItem(
                                text = {
                                    Text(
                                        "Delete Conversation",
                                        color = MaterialTheme.colorScheme.error
                                    )
                                },
                                onClick = {
                                    showOverflowMenu = false
                                    viewModel.hideConversation()
                                    onNavigateBack()
                                }
                            )
                        }
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = modifier
                .fillMaxSize()
                .padding(padding)
                .imePadding()
        ) {
            // Blocked banner
            if (uiState.isBlocked) {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    color = MaterialTheme.colorScheme.errorContainer
                ) {
                    Text(
                        text = uiState.blockReason ?: "You can't message this user",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
                    )
                }
            }

            // Search bar
            if (uiState.isSearching) {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    tonalElevation = 2.dp
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 8.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        OutlinedTextField(
                            value = uiState.searchQuery,
                            onValueChange = { viewModel.searchMessages(it) },
                            placeholder = { Text("Search messages...") },
                            modifier = Modifier.weight(1f),
                            singleLine = true,
                            shape = RoundedCornerShape(24.dp),
                            leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) }
                        )
                        IconButton(onClick = { viewModel.toggleSearch() }) {
                            Icon(Icons.Default.Close, contentDescription = "Close search")
                        }
                    }
                }
                if (uiState.searchResults.isNotEmpty()) {
                    Text(
                        text = "${uiState.searchResults.size} result(s)",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)
                    )
                }
            }

            if (uiState.isLoading) {
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            } else {
                // Messages list
                LazyColumn(
                    state = listState,
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth(),
                    reverseLayout = false
                ) {
                    // Load more indicator
                    if (uiState.isLoadingOlder) {
                        item {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(8.dp),
                                contentAlignment = Alignment.Center
                            ) {
                                CircularProgressIndicator(modifier = Modifier.size(24.dp))
                            }
                        }
                    }

                    // Date separator logic
                    val messages = if (uiState.isSearching && uiState.searchQuery.length >= 2) uiState.searchResults else uiState.messages
                    val showDateSeparators = uiState.currentUser?.pmShowDateSeparators != false
                    val showTimestamps = uiState.currentUser?.pmShowTimestamps != false

                    items(
                        items = messages,
                        key = { it.messageId }
                    ) { message ->
                        val index = messages.indexOf(message)

                        // Date separator
                        if (showDateSeparators && index > 0) {
                            val prevDate = Instant.fromEpochMilliseconds(messages[index - 1].createdAt)
                                .toLocalDateTime(TimeZone.currentSystemDefault()).date
                            val currDate = Instant.fromEpochMilliseconds(message.createdAt)
                                .toLocalDateTime(TimeZone.currentSystemDefault()).date
                            if (prevDate != currDate) {
                                DateSeparator(message.createdAt)
                            }
                        } else if (showDateSeparators && index == 0) {
                            DateSeparator(message.createdAt)
                        }

                        val isSent = message.senderId == uiState.currentUserId
                        val isRead = message.readBy.contains(
                            uiState.otherUser?.uid ?: ""
                        )

                        PrivateMessageBubble(
                            message = message,
                            isSent = isSent,
                            isRead = isRead,
                            showTimestamp = showTimestamps,
                            otherUserId = otherUserId,
                            currentUserId = uiState.currentUserId,
                            onEdit = { viewModel.startEditing(message) },
                            onReply = { viewModel.startReply(message) },
                            onViewEditHistory = {
                                showEditHistory = message.messageId to message.text
                            },
                            onRetry = { /* Failed message retry handled in future phase */ },
                            onReportMessage = { reportingMessage = message },
                            onToggleReaction = { emoji -> viewModel.toggleReaction(message.messageId, emoji) }
                        )
                    }
                }
            }

            // Reply preview bar
            uiState.replyingToMessage?.let { replyMsg ->
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    tonalElevation = 2.dp
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Box(
                            modifier = Modifier
                                .width(3.dp)
                                .height(32.dp)
                                .background(MaterialTheme.colorScheme.primary, RoundedCornerShape(2.dp))
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = "Replying to ${replyMsg.senderName}",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.primary
                            )
                            Text(
                                text = if (replyMsg.imageUrls.isNotEmpty()) "[Image]" else replyMsg.text,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        }
                        IconButton(onClick = { viewModel.cancelReply() }) {
                            Icon(Icons.Default.Close, contentDescription = "Cancel reply", modifier = Modifier.size(18.dp))
                        }
                    }
                }
            }

            // Editing indicator
            if (uiState.editingMessageId != null) {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    tonalElevation = 2.dp
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            Icons.Default.Edit,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(18.dp)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "Editing message",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.weight(1f)
                        )
                        IconButton(onClick = {
                            viewModel.cancelEditing()
                            messageText = ""
                        }) {
                            Icon(Icons.Default.Close, contentDescription = "Cancel edit", modifier = Modifier.size(18.dp))
                        }
                    }
                }
            }

            // Input row
            if (!uiState.isBlocked) {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    tonalElevation = 3.dp
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 8.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.Bottom
                    ) {
                        OutlinedTextField(
                            value = messageText,
                            onValueChange = {
                                if (it.length <= Constants.MAX_PM_MESSAGE_LENGTH) {
                                    messageText = it
                                    if (it.isNotEmpty()) viewModel.onTextChanged()
                                }
                            },
                            placeholder = { Text("Message...") },
                            modifier = Modifier.weight(1f),
                            maxLines = 4,
                            shape = RoundedCornerShape(24.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        IconButton(
                            onClick = {
                                val text = messageText.trim()
                                if (text.isNotEmpty()) {
                                    if (uiState.editingMessageId != null) {
                                        viewModel.submitEdit(text)
                                    } else {
                                        viewModel.sendMessage(text)
                                    }
                                    messageText = ""
                                }
                            },
                            enabled = messageText.isNotBlank()
                        ) {
                            Icon(
                                Icons.AutoMirrored.Filled.Send,
                                contentDescription = "Send",
                                tint = if (messageText.isNotBlank()) MaterialTheme.colorScheme.primary
                                else MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }
        }
    }

    // Edit history dialog
    showEditHistory?.let { (messageId, currentText) ->
        EditHistoryDialog(
            edits = editHistoryData,
            currentText = currentText,
            onDismiss = {
                showEditHistory = null
                editHistoryData = emptyList()
            }
        )
    }

    // Report dialog
    reportingMessage?.let { msg ->
        ReportMessageDialog(
            onDismiss = { reportingMessage = null },
            onSubmit = { reason, description ->
                viewModel.reportMessage(msg, reason, description)
                reportingMessage = null
            }
        )
    }
}

private val reportReasons = listOf("Spam", "Harassment", "Inappropriate Content", "Other")

@Composable
private fun ReportMessageDialog(
    onDismiss: () -> Unit,
    onSubmit: (reason: String, description: String) -> Unit
) {
    var selectedReason by remember { mutableStateOf(reportReasons[0]) }
    var description by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Report Message") },
        text = {
            Column {
                Text(
                    text = "Why are you reporting this message?",
                    style = MaterialTheme.typography.bodyMedium
                )
                Spacer(modifier = Modifier.height(8.dp))
                reportReasons.forEach { reason ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { selectedReason = reason }
                            .padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        RadioButton(
                            selected = selectedReason == reason,
                            onClick = { selectedReason = reason }
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(text = reason, style = MaterialTheme.typography.bodyMedium)
                    }
                }
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedTextField(
                    value = description,
                    onValueChange = { description = it },
                    placeholder = { Text("Additional details (optional)") },
                    modifier = Modifier.fillMaxWidth(),
                    maxLines = 3
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { onSubmit(selectedReason, description) }) {
                Text("Submit Report")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        }
    )
}

@Composable
private fun DateSeparator(timestampMs: Long) {
    val tz = TimeZone.currentSystemDefault()
    val date = Instant.fromEpochMilliseconds(timestampMs).toLocalDateTime(tz).date
    val today = Instant.fromEpochMilliseconds(currentTimeMillis()).toLocalDateTime(tz).date

    val label = when {
        date == today -> "Today"
        date.toEpochDays() == today.toEpochDays() - 1 -> "Yesterday"
        else -> {
            val month = date.month.name.lowercase().replaceFirstChar { it.uppercase() }.take(3)
            "$month ${date.dayOfMonth}, ${date.year}"
        }
    }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
        contentAlignment = Alignment.Center
    ) {
        Surface(
            shape = RoundedCornerShape(12.dp),
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f)
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp)
            )
        }
    }
}
