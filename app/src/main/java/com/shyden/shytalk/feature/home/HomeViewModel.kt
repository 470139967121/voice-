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
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
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
    private var myBlockedUserIds: Set<String> = emptySet()
    private var allRooms: List<ChatRoom> = emptyList()

    val currentUserId: String?
        get() = authRepository.currentUser?.uid

    init {
        loadBlockedUsersAndFilter()
        observeRooms()
    }

    private fun loadBlockedUsersAndFilter() {
        val userId = currentUserId ?: return
        viewModelScope.launch {
            when (val result = userRepository.getBlockedUserIds(userId)) {
                is Resource.Success -> {
                    myBlockedUserIds = result.data.toSet()
                    filterAndEmitRooms()
                }
                else -> {}
            }
        }
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
                    allRooms = rooms
                    filterAndEmitRooms()
                }
        }
    }

    private fun filterAndEmitRooms() {
        viewModelScope.launch {
            val userId = currentUserId ?: return@launch

            // Collect all user IDs we need: owners + seated users
            val ownerIds = allRooms.map { it.ownerId }.toSet()
            val seatedUserIds = allRooms.flatMap { room ->
                room.seats.values
                    .filter { it.state == SeatState.OCCUPIED && it.userId != null }
                    .mapNotNull { it.userId }
            }.toSet()
            val allNeededIds = ownerIds + seatedUserIds

            // Single batch load for all uncached users
            val newUserIds = allNeededIds.filter { it !in userCache }
            if (newUserIds.isNotEmpty()) {
                coroutineScope {
                    newUserIds.map { uid ->
                        async {
                            when (val result = userRepository.getUser(uid)) {
                                is Resource.Success -> uid to result.data
                                else -> null
                            }
                        }
                    }.awaitAll().filterNotNull().forEach { (id, user) ->
                        userCache[id] = user
                    }
                }
            }

            val filtered = allRooms.filter { room ->
                if (room.ownerId in myBlockedUserIds) return@filter false
                val ownerUser = userCache[room.ownerId]
                if (ownerUser != null && userId in ownerUser.blockedUserIds) return@filter false
                true
            }

            // Recompute seated users from filtered rooms only
            val filteredSeatedUserIds = filtered.flatMap { room ->
                room.seats.values
                    .filter { it.state == SeatState.OCCUPIED && it.userId != null }
                    .mapNotNull { it.userId }
            }.toSet()

            _uiState.value = _uiState.value.copy(
                rooms = filtered,
                isLoading = false,
                seatUsers = userCache.filterKeys { it in filteredSeatedUserIds }
            )
        }
    }

    fun createRoom(name: String) {
        val userId = authRepository.currentUser?.uid ?: return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            // Close any existing rooms owned by this user
            roomRepository.closeAllRoomsByOwner(userId)
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
