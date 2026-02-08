package com.example.shytalk.feature.room

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.shytalk.core.model.ChatRoom
import com.example.shytalk.core.model.Message
import com.example.shytalk.core.model.RoomRole
import com.example.shytalk.core.model.RoomState
import com.example.shytalk.core.model.SeatState
import com.example.shytalk.core.model.User
import com.example.shytalk.core.util.Constants
import com.example.shytalk.core.util.Resource
import com.example.shytalk.data.remote.AgoraVoiceService
import com.example.shytalk.data.repository.AuthRepository
import com.example.shytalk.data.repository.MessageRepository
import com.example.shytalk.data.repository.RoomRepository
import com.example.shytalk.data.repository.SeatRequestRepository
import com.example.shytalk.data.repository.UserRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.launch
import javax.inject.Inject

data class RoomUiState(
    val room: ChatRoom? = null,
    val messages: List<Message> = emptyList(),
    val currentUserId: String = "",
    val currentUserName: String = "",
    val currentRole: RoomRole = RoomRole.ATTENDEE,
    val isLoading: Boolean = true,
    val error: String? = null,
    val roomClosed: Boolean = false,
    val ownerAwayRemainingMs: Long = 0L,
    val speakingUids: Set<Int> = emptySet(),
    val isVoiceJoined: Boolean = false,
    val pendingInvite: String? = null,
    val seatUsers: Map<String, User> = emptyMap(),
    val blockedUserIds: Set<String> = emptySet()
)

