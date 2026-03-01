package com.shyden.shytalk.feature.splash

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.data.repository.BannerRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.launch

class FunFactSplashViewModel(
    private val bannerRepository: BannerRepository,
    private val imagePreloader: BannerImagePreloader? = null,
) : ViewModel() {

    private val _warmUpComplete = MutableStateFlow(false)
    val warmUpComplete: StateFlow<Boolean> = _warmUpComplete.asStateFlow()

    init {
        viewModelScope.launch {
            val jobs = listOf(
                launch {
                    try {
                        val banners = bannerRepository.getActiveBanners()
                        // Preload banner images into Coil disk cache
                        banners.forEach { banner ->
                            launch {
                                try {
                                    imagePreloader?.preload(banner.imageUrl)
                                } catch (_: Exception) { }
                            }
                        }
                    } catch (_: Exception) { }
                },
            )
            jobs.joinAll()
            _warmUpComplete.value = true
        }
    }
}
