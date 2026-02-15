package com.shyden.shytalk.data.remote

import com.shyden.shytalk.core.util.Resource

interface AppConfigService {
    val currentVersionCode: Int
    suspend fun getLatestVersionInfo(): Resource<Pair<Int, String>>
    fun clearAppCache()
}