@HiltViewModel
class RoomViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val roomRepository: RoomRepository,
    private val messageRepository: MessageRepository,
    private val authRepository: AuthRepository,
    private val userRepository: UserRepository,
    private val seatRequestRepository: SeatRequestRepository,
    private val agoraVoiceService: AgoraVoiceService
) : ViewModel() {

    private val roomId: String = savedStateHandle["roomId"] ?: ""

    private val _uiState = MutableStateFlow(RoomUiState())
    val uiState: StateFlow<RoomUiState> = _uiState.asStateFlow()

    private var ownerAwayCountdownJob: Job? = null
    private var isSeated = false
    private val userCache = mutableMapOf<String, User>()

    init {
        val userId = authRepository.currentUser?.uid ?: ""
        _uiState.value = _uiState.value.copy(currentUserId = userId)
        loadUserName()
        loadBlockedUsers()
        observeRoom()
        observeMessages()
        observeVoiceState()
        joinRoom()
    }

    private fun loadUserName() {
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            when (val result = userRepository.getUser(userId)) {
                is Resource.Success -> {
                    _uiState.value = _uiState.value.copy(
                        currentUserName = result.data.displayName
                    )
                }
                else -> {}
            }
        }
    }

    private fun observeRoom() {
        viewModelScope.launch {
            roomRepository.getRoomFlow(roomId)
                .catch { e ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = e.message
                    )
                }
                .collect { room ->
                    if (room == null || room.state == RoomState.CLOSED) {
                        agoraVoiceService.leaveChannel()
                        _uiState.value = _uiState.value.copy(
                            isLoading = false,
                            roomClosed = true
                        )
                        return@collect
                    }

                    val userId = _uiState.value.currentUserId

                    // Detect if user was kicked (banned or no longer a participant)
                    if (userId !in room.participantIds || userId in room.bannedUserIds) {
                        agoraVoiceService.leaveChannel()
                        _uiState.value = _uiState.value.copy(
                            isLoading = false,
                            roomClosed = true
                        )
                        return@collect
                    }

                    val role = resolveRole(room, userId)

                    // Check if user is currently seated
                    val currentlySeated = room.seats.values.any {
                        it.userId == userId && it.state == SeatState.OCCUPIED
                    }

                    // Join/leave Agora channel based on seat status
                    if (currentlySeated && !isSeated) {
                        joinVoiceChannel(room.agoraChannelName)
                    } else if (!currentlySeated && isSeated) {
                        agoraVoiceService.leaveChannel()
                    }
                    isSeated = currentlySeated

                    // Sync mute state with Agora
                    if (currentlySeated) {
                        val mySeat = room.seats.values.find { it.userId == userId }
                        mySeat?.let { agoraVoiceService.muteLocalAudio(it.isMuted) }
                    }

                    val pendingInvite = room.pendingInvites[userId]

                    _uiState.value = _uiState.value.copy(
                        room = room,
                        currentRole = role,
                        isLoading = false,
                        pendingInvite = pendingInvite
                    )

                    loadSeatUsers(room)
                    handleOwnerAwayCountdown(room)
                }
        }
    }

    private fun observeMessages() {
        viewModelScope.launch {
            messageRepository.getMessages(roomId)
                .catch { /* ignore message errors */ }
                .collect { messages ->
                    _uiState.value = _uiState.value.copy(messages = messages)
                }
        }
    }

    private fun observeVoiceState() {
        viewModelScope.launch {
            agoraVoiceService.speakingUsers.collect { speaking ->
                _uiState.value = _uiState.value.copy(speakingUids = speaking)
            }
        }
        viewModelScope.launch {
            agoraVoiceService.isJoined.collect { joined ->
                _uiState.value = _uiState.value.copy(isVoiceJoined = joined)
            }
        }
    }

    private fun joinRoom() {
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            roomRepository.joinRoom(roomId, userId)
            messageRepository.sendSystemMessage(
                roomId,
                "${_uiState.value.currentUserName.ifEmpty { "Someone" }} joined the room"
            )
        }
    }

    private fun joinVoiceChannel(channelName: String) {
        viewModelScope.launch {
            val uid = _uiState.value.currentUserId.hashCode() and 0x7FFFFFFF
            agoraVoiceService.joinChannel(channelName, uid)
        }
    }

    private fun resolveRole(room: ChatRoom, userId: String): RoomRole {
        return when {
            room.ownerId == userId -> RoomRole.OWNER
            userId in room.hostIds -> RoomRole.HOST
            else -> RoomRole.ATTENDEE
        }
    }

    private fun handleOwnerAwayCountdown(room: ChatRoom) {
        if (room.state == RoomState.OWNER_AWAY && room.ownerLeftAt != null) {
            ownerAwayCountdownJob?.cancel()
            ownerAwayCountdownJob = viewModelScope.launch {
                while (true) {
                    val elapsed = System.currentTimeMillis() - room.ownerLeftAt.toDate().time
                    val remaining = Constants.OWNER_LEAVE_TIMEOUT_MS - elapsed
                    if (remaining <= 0) {
                        if (_uiState.value.currentRole == RoomRole.OWNER) {
                            roomRepository.closeRoom(roomId)
                        }
                        break
                    }
                    _uiState.value = _uiState.value.copy(ownerAwayRemainingMs = remaining)
                    delay(1000L)
                }
            }
        } else {
            ownerAwayCountdownJob?.cancel()
            _uiState.value = _uiState.value.copy(ownerAwayRemainingMs = 0L)
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

            // Attendees ALWAYS need approval
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

            // Can only force-mute normal users (attendees)
            val isTargetOwner = targetUserId == room.ownerId
            val isTargetHost = targetUserId in room.hostIds
            if (isTargetOwner || isTargetHost) return@launch

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

    fun kickUser(seatIndex: Int) {
        viewModelScope.launch {
            val room = _uiState.value.room ?: return@launch
            val role = _uiState.value.currentRole
            if (role == RoomRole.ATTENDEE) return@launch

            val seat = room.seats[seatIndex.toString()] ?: return@launch
            val targetUserId = seat.userId ?: return@launch

            // Cannot kick owner or hosts (hosts can't kick hosts either)
            val isTargetOwner = targetUserId == room.ownerId
            val isTargetHost = targetUserId in room.hostIds
            if (isTargetOwner || isTargetHost) return@launch

            roomRepository.kickUser(roomId, targetUserId, seatIndex)
            messageRepository.sendSystemMessage(roomId, "A user was kicked from the room")
        }
    }

    fun inviteUser(userId: String, userName: String) {
        viewModelScope.launch {
            val room = _uiState.value.room ?: return@launch
            val role = _uiState.value.currentRole

            // Owner can always invite; hosts only when requireApproval is OFF
            if (role == RoomRole.ATTENDEE) return@launch
            if (role == RoomRole.HOST && room.requireApproval) return@launch

            roomRepository.sendInvite(roomId, userId, _uiState.value.currentUserId)
            messageRepository.sendSystemMessage(
                roomId,
                "${userName.ifEmpty { "Someone" }} was invited to sit"
            )
        }
    }

    fun acceptInvite() {
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

            room.seats.forEach { (index, seat) ->
                if (seat.userId == userId) {
                    if (index.toInt() == Constants.OWNER_SEAT_INDEX && room.ownerId == userId) {
                        roomRepository.leaveSeat(roomId, index.toInt())
                        roomRepository.setOwnerAway(roomId)
                    } else {
                        roomRepository.leaveSeat(roomId, index.toInt())
                    }
                }
            }

            agoraVoiceService.leaveChannel()
            roomRepository.leaveRoom(roomId, userId)
            messageRepository.sendSystemMessage(
                roomId,
                "${_uiState.value.currentUserName.ifEmpty { "Someone" }} left the room"
            )
        }
    }

    fun ownerReturn() {
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            val room = _uiState.value.room ?: return@launch
            if (room.ownerId != userId) return@launch

            roomRepository.setOwnerReturned(roomId, userId)
        }
    }

    fun closeRoom() {
        viewModelScope.launch {
            val room = _uiState.value.room ?: return@launch
            if (_uiState.value.currentUserId != room.ownerId) return@launch

            agoraVoiceService.leaveChannel()
            roomRepository.closeRoom(roomId)
            messageRepository.sendSystemMessage(roomId, "Room has been closed")
            _uiState.value = _uiState.value.copy(roomClosed = true)
        }
    }

    private fun loadSeatUsers(room: ChatRoom) {
        val seatedUserIds = room.seats.values
            .filter { it.state == SeatState.OCCUPIED && it.userId != null }
            .mapNotNull { it.userId }
            .distinct()

        val newUserIds = seatedUserIds.filter { it !in userCache }
        if (newUserIds.isEmpty()) {
            _uiState.value = _uiState.value.copy(
                seatUsers = userCache.filterKeys { it in seatedUserIds }
            )
            return
        }

        viewModelScope.launch {
            for (uid in newUserIds) {
                when (val result = userRepository.getUser(uid)) {
                    is Resource.Success -> userCache[uid] = result.data
                    else -> {}
                }
            }
            _uiState.value = _uiState.value.copy(
                seatUsers = userCache.filterKeys { it in seatedUserIds }
            )
        }
    }

    private fun loadBlockedUsers() {
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            when (val result = userRepository.getBlockedUserIds(userId)) {
                is Resource.Success -> {
                    _uiState.value = _uiState.value.copy(
                        blockedUserIds = result.data.toSet()
                    )
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
                    _uiState.value = _uiState.value.copy(
                        blockedUserIds = _uiState.value.blockedUserIds + targetUserId
                    )
                }
                is Resource.Error -> {
                    _uiState.value = _uiState.value.copy(error = "Failed to block user")
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
                    _uiState.value = _uiState.value.copy(
                        blockedUserIds = _uiState.value.blockedUserIds - targetUserId
                    )
                }
                is Resource.Error -> {
                    _uiState.value = _uiState.value.copy(error = "Failed to unblock user")
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }

    override fun onCleared() {
        super.onCleared()
        ownerAwayCountdownJob?.cancel()
        agoraVoiceService.leaveChannel()
    }
}
