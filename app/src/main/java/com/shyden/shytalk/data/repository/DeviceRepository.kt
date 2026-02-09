package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource

interface DeviceRepository {
    suspend fun getDeviceBinding(deviceId: String): Resource<String?>
    suspend fun bindDevice(deviceId: String, userId: String): Resource<Unit>
}
