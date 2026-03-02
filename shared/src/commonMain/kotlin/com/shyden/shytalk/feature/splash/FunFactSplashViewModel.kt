package com.shyden.shytalk.feature.splash

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.BannerActionType
import com.shyden.shytalk.core.model.FunFact
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.BannerRepository
import com.shyden.shytalk.data.repository.FunFactRepository
import com.shyden.shytalk.data.repository.PrivateMessageRepository
import com.shyden.shytalk.data.repository.RoomRepository
import com.shyden.shytalk.data.repository.UserRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.launch

class FunFactSplashViewModel(
    private val bannerRepository: BannerRepository,
    private val funFactRepository: FunFactRepository,
    private val imagePreloader: BannerImagePreloader? = null,
    private val webContentPreloader: WebContentPreloader? = null,
    private val authRepository: AuthRepository,
    private val userRepository: UserRepository,
    private val roomRepository: RoomRepository,
    private val pmRepository: PrivateMessageRepository,
) : ViewModel() {

    private val _warmUpComplete = MutableStateFlow(false)
    val warmUpComplete: StateFlow<Boolean> = _warmUpComplete.asStateFlow()

    private val _funFacts = MutableStateFlow<List<FunFact>>(emptyList())
    val funFacts: StateFlow<List<FunFact>> = _funFacts.asStateFlow()

    init {
        // Show cached facts immediately while syncing fresh ones
        _funFacts.value = funFactRepository.getCachedFacts().shuffled()

        viewModelScope.launch {
            val jobs = listOf(
                launch {
                    try {
                        val banners = bannerRepository.getActiveBanners()
                        banners.forEach { banner ->
                            launch {
                                try {
                                    imagePreloader?.preload(banner.imageUrl)
                                } catch (_: Exception) { }
                            }
                            if (banner.actionType == BannerActionType.URL && !banner.actionValue.isNullOrBlank()) {
                                launch {
                                    try {
                                        webContentPreloader?.preload(banner.actionValue!!)
                                    } catch (_: Exception) { }
                                }
                            }
                        }
                    } catch (_: Exception) { }
                },
                launch {
                    try {
                        val fresh = funFactRepository.syncFacts()
                        if (fresh.isNotEmpty()) {
                            _funFacts.value = fresh.shuffled()
                        }
                    } catch (_: Exception) {
                        // Keep cached facts if sync fails
                    }
                },
                launch {
                    val userId = authRepository.currentUserId ?: return@launch
                    listOf(
                        launch { userRepository.getUser(userId) },
                        launch { userRepository.getBlockedUserIds(userId) },
                        launch { roomRepository.prefetchActiveRooms() },
                        launch { pmRepository.prefetchConversations() },
                    ).joinAll()
                },
            )
            jobs.joinAll()
            _warmUpComplete.value = true
        }
    }
}
