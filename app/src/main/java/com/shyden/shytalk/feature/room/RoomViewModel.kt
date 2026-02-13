package com.shyden.shytalk.feature.room

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.model.Message
import com.shyden.shytalk.core.model.RoomRole
import com.shyden.shytalk.core.model.RoomState
import com.shyden.shytalk.core.model.SeatRequest
import com.shyden.shytalk.core.model.SeatRequestStatus
import com.shyden.shytalk.core.model.SeatState
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.room.ActiveRoomManager
import com.shyden.shytalk.data.remote.AgoraVoiceService
import com.shyden.shytalk.data.remote.PresenceService
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.MessageRepository
import com.shyden.shytalk.data.repository.RoomRepository
import com.shyden.shytalk.data.repository.SeatRequestRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.google.firebase.Timestamp
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.update
import com.shyden.shytalk.core.util.toAgoraUid
import android.util.Log
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed class BlockWarning {
    data object BlockedByRoomOwner : BlockWarning()
    data object BlockedUserInRoom : BlockWarning()
    data object BlockedByUserInRoom : BlockWarning()
}

data class RoomClosedSummary(
    val roomName: String,
    val durationMs: Long,
    val hostUsers: List<User>,
    val totalVisitors: Int
)

data class RoomUiState(
    val room: ChatRoom? = null,
    val messages: List<Message> = emptyList(),
    val currentUserId: String = "",
    val currentUserName: String = "",
    val currentRole: RoomRole = RoomRole.ATTENDEE,
    val isLoading: Boolean = true,
    val error: String? = null,
    val roomClosed: Boolean = false,
    val roomClosedSummary: RoomClosedSummary? = null,
    val ownerAwayRemainingMs: Long = 0L,
    val roomExpiryRemainingMs: Long = 0L,
    val speakingUids: Set<Int> = emptySet(),
    val isVoiceJoined: Boolean = false,
    val pendingInvite: String? = null,
    val seatUsers: Map<String, User> = emptyMap(),
    val participantUsers: Map<String, User> = emptyMap(),
    val blockedUserIds: Set<String> = emptySet(),
    val blockWarning: BlockWarning? = null,
    val hasJoined: Boolean = false,
    val shouldNavigateBack: Boolean = false,
    val wasKicked: Boolean = false,
    val hasAudioPermission: Boolean = false,
    val activeNotification: RoomNotification? = null,
    val pendingRequestsForPanel: List<SeatRequest> = emptyList(),
    val kickedByName: String? = null,
    val kickReason: String? = null,
    val disconnectedUserIds: Set<String> = emptySet()
)

