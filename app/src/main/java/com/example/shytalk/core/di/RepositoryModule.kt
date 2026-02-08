package com.example.shytalk.core.di

import com.example.shytalk.data.repository.AuthRepository
import com.example.shytalk.data.repository.AuthRepositoryImpl
import com.example.shytalk.data.repository.MessageRepository
import com.example.shytalk.data.repository.MessageRepositoryImpl
import com.example.shytalk.data.repository.RoomRepository
import com.example.shytalk.data.repository.RoomRepositoryImpl
import com.example.shytalk.data.repository.SeatRequestRepository
import com.example.shytalk.data.repository.SeatRequestRepositoryImpl
import com.example.shytalk.data.repository.StorageRepository
import com.example.shytalk.data.repository.StorageRepositoryImpl
import com.example.shytalk.data.repository.UserRepository
import com.example.shytalk.data.repository.UserRepositoryImpl
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
}
