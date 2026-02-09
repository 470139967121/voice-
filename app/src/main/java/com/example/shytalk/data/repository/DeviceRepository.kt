package com.example.shytalk.data.repository

import com.example.shytalk.core.util.Resource

interface DeviceRepository {
    suspend fun getDeviceBinding(deviceId: String): Resource<String?>
    suspend fun bindDevice(deviceId: String, userId: String): Resource<Unit>
}
