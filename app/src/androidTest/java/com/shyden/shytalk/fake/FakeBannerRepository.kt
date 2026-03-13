package com.shyden.shytalk.fake

import com.shyden.shytalk.core.model.Banner
import com.shyden.shytalk.data.repository.BannerRepository

class FakeBannerRepository : BannerRepository {
    override suspend fun getActiveBanners(): List<Banner> = emptyList()
}
