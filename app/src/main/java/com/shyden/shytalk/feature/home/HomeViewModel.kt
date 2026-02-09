package com.shyden.shytalk.feature.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.model.SeatState
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.RoomRepository
import com.shyden.shytalk.data.repository.UserRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.launch
import javax.inject.Inject

data class HomeUiState(
    val rooms: List<ChatRoom> = emptyList(),
    val seatUsers: Map<String, User> = emptyMap(),
    val isLoading: Boolean = true,
    val error: String? = null,
    val createdRoomId: String? = null
)

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val roomRepository: RoomRepository,
    private val authRepository: AuthRepository,
    private val userRepository: UserRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(HomeUiState())
    val uiState: StateFlow<HomeUiState> = _uiState.asStateFlow()

    private val userCache = mutableMapOf<String, User>()

    val currentUserId: String?
        get() = authRepository.currentUser?.uid

    init {
        observeRooms()
    }

    private fun observeRooms() {
        viewModelScope.launch {
            roomRepository.getActiveRooms()
                .catch { e ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = e.message
                    )
                }
                .collect { rooms ->
                    _uiState.value = _uiState.value.copy(
                        rooms = rooms,
                        isLoading = false
                    )
                    loadSeatUsers(rooms)
                }
        }
    }

    private fun loadSeatUsers(rooms: List<ChatRoom>) {
        val seatedUserIds = rooms.flatMap { room ->
            room.seats.values
                .filter { it.state == SeatState.OCCUPIED && it.userId != null }
                .mapNotNull { it.userId }
        }.distinct()

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

    fun createRoom(name: String) {
        val userId = authRepository.currentUser?.uid ?: return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            when (val result = roomRepository.createRoom(name, userId)) {
                is Resource.Success -> {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        createdRoomId = result.data
                    )
                }
                is Resource.Error -> {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = result.message
                    )
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun onRoomNavigated() {
        _uiState.value = _uiState.value.copy(createdRoomId = null)
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }

    fun signOut() {
        authRepository.signOut()
    }
}
