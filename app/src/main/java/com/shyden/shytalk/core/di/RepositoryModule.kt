package com.shyden.shytalk.core.di

import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.AuthRepositoryImpl
import com.shyden.shytalk.data.repository.DeviceRepository
import com.shyden.shytalk.data.repository.DeviceRepositoryImpl
import com.shyden.shytalk.data.repository.MessageRepository
import com.shyden.shytalk.data.repository.MessageRepositoryImpl
import com.shyden.shytalk.data.repository.RoomRepository
import com.shyden.shytalk.data.repository.RoomRepositoryImpl
import com.shyden.shytalk.data.repository.SeatRequestRepository
import com.shyden.shytalk.data.repository.SeatRequestRepositoryImpl
import com.shyden.shytalk.data.repository.StorageRepository
import com.shyden.shytalk.data.repository.StorageRepositoryImpl
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.data.repository.UserRepositoryImpl
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class RepositoryModule {

    @Binds
    @Singleton
    abstract fun bindAuthRepository(impl: AuthRepositoryImpl): AuthRepository

    @Binds
    @Singleton
    abstract fun bindUserRepository(impl: UserRepositoryImpl): UserRepository

    @Binds
    @Singleton
    abstract fun bindRoomRepository(impl: RoomRepositoryImpl): RoomRepository

    @Binds
    @Singleton
    abstract fun bindMessageRepository(impl: MessageRepositoryImpl): MessageRepository

    @Binds
    @Singleton
    abstract fun bindSeatRequestRepository(impl: SeatRequestRepositoryImpl): SeatRequestRepository

    @Binds
    @Singleton
    abstract fun bindStorageRepository(impl: StorageRepositoryImpl): StorageRepository

    @Binds
    @Singleton
    abstract fun bindDeviceRepository(impl: DeviceRepositoryImpl): DeviceRepository
}
