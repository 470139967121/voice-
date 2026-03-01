package com.shyden.shytalk.feature.splash

interface WebContentPreloader {
    suspend fun preload(url: String)
}
