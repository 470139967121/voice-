package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.Banner
import com.shyden.shytalk.core.util.toMap
import com.shyden.shytalk.data.remote.WorkerApiClient

class BannerRepositoryImpl(
    private val api: WorkerApiClient
) : BannerRepository {

    override suspend fun getActiveBanners(): List<Banner> {
        val arr = api.getArray("/api/banners/active")
        return (0 until arr.length()).mapNotNull { i ->
            val obj = arr.getJSONObject(i)
            Banner.fromMap(obj.toMap(), obj.getString("id"))
        }
    }
}
