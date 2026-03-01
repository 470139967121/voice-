package com.shyden.shytalk.feature.splash

interface BannerImagePreloader {
    suspend fun preload(url: String)
}
