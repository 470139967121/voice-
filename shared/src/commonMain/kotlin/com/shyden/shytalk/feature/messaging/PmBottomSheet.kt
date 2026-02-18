package com.shyden.shytalk.feature.messaging

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import org.koin.compose.viewmodel.koinViewModel
import org.koin.core.parameter.parametersOf
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PmBottomSheet(
    onDismiss: () -> Unit,
    preOpenUserId: String? = null
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var selectedChatUserId by remember { mutableStateOf(preOpenUserId) }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState
    ) {
        if (selectedChatUserId != null) {
            // Chat view
            PmSheetChatView(
                otherUserId = selectedChatUserId!!,
                onBack = { selectedChatUserId = null }
            )
        } else {
            // Conversation list view
            PmSheetListView(
                onSelectConversation = { userId -> selectedChatUserId = userId }
            )
        }
    }
}

@Composable
private fun PmSheetListView(
    onSelectConversation: (String) -> Unit,
    viewModel: ConversationListViewModel = koinViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .height(500.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(Icons.AutoMirrored.Filled.Chat, contentDescription = null)
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = "Messages",
                style = MaterialTheme.typography.titleMedium
            )
        }
        HorizontalDivider()

        val conversations = viewModel.getFilteredConversations()
        if (conversations.isEmpty()) {
            Text(
                text = "No conversations yet",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(16.dp)
            )
        } else {
            LazyColumn {
                items(
                    items = conversations,
                    key = { it.conversation.conversationId }
                ) { cw ->
                    ConversationListItem(
                        otherUser = cw.otherUser,
                        lastMessageText = cw.conversation.lastMessage?.text,
                        lastMessageType = cw.conversation.lastMessage?.type,
                        lastMessageAt = cw.conversation.lastMessageAt,
                        unreadCount = cw.settings?.unreadCount ?: 0,
                        isMuted = cw.settings?.isMuted == true,
                        isPinned = cw.settings?.isPinned == true,
                        onClick = {
                            val otherUserId = cw.conversation.otherUserId(viewModel.currentUserId) ?: return@ConversationListItem
                            onSelectConversation(otherUserId)
                        }
                    )
                    HorizontalDivider(modifier = Modifier.padding(start = 80.dp))
                }
            }
        }
    }
}

@Composable
private fun PmSheetChatView(
    otherUserId: String,
    onBack: () -> Unit,
    viewModel: PrivateChatViewModel = koinViewModel { parametersOf(otherUserId) }
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .height(500.dp)
    ) {
        // Header with back button
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
            }
            Text(
                text = uiState.otherUser?.displayName ?: "Chat",
                style = MaterialTheme.typography.titleMedium
            )
        }
        HorizontalDivider()

        // Reuse the chat content in a condensed form
        PrivateChatScreen(
            otherUserId = otherUserId,
            onNavigateBack = onBack,
            viewModel = viewModel
        )
    }
}
