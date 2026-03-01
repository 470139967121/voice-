package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.Banner

interface BannerRepository {
    suspend fun getActiveBanners(): List<Banner>
}
