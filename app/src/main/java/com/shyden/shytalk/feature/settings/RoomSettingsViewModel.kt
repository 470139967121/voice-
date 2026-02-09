package com.shyden.shytalk.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.model.SeatRequest
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.MessageRepository
import com.shyden.shytalk.data.repository.RoomRepository
import com.shyden.shytalk.data.repository.SeatRequestRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.launch
import javax.inject.Inject

data class RoomSettingsUiState(
    val room: ChatRoom? = null,
    val pendingRequests: List<SeatRequest> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null
)

@HiltViewModel
class RoomSettingsViewModel @Inject constructor(
    private val roomRepository: RoomRepository,
    private val seatRequestRepository: SeatRequestRepository,
    private val messageRepository: MessageRepository,
    private val authRepository: AuthRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(RoomSettingsUiState())
    val uiState: StateFlow<RoomSettingsUiState> = _uiState.asStateFlow()

    private var currentRoomId: String = ""

    val currentUserId: String
        get() = authRepository.currentUser?.uid ?: ""

    fun loadRoom(roomId: String) {
        currentRoomId = roomId
        viewModelScope.launch {
            roomRepository.getRoomFlow(roomId)
                .catch { e ->
                    _uiState.value = _uiState.value.copy(error = e.message)
                }
                .collect { room ->
                    _uiState.value = _uiState.value.copy(room = room)
                }
        }
        viewModelScope.launch {
            seatRequestRepository.getPendingRequests(roomId)
                .catch { /* ignore */ }
                .collect { requests ->
                    _uiState.value = _uiState.value.copy(pendingRequests = requests)
                }
        }
    }

    fun toggleRequireApproval() {
        val room = _uiState.value.room ?: return
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
            when (val result = seatRequestRepository.approveRequest(
                currentRoomId, request.requestId, currentUserId
            )) {
                is Resource.Success -> {
                    val approved = result.data
                    roomRepository.takeSeat(currentRoomId, approved.seatIndex, approved.userId)
                    messageRepository.sendSystemMessage(
                        currentRoomId,
                        "${approved.userName} was seated at seat ${approved.seatIndex + 1}"
                    )
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
