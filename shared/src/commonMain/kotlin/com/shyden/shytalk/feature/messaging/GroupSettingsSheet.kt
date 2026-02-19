package com.shyden.shytalk.feature.messaging

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.RemoveCircle
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Tab
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.shyden.shytalk.core.model.Conversation
import com.shyden.shytalk.core.model.GroupPermissions
import com.shyden.shytalk.core.model.GroupRole
import com.shyden.shytalk.core.model.MuteInfo
import com.shyden.shytalk.core.model.SystemMessageConfig
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Constants

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GroupSettingsSheet(
    conversation: Conversation?,
    conversationName: String,
    participants: List<User>,
    isAdmin: Boolean,
    isModOrAbove: Boolean,
    currentUserRole: GroupRole,
    currentUserId: String,
    groupMutes: List<MuteInfo>,
    onDismiss: () -> Unit,
    onUpdateGroupName: (String) -> Unit,
    onRemoveParticipant: (String) -> Unit,
    onLeaveGroup: () -> Unit,
    onUpdateGroupDescription: (String) -> Unit,
    onUpdateGroupRoles: (List<String>, List<String>) -> Unit,
    onUpdatePermissions: (GroupPermissions) -> Unit,
    onUpdateSystemMessageConfig: (SystemMessageConfig) -> Unit,
    onUpdateModNotifyMode: (String) -> Unit,
    onTransferOwnership: (String) -> Unit,
    onUnmuteMember: (String) -> Unit,
    onAddParticipant: (String) -> Unit
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var selectedTab by remember { mutableIntStateOf(0) }
    val tabs = listOf("General", "Members", "Permissions")
    val isOwner = currentUserRole == GroupRole.OWNER
    val permissions = conversation?.permissions ?: GroupPermissions()

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
        ) {
            PrimaryTabRow(selectedTabIndex = selectedTab) {
                tabs.forEachIndexed { index, title ->
                    Tab(
                        selected = selectedTab == index,
                        onClick = { selectedTab = index },
                        text = { Text(title) }
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            when (selectedTab) {
                0 -> GeneralTab(
                    conversation = conversation,
                    conversationName = conversationName,
                    currentUserRole = currentUserRole,
                    isAdmin = isAdmin,
                    isModOrAbove = isModOrAbove,
                    isOwner = isOwner,
                    onUpdateGroupName = onUpdateGroupName,
                    onUpdateGroupDescription = onUpdateGroupDescription,
                    onLeaveGroup = onLeaveGroup,
                    onDismiss = onDismiss
                )
                1 -> MembersTab(
                    conversation = conversation,
                    participants = participants,
                    currentUserRole = currentUserRole,
                    isOwner = isOwner,
                    currentUserId = currentUserId,
                    groupMutes = groupMutes,
                    onRemoveParticipant = onRemoveParticipant,
                    onUpdateGroupRoles = onUpdateGroupRoles,
                    onUnmuteMember = onUnmuteMember
                )
                2 -> PermissionsTab(
                    conversation = conversation,
                    isOwner = isOwner,
                    participants = participants,
                    currentUserId = currentUserId,
                    onUpdatePermissions = onUpdatePermissions,
                    onUpdateSystemMessageConfig = onUpdateSystemMessageConfig,
                    onUpdateModNotifyMode = onUpdateModNotifyMode,
                    onTransferOwnership = onTransferOwnership
                )
            }

            Spacer(modifier = Modifier.height(32.dp))
        }
    }
}

@Composable
private fun GeneralTab(
    conversation: Conversation?,
    conversationName: String,
    currentUserRole: GroupRole,
    isAdmin: Boolean,
    isModOrAbove: Boolean,
    isOwner: Boolean,
    onUpdateGroupName: (String) -> Unit,
    onUpdateGroupDescription: (String) -> Unit,
    onLeaveGroup: () -> Unit,
    onDismiss: () -> Unit
) {
    var editingName by remember { mutableStateOf(conversationName) }
    var editingDescription by remember { mutableStateOf(conversation?.groupDescription ?: "") }

    val permissions = conversation?.permissions ?: GroupPermissions()
    val canEdit = permissions.whoCanEditInfo.isAllowed(currentUserRole)

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
    ) {
        // Group name
        if (canEdit) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                OutlinedTextField(
                    value = editingName,
                    onValueChange = { editingName = it },
                    label = { Text("Group Name") },
                    modifier = Modifier.weight(1f),
                    singleLine = true
                )
                Spacer(modifier = Modifier.width(8.dp))
                OutlinedButton(
                    onClick = {
                        if (editingName.isNotBlank() && editingName != conversationName) {
                            onUpdateGroupName(editingName.trim())
                        }
                    },
                    enabled = editingName.isNotBlank() && editingName != conversationName
                ) {
                    Text("Save")
                }
            }
        } else {
            Text(text = conversationName, style = MaterialTheme.typography.titleLarge)
        }

        Spacer(modifier = Modifier.height(12.dp))

        // Description
        if (canEdit) {
            OutlinedTextField(
                value = editingDescription,
                onValueChange = {
                    if (it.length <= Constants.MAX_GROUP_DESCRIPTION_LENGTH) {
                        editingDescription = it
                    }
                },
                label = { Text("Description") },
                modifier = Modifier.fillMaxWidth(),
                maxLines = 4,
                supportingText = {
                    Text("${editingDescription.length}/${Constants.MAX_GROUP_DESCRIPTION_LENGTH}")
                }
            )
            if (editingDescription != (conversation?.groupDescription ?: "")) {
                OutlinedButton(
                    onClick = { onUpdateGroupDescription(editingDescription.trim()) },
                    modifier = Modifier.align(Alignment.End)
                ) {
                    Text("Save Description")
                }
            }
        } else if (!conversation?.groupDescription.isNullOrBlank()) {
            Text(
                text = conversation?.groupDescription ?: "",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        Spacer(modifier = Modifier.height(16.dp))
        HorizontalDivider()
        Spacer(modifier = Modifier.height(16.dp))

        // Leave/Close group button
        if (isOwner) {
            Button(
                onClick = onLeaveGroup,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
            ) {
                Text("Close Group", color = MaterialTheme.colorScheme.onError)
            }
            Text(
                text = "This will close the group for everyone. Messages are preserved for moderation.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 4.dp)
            )
        } else {
            Button(
                onClick = onLeaveGroup,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
            ) {
                Text("Leave Group", color = MaterialTheme.colorScheme.onError)
            }
        }
    }
}

