package com.shyden.shytalk.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.model.SeatRequest
import com.shyden.shytalk.core.util.Constants.SEAT_REQUEST_IMMEDIATE_THRESHOLD_MS
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.MessageRepository
import com.shyden.shytalk.data.repository.RoomRepository
import com.shyden.shytalk.data.repository.SeatRequestRepository
import com.shyden.shytalk.data.repository.UserRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import javax.inject.Inject

data class RoomSettingsUiState(
    val room: ChatRoom? = null,
    val pendingRequests: List<SeatRequest> = emptyList(),
    val userNames: Map<String, String> = emptyMap(),
    val isLoading: Boolean = false,
    val error: String? = null
)

@HiltViewModel
class RoomSettingsViewModel @Inject constructor(
    private val roomRepository: RoomRepository,
    private val seatRequestRepository: SeatRequestRepository,
    private val messageRepository: MessageRepository,
    private val authRepository: AuthRepository,
    private val userRepository: UserRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(RoomSettingsUiState())
    val uiState: StateFlow<RoomSettingsUiState> = _uiState.asStateFlow()

    private var currentRoomId: String = ""

    val currentUserId: String
        get() = authRepository.currentUser?.uid ?: ""

    fun loadRoom(roomId: String) {
        currentRoomId = roomId
        viewModelScope.launch {
            combine(
                roomRepository.getRoomFlow(roomId),
                seatRequestRepository.getPendingRequests(roomId)
            ) { room, requests ->
                room to requests
            }
                .catch { e ->
                    _uiState.value = _uiState.value.copy(error = e.message)
                }
                .collect { (room, requests) ->
                    _uiState.value = _uiState.value.copy(
                        room = room,
                        pendingRequests = requests
                    )
                    if (room != null) {
                        resolveUserNames(room)
                    }
                }
        }
    }

    private val resolvedIds = mutableSetOf<String>()

    private suspend fun resolveUserNames(room: ChatRoom) {
        val allIds = room.participantIds + room.hostIds + room.ownerId
        val newIds = allIds.filter { it !in resolvedIds }
        if (newIds.isEmpty()) return

        val names = _uiState.value.userNames.toMutableMap()
        for (id in newIds) {
            when (val result = userRepository.getUser(id)) {
                is Resource.Success -> {
                    names[id] = result.data.displayName.ifEmpty { id.take(8) }
                    resolvedIds.add(id)
                }
                else -> {}
            }
        }
        _uiState.value = _uiState.value.copy(userNames = names)
    }

    fun toggleRequireApproval() {
        val room = _uiState.value.room ?: return
        if (currentUserId != room.ownerId) return
        viewModelScope.launch {
            roomRepository.setRequireApproval(currentRoomId, !room.requireApproval)
        }
    }

    fun addHost(userId: String) {
        val room = _uiState.value.room ?: return
        if (currentUserId != room.ownerId) return
        viewModelScope.launch {
            roomRepository.addHost(currentRoomId, userId)
            messageRepository.sendSystemMessage(currentRoomId, "A new host was added")
        }
    }

    fun removeHost(userId: String) {
        val room = _uiState.value.room ?: return
        if (currentUserId != room.ownerId) return
        viewModelScope.launch {
            roomRepository.removeHost(currentRoomId, userId)
            messageRepository.sendSystemMessage(currentRoomId, "A host was removed")
        }
    }

    fun inviteUser(userId: String, userName: String) {
        val room = _uiState.value.room ?: return
        // Owner can always invite; hosts only when requireApproval is OFF
        if (currentUserId != room.ownerId && (currentUserId !in room.hostIds || room.requireApproval)) return
        viewModelScope.launch {
            roomRepository.sendInvite(currentRoomId, userId, currentUserId)
            messageRepository.sendSystemMessage(
                currentRoomId,
                "${userName.ifEmpty { "Someone" }} was invited to sit"
            )
        }
    }

    fun approveRequest(request: SeatRequest) {
        val room = _uiState.value.room ?: return
        // When requireApproval is ON, only owner can approve
        if (room.requireApproval && currentUserId != room.ownerId) return
        // When OFF, owner + hosts can approve (attendees never see this)
        if (currentUserId != room.ownerId && currentUserId !in room.hostIds) return
        viewModelScope.launch {
            val createdAtMs = request.createdAt.toDate().time
            val nowMs = System.currentTimeMillis()
            val delayMs = nowMs - createdAtMs

            when (val result = seatRequestRepository.approveRequest(
                currentRoomId, request.requestId, currentUserId
            )) {
                is Resource.Success -> {
                    val approved = result.data
                    if (delayMs <= SEAT_REQUEST_IMMEDIATE_THRESHOLD_MS) {
                        roomRepository.takeSeat(currentRoomId, approved.seatIndex, approved.userId)
                        messageRepository.sendSystemMessage(
                            currentRoomId,
                            "${approved.userName} was seated at seat ${approved.seatIndex + 1}"
                        )
                    } else {
                        messageRepository.sendSystemMessage(
                            currentRoomId,
                            "${approved.userName}'s seat request was approved"
                        )
                    }
                }
                is Resource.Error -> {
                    _uiState.value = _uiState.value.copy(error = result.message)
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun denyRequest(request: SeatRequest) {
        viewModelScope.launch {
            seatRequestRepository.denyRequest(currentRoomId, request.requestId, currentUserId)
        }
    }

    fun closeRoom() {
        val room = _uiState.value.room ?: return
        if (currentUserId != room.ownerId) return
        viewModelScope.launch {
            messageRepository.sendSystemMessage(currentRoomId, "Room has been closed by the owner")
            roomRepository.closeRoom(currentRoomId)
        }
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }
}