@HiltViewModel
class RoomViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val roomRepository: RoomRepository,
    private val messageRepository: MessageRepository,
    private val authRepository: AuthRepository,
    private val userRepository: UserRepository,
    private val seatRequestRepository: SeatRequestRepository,
    private val agoraVoiceService: AgoraVoiceService,
    private val presenceService: PresenceService,
    private val activeRoomManager: ActiveRoomManager
) : ViewModel() {

    companion object {
        private const val TAG = "RoomViewModel"
    }

    private val roomId: String = savedStateHandle["roomId"] ?: ""

    private val _uiState = MutableStateFlow(RoomUiState())
    val uiState: StateFlow<RoomUiState> = _uiState.asStateFlow()

    private var ownerAwayCountdownJob: Job? = null
    private var roomExpiryCountdownJob: Job? = null
    private var isSeated = false
    private val userCache: MutableMap<String, User> = java.util.concurrent.ConcurrentHashMap()
    private var blockCheckDone = false
    @Volatile private var firstJoinTimestamp: Timestamp? = null
    private var allMessages: List<Message> = emptyList()
    private var lastKnownRoom: ChatRoom? = null
    private var ownerReturnTriggered = false
    private var lastSeatedUserIds: Set<String> = emptySet()
    private var lastParticipantIds: Set<String> = emptySet()
    private var lastOwnerAwayState: Pair<RoomState, Timestamp?>? = null
    private var lastFilteredMessages: List<Message> = emptyList()

    // Notification queue state
    private val notificationQueue = mutableListOf<RoomNotification>()
    private var autoDismissJob: Job? = null
    private val processedRequestIds = mutableSetOf<String>()
    private val processedApprovalIds = mutableSetOf<String>()

    init {
        val userId = authRepository.currentUser?.uid ?: ""
        _uiState.value = _uiState.value.copy(currentUserId = userId)
        loadUserName()
        loadBlockedUsers()
        observeRoom()
        observeMessages()
        observeVoiceState()
        observeDisconnectedUsers()
        observePendingRequests()
        observeMyRequest()
    }

    private fun loadUserName() {
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            when (val result = userRepository.getUser(userId)) {
                is Resource.Success -> {
                    _uiState.update { it.copy(currentUserName = result.data.displayName) }
                }
                else -> {}
            }
        }
    }

    private fun observeRoom() {
        viewModelScope.launch {
            roomRepository.getRoomFlow(roomId)
                .catch { e ->
                    _uiState.update { it.copy(isLoading = false, error = e.message) }
                }
                .collect { room ->
                    if (room == null || room.state == RoomState.CLOSED) {
                        handleRoomClosed(room)
                        return@collect
                    }

                    lastKnownRoom = room
                    val userId = _uiState.value.currentUserId

                    if (_uiState.value.hasJoined && handleKickedOrRemoved(room, userId)) {
                        return@collect
                    }

                    val role = room.resolveRole(userId)

                    if (!blockCheckDone && !_uiState.value.hasJoined) {
                        handleFirstJoin(room, userId, role)
                        return@collect
                    }

                    handleOwnerReturnDetection(room, userId)
                    handleNormalUpdate(room, userId, role)
                }
        }
    }

    private fun handleRoomClosed(room: ChatRoom?) {
        disconnectFromRoom()

        viewModelScope.launch {
            // Fetch host user data so the summary can display them
            if (room != null) {
                val uncachedHostIds = (room.hostIds + room.ownerId).filter { it !in userCache }
                if (uncachedHostIds.isNotEmpty()) {
                    when (val result = userRepository.getUsers(uncachedHostIds)) {
                        is Resource.Success -> result.data.forEach { user -> userCache[user.uid] = user }
                        else -> {}
                    }
                }
            }
            val summary = buildClosedSummary(room)
            _uiState.update { it.copy(isLoading = false, roomClosed = true, roomClosedSummary = summary) }
        }
    }

    private fun disconnectFromRoom() {
        agoraVoiceService.leaveChannel()
        presenceService.removePresence()
        activeRoomManager.untrackRoom()
    }

    /** Returns true if user was kicked/removed and collection should stop. */
    private fun handleKickedOrRemoved(room: ChatRoom, userId: String): Boolean {
        if (userId in room.bannedUserIds) {
            disconnectFromRoom()
            val info = room.kickInfo[userId]
            _uiState.update {
                it.copy(
                    isLoading = false,
                    wasKicked = true,
                    kickedByName = info?.get("kickerName"),
                    kickReason = info?.get("reason") ?: "No reason given"
                )
            }
            return true
        }
        if (userId !in room.participantIds) {
            disconnectFromRoom()
            _uiState.update { it.copy(isLoading = false, shouldNavigateBack = true) }
            return true
        }
        return false
    }

    private fun handleFirstJoin(room: ChatRoom, userId: String, role: RoomRole) {
        blockCheckDone = true

        // Detect "already joined" state (ViewModel recreated after back navigation)
        val alreadyInRoom = userId in room.participantIds && activeRoomManager.isInRoom(roomId)
        if (alreadyInRoom) {
            _uiState.update { it.copy(room = room, currentRole = role, isLoading = false, hasJoined = true) }
            // Track seat state so handleNormalUpdate detects transitions correctly
            isSeated = room.findUserSeat(userId) != null
            // Rejoin voice if not already connected (ViewModel recreated)
            if (room.agoraChannelName.isNotEmpty()) {
                val asBroadcaster = isSeated && _uiState.value.hasAudioPermission
                viewModelScope.launch {
                    agoraVoiceService.joinChannel(room.agoraChannelName, userId.toAgoraUid(), asBroadcaster = asBroadcaster)
                }
            }
            activeRoomManager.updateTrackedRoom(room)
            loadSeatUsers(room)
            loadParticipantUsers(room)
            handleOwnerAwayCountdown(room)
            handleRoomExpiryCountdown(room)
            return
        }

        _uiState.update { it.copy(room = room, currentRole = role, isLoading = false) }
        if (room.ownerId == userId) {
            joinRoom()
        } else {
            checkBlockConflicts(room)
        }
        loadSeatUsers(room)
        loadParticipantUsers(room)
        handleOwnerAwayCountdown(room)
        handleRoomExpiryCountdown(room)
    }

    private fun handleOwnerReturnDetection(room: ChatRoom, userId: String) {
        if (room.ownerId != userId || !_uiState.value.hasJoined) return

        // Self-heal: if owner is online but somehow not in seat 0, restore immediately
        val ownerInSeat0 = room.seats[Constants.OWNER_SEAT_INDEX.toString()]?.isOccupiedBy(userId) == true
        if (!ownerInSeat0 && activeRoomManager.isInRoom(roomId) && !ownerReturnTriggered) {
            Log.w(TAG, "Owner self-heal: not in seat 0, restoring via setOwnerReturned")
            ownerReturnTriggered = true
            ownerReturn()
            return
        }

        if (room.state == RoomState.OWNER_AWAY
            && !ownerReturnTriggered
            && activeRoomManager.isInRoom(roomId)
        ) {
            ownerReturnTriggered = true
            ownerReturn()
        }
        if (room.state == RoomState.ACTIVE) {
            ownerReturnTriggered = false
        }
    }

    private fun handleNormalUpdate(room: ChatRoom, userId: String, role: RoomRole) {
        val mySeat = room.findUserSeat(userId)?.value
        val currentlySeated = mySeat != null

        if (currentlySeated && !isSeated) {
            Log.d(TAG, "User became seated, hasAudioPermission=${_uiState.value.hasAudioPermission}")
            if (_uiState.value.hasAudioPermission) {
                agoraVoiceService.setRole(true)
            }
        } else if (!currentlySeated && isSeated) {
            Log.d(TAG, "User left seat, switching to audience")
            agoraVoiceService.setRole(false)
        }
        isSeated = currentlySeated

        if (mySeat != null) {
            agoraVoiceService.muteLocalAudio(mySeat.isMuted)
        }

        val pendingInvite = room.pendingInvites[userId]
        if (pendingInvite != null && _uiState.value.pendingInvite == null) {
            enqueueNotification(RoomNotification.InviteReceived(pendingInvite))
        }

        val joinTs = room.firstJoinTimestamps[userId]
        if (joinTs != null && firstJoinTimestamp == null) {
            firstJoinTimestamp = joinTs
            updateFilteredMessages()
        }

        _uiState.update {
            it.copy(
                room = room,
                currentRole = role,
                isLoading = false,
                pendingInvite = pendingInvite
            )
        }

        activeRoomManager.updateTrackedRoom(room)
        loadSeatUsers(room)
        loadParticipantUsers(room)
        handleOwnerAwayCountdown(room)
    }

    private fun checkBlockConflicts(room: ChatRoom) {
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            val myBlockedIds = _uiState.value.blockedUserIds

            // Check if user is banned from this room (kicked previously)
            if (userId in room.bannedUserIds) {
                _uiState.update { it.copy(blockWarning = BlockWarning.BlockedByRoomOwner) }
                return@launch
            }

            // Always check room owner's block list (even if owner is away)
            val ownerUser = userCache[room.ownerId] ?: when (val result = userRepository.getUser(room.ownerId)) {
                is Resource.Success -> {
                    userCache[room.ownerId] = result.data
                    result.data
                }
                else -> null
            }
            if (ownerUser != null && userId in ownerUser.blockedUserIds) {
                _uiState.update { it.copy(blockWarning = BlockWarning.BlockedByRoomOwner) }
                return@launch
            }

            // Check if any participant is blocked by me
            val blockedInRoom = room.participantIds.any { it in myBlockedIds && it != userId }
            if (blockedInRoom) {
                _uiState.update { it.copy(blockWarning = BlockWarning.BlockedUserInRoom) }
                return@launch
            }

            // Check if any other participant (non-owner) has blocked me
            val otherParticipantIds = room.participantIds.filter { it != userId && it != room.ownerId }
            val uncachedIds = otherParticipantIds.filter { it !in userCache }
            if (uncachedIds.isNotEmpty()) {
                coroutineScope {
                    uncachedIds.map { pid ->
                        async {
                            when (val result = userRepository.getUser(pid)) {
                                is Resource.Success -> pid to result.data
                                else -> null
                            }
                        }
                    }.awaitAll().filterNotNull().forEach { (id, user) ->
                        userCache[id] = user
                    }
                }
            }
            for (participantId in otherParticipantIds) {
                val participantUser = userCache[participantId] ?: continue
                if (userId in participantUser.blockedUserIds) {
                    _uiState.update { it.copy(blockWarning = BlockWarning.BlockedByUserInRoom) }
                    return@launch
                }
            }

            // No conflicts, join directly
            joinRoom()
        }
    }

    fun confirmJoinDespiteBlock() {
        _uiState.update { it.copy(blockWarning = null) }
        joinRoom()
    }

    fun cancelJoin() {
        _uiState.update { it.copy(shouldNavigateBack = true) }
    }

    private fun observeMessages() {
        viewModelScope.launch {
            messageRepository.getMessages(roomId)
                .catch { /* ignore message errors */ }
                .collect { messages ->
                    allMessages = messages
                    updateFilteredMessages()
                }
        }
    }

    private fun updateFilteredMessages() {
        val ts = firstJoinTimestamp
        val filtered = if (ts != null) {
            allMessages.filter { it.createdAt >= ts }
        } else {
            allMessages
        }
        if (filtered !== lastFilteredMessages) {
            lastFilteredMessages = filtered
            _uiState.update { it.copy(messages = filtered) }
        }
    }

    private fun observeVoiceState() {
        viewModelScope.launch {
            combine(
                agoraVoiceService.speakingUsers,
                agoraVoiceService.isJoined,
                agoraVoiceService.error
            ) { speaking, joined, errorMsg ->
                Triple(speaking, joined, errorMsg)
            }.distinctUntilChanged()
            .collect { (speaking, joined, errorMsg) ->
                _uiState.update {
                    it.copy(
                        speakingUids = speaking,
                        isVoiceJoined = joined,
                        error = errorMsg ?: it.error
                    )
                }
                if (errorMsg != null) agoraVoiceService.clearError()
            }
        }
    }

    private fun observeDisconnectedUsers() {
        viewModelScope.launch {
            activeRoomManager.disconnectedUserIds.collect { ids ->
                _uiState.update { it.copy(disconnectedUserIds = ids) }
            }
        }
    }

    private fun joinRoom() {
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            val room = _uiState.value.room

            // Already in this room (e.g., returned after pressing back)
            if (room != null && userId in room.participantIds && activeRoomManager.isInRoom(roomId)) {
                _uiState.update { it.copy(hasJoined = true) }
                activeRoomManager.trackRoom(roomId)
                return@launch
            }

            // Ensure user name is loaded before sending join message
            if (_uiState.value.currentUserName.isEmpty()) {
                when (val result = userRepository.getUser(userId)) {
                    is Resource.Success -> {
                        _uiState.update { it.copy(currentUserName = result.data.displayName) }
                    }
                    else -> {}
                }
            }
            val userName = _uiState.value.currentUserName
            roomRepository.leaveAllRooms(userId, exceptRoomId = roomId)
            roomRepository.recordFirstJoinTimestamp(roomId, userId)
            roomRepository.joinRoom(roomId, userId)
            presenceService.setPresence(roomId, userId)
            _uiState.update { it.copy(hasJoined = true) }

            // Start foreground service via ActiveRoomManager
            activeRoomManager.trackRoom(roomId)

            // Join voice channel — as broadcaster if already seated with permission, otherwise audience
            val channel = room?.agoraChannelName
            if (!channel.isNullOrEmpty()) {
                val alreadySeated = room.findUserSeat(userId) != null
                val asBroadcaster = alreadySeated && _uiState.value.hasAudioPermission
                if (alreadySeated) isSeated = true
                agoraVoiceService.joinChannel(channel, userId.toAgoraUid(), asBroadcaster = asBroadcaster)
            }

            if (userName.isNotEmpty()) {
                messageRepository.sendJoinMessage(
                    roomId,
                    userId,
                    userName,
                    "$userName joined the room"
                )
            }
        }
    }

    private fun handleOwnerAwayCountdown(room: ChatRoom) {
        val newState = room.state to room.ownerLeftAt
        if (newState == lastOwnerAwayState) return
        lastOwnerAwayState = newState

        if (room.state == RoomState.OWNER_AWAY && room.ownerLeftAt != null) {
            ownerAwayCountdownJob?.cancel()
            ownerAwayCountdownJob = viewModelScope.launch {
                while (true) {
                    val elapsed = System.currentTimeMillis() - room.ownerLeftAt.toDate().time
                    val remaining = Constants.OWNER_LEAVE_TIMEOUT_MS - elapsed
                    if (remaining <= 0) {
                        // Any remaining participant can close an expired OWNER_AWAY room
                        roomRepository.closeRoom(roomId)
                        break
                    }
                    _uiState.update { it.copy(ownerAwayRemainingMs = remaining) }
                    delay(1000L)
                }
            }
        } else {
            ownerAwayCountdownJob?.cancel()
            _uiState.update { it.copy(ownerAwayRemainingMs = 0L) }
        }
    }

    private fun handleRoomExpiryCountdown(room: ChatRoom) {
        if (room.state == RoomState.CLOSED) {
            roomExpiryCountdownJob?.cancel()
            return
        }
        val elapsed = System.currentTimeMillis() - room.createdAt.toDate().time
        val remaining = Constants.MAX_ROOM_DURATION_MS - elapsed

        if (remaining <= Constants.ROOM_EXPIRY_COUNTDOWN_THRESHOLD_MS) {
            if (roomExpiryCountdownJob?.isActive == true) return
            roomExpiryCountdownJob = viewModelScope.launch {
                while (true) {
                    val now = System.currentTimeMillis() - room.createdAt.toDate().time
                    val left = Constants.MAX_ROOM_DURATION_MS - now
                    if (left <= 0) {
                        if (_uiState.value.currentRole == RoomRole.OWNER) {
                            roomRepository.closeRoom(roomId)
                        }
                        break
                    }
                    _uiState.update { it.copy(roomExpiryRemainingMs = left) }
                    delay(1000L)
                }
            }
        }
    }

    fun takeSeat(seatIndex: Int) {
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            val room = _uiState.value.room ?: return@launch
            val role = _uiState.value.currentRole

            // Owner is locked to seat 0
            if (role == RoomRole.OWNER && seatIndex != Constants.OWNER_SEAT_INDEX) return@launch
            // Non-owners cannot take the owner seat
            if (seatIndex == Constants.OWNER_SEAT_INDEX && role != RoomRole.OWNER) return@launch

            val seat = room.seats[seatIndex.toString()] ?: return@launch
            if (seat.state == SeatState.OCCUPIED) return@launch

            // When seats are locked, attendees cannot request
            if (role == RoomRole.ATTENDEE && room.requireApproval) {
                _uiState.update { it.copy(error = "Seats are locked. You cannot request to sit until the room owner allows it.") }
                return@launch
            }

            // Attendees need approval via seat request
            if (role == RoomRole.ATTENDEE) {
                seatRequestRepository.createRequest(
                    roomId = roomId,
                    userId = userId,
                    userName = _uiState.value.currentUserName,
                    seatIndex = seatIndex
                )
                return@launch
            }

            // Hosts can only self-seat when requireApproval is OFF
            if (role == RoomRole.HOST && room.requireApproval) return@launch

            roomRepository.takeSeat(roomId, seatIndex, userId)
        }
    }

    fun leaveSeat(seatIndex: Int) {
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            val room = _uiState.value.room ?: return@launch

            // Owner cannot leave seat 1
            if (seatIndex == Constants.OWNER_SEAT_INDEX && room.ownerId == userId) return@launch

            roomRepository.leaveSeat(roomId, seatIndex)
        }
    }

    fun removeFromSeat(seatIndex: Int) {
        viewModelScope.launch {
            val room = _uiState.value.room ?: return@launch
            val role = _uiState.value.currentRole
            if (role == RoomRole.ATTENDEE) return@launch

            // Cannot remove from owner seat
            if (seatIndex == Constants.OWNER_SEAT_INDEX) return@launch

            val seat = room.seats[seatIndex.toString()] ?: return@launch
            val targetUserId = seat.userId ?: return@launch

            // Hosts cannot act on owner or other hosts
            val isTargetOwner = targetUserId == room.ownerId
            val isTargetHost = targetUserId in room.hostIds
            if (role == RoomRole.HOST && (isTargetOwner || isTargetHost)) return@launch

            roomRepository.removeFromSeat(roomId, seatIndex)
        }
    }

    fun toggleSelfMute(seatIndex: Int) {
        viewModelScope.launch {
            val room = _uiState.value.room ?: return@launch
            val seat = room.seats[seatIndex.toString()] ?: return@launch
            val userId = _uiState.value.currentUserId
            if (seat.userId != userId) return@launch

            val newMuteState = !seat.isMuted
            roomRepository.toggleMute(roomId, seatIndex, newMuteState)
            agoraVoiceService.muteLocalAudio(newMuteState)
        }
    }

    fun forceMuteUser(seatIndex: Int) {
        viewModelScope.launch {
            val room = _uiState.value.room ?: return@launch
            val role = _uiState.value.currentRole
            if (role == RoomRole.ATTENDEE) return@launch

            val seat = room.seats[seatIndex.toString()] ?: return@launch
            val targetUserId = seat.userId ?: return@launch

            // Cannot force-mute owner; hosts can't force-mute other hosts
            if (targetUserId == room.ownerId) return@launch
            if (role == RoomRole.HOST && targetUserId in room.hostIds) return@launch

            roomRepository.toggleMute(roomId, seatIndex, !seat.isMuted)
        }
    }

    fun moveSeat(fromIndex: Int, toIndex: Int) {
        viewModelScope.launch {
            val room = _uiState.value.room ?: return@launch
            val role = _uiState.value.currentRole
            if (role == RoomRole.ATTENDEE) return@launch

            // Cannot move from/to owner seat
            if (fromIndex == Constants.OWNER_SEAT_INDEX || toIndex == Constants.OWNER_SEAT_INDEX) return@launch

            val fromSeat = room.seats[fromIndex.toString()] ?: return@launch
            val targetUserId = fromSeat.userId ?: return@launch

            // Can only move normal users
            val isTargetOwner = targetUserId == room.ownerId
            val isTargetHost = targetUserId in room.hostIds
            if (role == RoomRole.HOST && (isTargetOwner || isTargetHost)) return@launch

            // Destination must be empty
            val toSeat = room.seats[toIndex.toString()] ?: return@launch
            if (toSeat.state == SeatState.OCCUPIED) return@launch

            roomRepository.moveSeat(roomId, fromIndex, toIndex, targetUserId)
        }
    }

    fun kickUser(seatIndex: Int, reason: String = "") {
        viewModelScope.launch {
            val room = _uiState.value.room ?: return@launch
            val role = _uiState.value.currentRole
            if (role == RoomRole.ATTENDEE) return@launch

            val seat = room.seats[seatIndex.toString()] ?: return@launch
            val targetUserId = seat.userId ?: return@launch

            // Cannot kick owner; hosts can't kick other hosts
            if (targetUserId == room.ownerId) return@launch
            if (role == RoomRole.HOST && targetUserId in room.hostIds) return@launch

            val kickerName = _uiState.value.currentUserName
            val targetUser = userCache[targetUserId]
            val targetName = targetUser?.displayName ?: "A user"
            val displayReason = reason.ifBlank { "No reason given" }

            roomRepository.kickUser(roomId, targetUserId, seatIndex, kickerName, displayReason)
            messageRepository.sendSystemMessage(roomId, "$targetName was kicked")
        }
    }

    fun addHost(userId: String) {
        viewModelScope.launch {
            val room = _uiState.value.room ?: return@launch
            if (_uiState.value.currentUserId != room.ownerId) return@launch
            roomRepository.addHost(roomId, userId)
        }
    }

    fun removeHost(userId: String) {
        viewModelScope.launch {
            val room = _uiState.value.room ?: return@launch
            if (_uiState.value.currentUserId != room.ownerId) return@launch
            roomRepository.removeHost(roomId, userId)
        }
    }

    fun inviteUser(userId: String, userName: String) {
        viewModelScope.launch {
            val room = _uiState.value.room ?: return@launch
            val role = _uiState.value.currentRole

            // Don't invite someone who is already seated
            if (room.findUserSeat(userId) != null) return@launch

            // Owner can always invite; hosts only when requireApproval is OFF
            if (role == RoomRole.ATTENDEE) return@launch
            if (role == RoomRole.HOST && room.requireApproval) return@launch

            roomRepository.sendInvite(roomId, userId, _uiState.value.currentUserId)
        }
    }

    fun inviteFromMessage(senderId: String, senderName: String) {
        inviteUser(senderId, senderName)
    }

    fun acceptInvite() {
        dismissCurrentNotification()
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            val room = _uiState.value.room ?: return@launch
            if (room.pendingInvites[userId] == null) return@launch

            // Find first empty seat (skip owner seat)
            val emptySeatIndex = (1 until Constants.MAX_SEATS).firstOrNull { i ->
                val seat = room.seats[i.toString()]
                seat != null && seat.state != SeatState.OCCUPIED
            } ?: return@launch

            roomRepository.acceptInvite(roomId, userId, emptySeatIndex)
        }
    }

    fun declineInvite() {
        dismissCurrentNotification()
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            roomRepository.cancelInvite(roomId, userId)
        }
    }

    fun sendMessage(text: String) {
        if (text.isBlank()) return
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            val userName = _uiState.value.currentUserName
            messageRepository.sendMessage(roomId, userId, userName, text)
        }
    }

    fun leaveRoom() {
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            val room = _uiState.value.room ?: return@launch
            Log.d(TAG, "leaveRoom (VM): userId=$userId isOwner=${room.ownerId == userId}")

            disconnectFromRoom()

            // Use NonCancellable so Firestore cleanup completes even if ViewModel is destroyed
            withContext(NonCancellable) {
                if (room.ownerId == userId) {
                    // Check if anyone else is still on mic
                    val anyoneOnMic = room.seats.any { (_, seat) ->
                        seat.userId != null && seat.userId != userId && seat.state == SeatState.OCCUPIED
                    }
                    if (anyoneOnMic) {
                        // Owner keeps seat 0 — stays visible during OWNER_AWAY
                        Log.d(TAG, "leaveRoom (VM): owner with others on mic → setOwnerAway")
                        roomRepository.setOwnerAway(roomId)
                    } else {
                        Log.d(TAG, "leaveRoom (VM): owner alone → closeRoom")
                        roomRepository.closeRoom(roomId)
                    }
                } else {
                    // Non-owner: clear their seat
                    val mySeatIndex = room.findUserSeat(userId)?.key?.toInt()
                    if (mySeatIndex != null) {
                        Log.d(TAG, "leaveRoom (VM): clearing seat $mySeatIndex")
                        roomRepository.leaveSeat(roomId, mySeatIndex)
                    }
                }

                // Only non-owners leave the participant list;
                // owner stays in participants during OWNER_AWAY for reconnection
                if (room.ownerId != userId) {
                    roomRepository.leaveRoom(roomId, userId)
                }
            }
        }
    }

    fun ownerReturn() {
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            val room = _uiState.value.room ?: return@launch
            if (room.ownerId != userId) return@launch

            try {
                Log.d(TAG, "ownerReturn: calling setOwnerReturned")
                roomRepository.setOwnerReturned(roomId, userId)

                // Always re-establish presence — the RTDB onDisconnect may have
                // fired while WiFi was off, removing the owner's presence entry.
                // Without this, other phones keep detecting the owner as absent.
                presenceService.setPresence(roomId, userId)

                // Re-establish room tracking if lost during disconnect
                if (!activeRoomManager.isInRoom(roomId)) {
                    activeRoomManager.trackRoom(roomId)
                }

                // Rejoin voice as broadcaster if needed
                val channel = room.agoraChannelName
                if (channel.isNotEmpty()) {
                    if (!agoraVoiceService.isJoined.value) {
                        agoraVoiceService.joinChannel(
                            channel, userId.toAgoraUid(),
                            asBroadcaster = _uiState.value.hasAudioPermission
                        )
                    } else {
                        agoraVoiceService.setRole(true)
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "ownerReturn failed, will retry on next room update", e)
                ownerReturnTriggered = false
            }
        }
    }

    fun updateRoomName(newName: String) {
        viewModelScope.launch {
            val room = _uiState.value.room ?: return@launch
            if (_uiState.value.currentUserId != room.ownerId) return@launch
            roomRepository.updateRoomName(roomId, newName)
        }
    }

    fun closeRoom() {
        viewModelScope.launch {
            val room = _uiState.value.room ?: return@launch
            if (_uiState.value.currentUserId != room.ownerId) return@launch

            disconnectFromRoom()
            roomRepository.closeRoom(roomId)
            _uiState.update { it.copy(roomClosed = true) }
        }
    }

    private fun loadSeatUsers(room: ChatRoom) {
        val seatedUserIds = room.seats.values
            .filter { it.state == SeatState.OCCUPIED && it.userId != null }
            .mapNotNull { it.userId }
            .toSet()

        if (seatedUserIds == lastSeatedUserIds && seatedUserIds.all { it in userCache }) return
        lastSeatedUserIds = seatedUserIds

        loadUsersForIds(seatedUserIds) { cached ->
            _uiState.update { it.copy(seatUsers = cached) }
        }
    }

    private fun loadParticipantUsers(room: ChatRoom) {
        if (room.participantIds == lastParticipantIds && room.participantIds.all { it in userCache }) return
        lastParticipantIds = room.participantIds

        loadUsersForIds(room.participantIds) { cached ->
            _uiState.update { it.copy(participantUsers = cached) }
        }
    }

    private fun loadUsersForIds(userIds: Set<String>, onLoaded: (Map<String, User>) -> Unit) {
        val newUserIds = userIds.filter { it !in userCache }
        if (newUserIds.isEmpty()) {
            onLoaded(userCache.filterKeys { it in userIds })
            return
        }

        viewModelScope.launch {
            when (val result = userRepository.getUsers(newUserIds)) {
                is Resource.Success -> {
                    result.data.forEach { user -> userCache[user.uid] = user }
                }
                else -> {}
            }
            onLoaded(userCache.filterKeys { it in userIds })
        }
    }

    private fun loadBlockedUsers() {
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            when (val result = userRepository.getBlockedUserIds(userId)) {
                is Resource.Success -> {
                    _uiState.update { it.copy(blockedUserIds = result.data) }
                }
                else -> {}
            }
        }
    }

    fun blockUser(targetUserId: String) {
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            when (userRepository.blockUser(userId, targetUserId)) {
                is Resource.Success -> {
                    _uiState.update { it.copy(blockedUserIds = it.blockedUserIds + targetUserId) }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(error = "Failed to block user") }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun unblockUser(targetUserId: String) {
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            when (userRepository.unblockUser(userId, targetUserId)) {
                is Resource.Success -> {
                    _uiState.update { it.copy(blockedUserIds = it.blockedUserIds - targetUserId) }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(error = "Failed to unblock user") }
                }
                is Resource.Loading -> {}
            }
        }
    }

    private fun buildClosedSummary(closedRoom: ChatRoom?): RoomClosedSummary? {
        // Use closed room data if available, fall back to last known snapshot
        val room = closedRoom ?: lastKnownRoom ?: return null

        val createdMs = room.createdAt.toDate().time
        val closedMs = room.closedAt?.toDate()?.time ?: System.currentTimeMillis()
        val durationMs = closedMs - createdMs

        // Host users: owner + anyone in hostIds
        val hostIds = room.hostIds + room.ownerId
        val hostUsers = hostIds.mapNotNull { userCache[it] }

        // Total unique visitors from firstJoinTimestamps, fall back to lastKnownRoom
        val visitors = room.firstJoinTimestamps.size.coerceAtLeast(
            lastKnownRoom?.participantIds?.size ?: 0
        )

        return RoomClosedSummary(
            roomName = room.name,
            durationMs = durationMs,
            hostUsers = hostUsers,
            totalVisitors = visitors
        )
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    // --- Notification Queue ---

    private fun enqueueNotification(notification: RoomNotification) {
        when (notification) {
            is RoomNotification.SeatRequestReceived ->
                if (notification.request.requestId in processedRequestIds) return
            is RoomNotification.RequestApproved ->
                if (notification.request.requestId in processedApprovalIds) return
            is RoomNotification.InviteReceived -> {}
        }
        if (notificationQueue.any { it.id == notification.id }) return
        if (_uiState.value.activeNotification?.id == notification.id) return

        if (_uiState.value.activeNotification == null) {
            showNotification(notification)
        } else {
            notificationQueue.add(notification)
        }
    }

    private fun showNotification(notification: RoomNotification) {
        _uiState.update { it.copy(activeNotification = notification) }
        if (notification is RoomNotification.SeatRequestReceived) {
            autoDismissJob?.cancel()
            autoDismissJob = viewModelScope.launch {
                delay(Constants.SEAT_REQUEST_AUTO_DISMISS_MS)
                dismissCurrentNotification()
            }
        }
    }

    fun dismissCurrentNotification() {
        val current = _uiState.value.activeNotification
        if (current != null) {
            when (current) {
                is RoomNotification.SeatRequestReceived ->
                    processedRequestIds.add(current.request.requestId)
                is RoomNotification.RequestApproved ->
                    processedApprovalIds.add(current.request.requestId)
                is RoomNotification.InviteReceived -> {}
            }
        }
        autoDismissJob?.cancel()
        _uiState.update { it.copy(activeNotification = null) }
        if (notificationQueue.isNotEmpty()) {
            showNotification(notificationQueue.removeFirst())
        }
    }

    // --- Observe Seat Requests ---

    private fun observePendingRequests() {
        viewModelScope.launch {
            seatRequestRepository.getPendingRequests(roomId)
                .catch { /* ignore */ }
                .collect { requests ->
                    val room = _uiState.value.room
                    // Filter out stale requests: user already seated or left the room
                    val validRequests = requests.filter { req ->
                        val alreadySeated = room?.findUserSeat(req.userId) != null
                        val leftRoom = room != null && req.userId !in room.participantIds
                        !alreadySeated && !leftRoom
                    }
                    _uiState.update { it.copy(pendingRequestsForPanel = validRequests) }

                    val role = _uiState.value.currentRole
                    val isHostOrOwner = role == RoomRole.OWNER || role == RoomRole.HOST
                    if (isHostOrOwner && _uiState.value.hasJoined) {
                        for (request in validRequests) {
                            if (request.requestId !in processedRequestIds) {
                                enqueueNotification(RoomNotification.SeatRequestReceived(request))
                            }
                        }
                    }
                }
        }
    }

    private fun observeMyRequest() {
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            seatRequestRepository.getRequestsByUser(roomId, userId)
                .catch { /* ignore */ }
                .collect { requests ->
                    val approvedRequest = requests.firstOrNull {
                        it.status == SeatRequestStatus.APPROVED
                    } ?: return@collect

                    if (approvedRequest.requestId in processedApprovalIds) return@collect

                    val alreadySeated = _uiState.value.room?.findUserSeat(userId) != null
                    if (alreadySeated) return@collect

                    // During the grace period the owner auto-seats the requester,
                    // so suppress the "request accepted" dialog — user is being seated immediately.
                    val requestAge = System.currentTimeMillis() - approvedRequest.createdAt.toDate().time
                    if (requestAge <= Constants.SEAT_REQUEST_IMMEDIATE_THRESHOLD_MS) {
                        processedApprovalIds.add(approvedRequest.requestId)
                        return@collect
                    }

                    enqueueNotification(RoomNotification.RequestApproved(approvedRequest))
                }
        }
    }

    // --- Notification Actions ---

    fun approveRequestFromNotification(request: SeatRequest) {
        viewModelScope.launch {
            val createdAtMs = request.createdAt.toDate().time
            val nowMs = System.currentTimeMillis()
            val delayMs = nowMs - createdAtMs

            when (val result = seatRequestRepository.approveRequest(
                roomId, request.requestId, _uiState.value.currentUserId
            )) {
                is Resource.Success -> {
                    val approved = result.data
                    if (delayMs <= Constants.SEAT_REQUEST_IMMEDIATE_THRESHOLD_MS) {
                        roomRepository.takeSeat(roomId, approved.seatIndex, approved.userId)
                    }
                    dismissCurrentNotification()
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(error = result.message) }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun denyRequestFromNotification(request: SeatRequest) {
        viewModelScope.launch {
            seatRequestRepository.denyRequest(roomId, request.requestId, _uiState.value.currentUserId)
            dismissCurrentNotification()
        }
    }

    fun acceptApprovedRequest(request: SeatRequest) {
        viewModelScope.launch {
            val room = _uiState.value.room ?: return@launch
            val userId = _uiState.value.currentUserId
            val seat = room.seats[request.seatIndex.toString()]
            val seatIndex = if (seat?.state == SeatState.OCCUPIED) {
                // Original seat taken, find next available (skip owner seat)
                (1 until Constants.MAX_SEATS).firstOrNull { i ->
                    val s = room.seats[i.toString()]
                    s != null && s.state != SeatState.OCCUPIED
                }
            } else {
                request.seatIndex
            }
            if (seatIndex != null) {
                roomRepository.takeSeat(roomId, seatIndex, userId)
            } else {
                _uiState.update { it.copy(error = "No seats available") }
            }
            dismissCurrentNotification()
        }
    }

    fun declineApprovedRequest(request: SeatRequest) {
        viewModelScope.launch {
            seatRequestRepository.cancelApprovedRequest(roomId, request.requestId, _uiState.value.currentUserId)
            dismissCurrentNotification()
        }
    }

    fun onAudioPermissionResult(granted: Boolean) {
        Log.d(TAG, "onAudioPermissionResult granted=$granted isSeated=$isSeated")
        _uiState.update { it.copy(hasAudioPermission = granted) }
        if (granted && isSeated) {
            agoraVoiceService.setRole(true)
        }
    }

    fun setRoomScreenVisible(visible: Boolean) {
        activeRoomManager.setRoomScreenVisible(visible)
    }

    override fun onCleared() {
        super.onCleared()
        ownerAwayCountdownJob?.cancel()
        roomExpiryCountdownJob?.cancel()
        userCache.clear()
        // DO NOT call presenceService.removePresence() or agoraVoiceService.leaveChannel()
        // Voice/presence survive ViewModel destruction; explicit leaveRoom() handles cleanup.
    }
}