@Composable
private fun MembersTab(
    conversation: Conversation?,
    participants: List<User>,
    currentUserRole: GroupRole,
    isOwner: Boolean,
    currentUserId: String,
    groupMutes: List<MuteInfo>,
    onRemoveParticipant: (String) -> Unit,
    onUpdateGroupRoles: (List<String>, List<String>) -> Unit,
    onUnmuteMember: (String) -> Unit
) {
    val permissions = conversation?.permissions ?: GroupPermissions()

    Column(modifier = Modifier.fillMaxWidth()) {
        Text(
            text = "Participants (${participants.size})",
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.primary
        )

        Spacer(modifier = Modifier.height(8.dp))

        LazyColumn(
            modifier = Modifier
                .fillMaxWidth()
                .height(300.dp)
        ) {
            items(participants, key = { it.uid }) { user ->
                val role = conversation?.roleOf(user.uid) ?: GroupRole.MEMBER
                val isMuted = groupMutes.any { it.odId == user.uid && it.isActive }

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    val photoUrl = user.photoUrl
                    if (photoUrl != null) {
                        AsyncImage(
                            model = photoUrl,
                            contentDescription = user.displayName,
                            modifier = Modifier
                                .size(40.dp)
                                .clip(CircleShape),
                            contentScale = ContentScale.Crop
                        )
                    } else {
                        Surface(
                            modifier = Modifier.size(40.dp),
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
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = user.displayName,
                            style = MaterialTheme.typography.bodyLarge,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        if (isMuted) {
                            Text(
                                text = "Muted",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.error
                            )
                        }
                    }

                    // Role badge (tappable by owner to cycle)
                    if (isOwner && user.uid != currentUserId) {
                        RoleBadge(
                            role = role,
                            onClick = {
                                val currentAdmins = conversation?.groupAdminIds?.toMutableList() ?: mutableListOf()
                                val currentMods = conversation?.groupModIds?.toMutableList() ?: mutableListOf()
                                when (role) {
                                    GroupRole.MEMBER -> {
                                        currentMods.add(user.uid)
                                    }
                                    GroupRole.MOD -> {
                                        currentMods.remove(user.uid)
                                        currentAdmins.add(user.uid)
                                    }
                                    GroupRole.ADMIN -> {
                                        currentAdmins.remove(user.uid)
                                    }
                                    GroupRole.OWNER -> {}
                                }
                                onUpdateGroupRoles(currentAdmins, currentMods)
                            }
                        )
                    } else {
                        RoleBadge(role = role)
                    }

                    // Unmute button — check whoCanMuteMembers permission
                    if (isMuted && permissions.whoCanMuteMembers.isAllowed(currentUserRole)) {
                        TextButton(onClick = { onUnmuteMember(user.uid) }) {
                            Text("Unmute", style = MaterialTheme.typography.labelSmall)
                        }
                    }

                    // Remove button — check whoCanRemoveMembers permission
                    if (permissions.whoCanRemoveMembers.isAllowed(currentUserRole)
                        && user.uid != currentUserId && role != GroupRole.OWNER
                    ) {
                        IconButton(onClick = { onRemoveParticipant(user.uid) }) {
                            Icon(
                                Icons.Default.RemoveCircle,
                                contentDescription = "Remove",
                                tint = MaterialTheme.colorScheme.error
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PermissionsTab(
    conversation: Conversation?,
    isOwner: Boolean,
    participants: List<User>,
    currentUserId: String,
    onUpdatePermissions: (GroupPermissions) -> Unit,
    onUpdateSystemMessageConfig: (SystemMessageConfig) -> Unit,
    onUpdateModNotifyMode: (String) -> Unit,
    onTransferOwnership: (String) -> Unit
) {
    val permissions = conversation?.permissions ?: GroupPermissions()
    val sysConfig = conversation?.systemMessageConfig ?: SystemMessageConfig()
    val modNotifyMode = conversation?.modNotifyMode ?: "ALL_ADMINS"
    var showTransferDialog by remember { mutableStateOf(false) }
    var transferTarget by remember { mutableStateOf<User?>(null) }

    if (!isOwner) {
        Text(
            text = "Only the group owner can change permissions.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        return
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
    ) {
        Text("Message Permissions", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
        Spacer(modifier = Modifier.height(8.dp))

        PermissionLevelSelector("Who can send messages", permissions.whoCanSend) {
            onUpdatePermissions(permissions.copy(whoCanSend = it))
        }
        PermissionLevelSelector("Who can add members", permissions.whoCanAddMembers) {
            onUpdatePermissions(permissions.copy(whoCanAddMembers = it))
        }
        PermissionLevelSelector("Who can edit group info", permissions.whoCanEditInfo) {
            onUpdatePermissions(permissions.copy(whoCanEditInfo = it))
        }
        PermissionLevelSelector("Who can delete messages", permissions.whoCanDeleteMessages) {
            onUpdatePermissions(permissions.copy(whoCanDeleteMessages = it))
        }
        PermissionLevelSelector("Who can mute members", permissions.whoCanMuteMembers) {
            onUpdatePermissions(permissions.copy(whoCanMuteMembers = it))
        }
        PermissionLevelSelector("Who can remove members", permissions.whoCanRemoveMembers) {
            onUpdatePermissions(permissions.copy(whoCanRemoveMembers = it))
        }

        Spacer(modifier = Modifier.height(16.dp))
        HorizontalDivider()
        Spacer(modifier = Modifier.height(8.dp))

        Text("System Messages", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
        Spacer(modifier = Modifier.height(8.dp))

        SysMessageRow("Member joins", sysConfig.showJoins) {
            onUpdateSystemMessageConfig(sysConfig.copy(showJoins = !sysConfig.showJoins))
        }
        SysMessageRow("Member leaves", sysConfig.showLeaves) {
            onUpdateSystemMessageConfig(sysConfig.copy(showLeaves = !sysConfig.showLeaves))
        }
        SysMessageRow("Role changes", sysConfig.showRoleChanges) {
            onUpdateSystemMessageConfig(sysConfig.copy(showRoleChanges = !sysConfig.showRoleChanges))
        }
        SysMessageRow("Permission changes", sysConfig.showPermissionChanges) {
            onUpdateSystemMessageConfig(sysConfig.copy(showPermissionChanges = !sysConfig.showPermissionChanges))
        }

        Spacer(modifier = Modifier.height(16.dp))
        HorizontalDivider()
        Spacer(modifier = Modifier.height(8.dp))

        Text("Mod Notifications", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
        Spacer(modifier = Modifier.height(8.dp))

        ModNotifyRow("Notify owner only", modNotifyMode == "OWNER_ONLY") {
            val newMode = if (modNotifyMode == "ALL_ADMINS") "OWNER_ONLY" else "ALL_ADMINS"
            onUpdateModNotifyMode(newMode)
        }

        Spacer(modifier = Modifier.height(16.dp))
        HorizontalDivider()
        Spacer(modifier = Modifier.height(8.dp))

        // Transfer Ownership
        OutlinedButton(
            onClick = { showTransferDialog = true },
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("Transfer Ownership")
        }

        // Reset to Default
        Spacer(modifier = Modifier.height(8.dp))
        OutlinedButton(
            onClick = {
                onUpdatePermissions(GroupPermissions())
                onUpdateSystemMessageConfig(SystemMessageConfig())
                onUpdateModNotifyMode("ALL_ADMINS")
            },
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("Reset to Default")
        }
    }

    if (showTransferDialog) {
        AlertDialog(
            onDismissRequest = { showTransferDialog = false },
            title = { Text("Transfer Ownership") },
            text = {
                Column {
                    Text("Select a member to transfer ownership to. You will lose owner privileges. This cannot be undone.")
                    Spacer(modifier = Modifier.height(12.dp))
                    participants.filter { it.uid != currentUserId }.forEach { user ->
                        TextButton(
                            onClick = { transferTarget = user },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(
                                text = user.displayName,
                                color = if (transferTarget?.uid == user.uid) MaterialTheme.colorScheme.primary
                                else MaterialTheme.colorScheme.onSurface
                            )
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        transferTarget?.let {
                            onTransferOwnership(it.uid)
                            showTransferDialog = false
                            transferTarget = null
                        }
                    },
                    enabled = transferTarget != null
                ) {
                    Text("Transfer", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = {
                    showTransferDialog = false
                    transferTarget = null
                }) {
                    Text("Cancel")
                }
            }
        )
    }
}

@Composable
private fun ModNotifyRow(
    label: String,
    isEnabled: Boolean,
    onToggle: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(text = label, style = MaterialTheme.typography.bodyMedium)
            Text(
                text = if (isEnabled) "Owner only" else "All admins & mods",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        Switch(checked = isEnabled, onCheckedChange = { onToggle() })
    }
}

@Composable
private fun SysMessageRow(
    label: String,
    isEnabled: Boolean,
    onToggle: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(text = label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        Switch(checked = isEnabled, onCheckedChange = { onToggle() })
    }
}
