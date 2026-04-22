package com.shyden.shytalk.core.di

import com.shyden.shytalk.core.di.stubs.IosAppConfigServiceStub
import com.shyden.shytalk.core.di.stubs.IosAppLockRepositoryStub
import com.shyden.shytalk.core.di.stubs.IosAuthRepositoryStub
import com.shyden.shytalk.core.di.stubs.IosBannerImagePreloaderStub
import com.shyden.shytalk.core.di.stubs.IosBannerRepositoryStub
import com.shyden.shytalk.core.di.stubs.IosBiometricRepositoryStub
import com.shyden.shytalk.core.di.stubs.IosConversationWebSocketServiceStub
import com.shyden.shytalk.core.di.stubs.IosDeviceRepositoryStub
import com.shyden.shytalk.core.di.stubs.IosEconomyRepositoryStub
import com.shyden.shytalk.core.di.stubs.IosFunFactRepositoryStub
import com.shyden.shytalk.core.di.stubs.IosGiftRepositoryStub
import com.shyden.shytalk.core.di.stubs.IosIdentityRepositoryStub
import com.shyden.shytalk.core.di.stubs.IosMessageRepositoryStub
import com.shyden.shytalk.core.di.stubs.IosNotificationRepositoryStub
import com.shyden.shytalk.core.di.stubs.IosOtpRepositoryStub
import com.shyden.shytalk.core.di.stubs.IosPinRepositoryStub
import com.shyden.shytalk.core.di.stubs.IosPresenceServiceStub
import com.shyden.shytalk.core.di.stubs.IosPrivateMessageRepositoryStub
import com.shyden.shytalk.core.di.stubs.IosReportRepositoryStub
import com.shyden.shytalk.core.di.stubs.IosRoomLifecycleManagerStub
import com.shyden.shytalk.core.di.stubs.IosRoomRepositoryStub
import com.shyden.shytalk.core.di.stubs.IosSeatRequestRepositoryStub
import com.shyden.shytalk.core.di.stubs.IosStorageRepositoryStub
import com.shyden.shytalk.core.di.stubs.IosTokenServiceStub
import com.shyden.shytalk.core.di.stubs.IosTranslationRepositoryStub
import com.shyden.shytalk.core.di.stubs.IosTypingRepositoryStub
import com.shyden.shytalk.core.di.stubs.IosUserRepositoryStub
import com.shyden.shytalk.core.di.stubs.IosVoiceServiceStub
import com.shyden.shytalk.core.di.stubs.IosWebContentPreloaderStub
import com.shyden.shytalk.core.room.RoomLifecycleManager
import com.shyden.shytalk.data.local.StickerStorage
import com.shyden.shytalk.data.remote.AppConfigService
import com.shyden.shytalk.data.remote.ConversationWebSocketService
import com.shyden.shytalk.data.remote.PresenceService
import com.shyden.shytalk.data.remote.TokenService
import com.shyden.shytalk.data.remote.VoiceService
import com.shyden.shytalk.data.repository.AppLockRepository
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.BannerRepository
import com.shyden.shytalk.data.repository.BiometricRepository
import com.shyden.shytalk.data.repository.DeviceRepository
import com.shyden.shytalk.data.repository.EconomyRepository
import com.shyden.shytalk.data.repository.FunFactRepository
import com.shyden.shytalk.data.repository.GiftRepository
import com.shyden.shytalk.data.repository.IdentityRepository
import com.shyden.shytalk.data.repository.MessageRepository
import com.shyden.shytalk.data.repository.NotificationRepository
import com.shyden.shytalk.data.repository.OtpRepository
import com.shyden.shytalk.data.repository.PinRepository
import com.shyden.shytalk.data.repository.PrivateMessageRepository
import com.shyden.shytalk.data.repository.ReportRepository
import com.shyden.shytalk.data.repository.RoomRepository
import com.shyden.shytalk.data.repository.SeatRequestRepository
import com.shyden.shytalk.data.repository.StorageRepository
import com.shyden.shytalk.data.repository.TranslationRepository
import com.shyden.shytalk.data.repository.TypingRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.feature.splash.BannerImagePreloader
import com.shyden.shytalk.feature.splash.WebContentPreloader
import org.koin.core.qualifier.named
import org.koin.dsl.module

val iosPlatformModule =
    module {
        // Named qualifiers required by AuthViewModel
        single(named("deviceId")) { "ios-device" }
        single(named("bypassDeviceChecks")) { true }

        // StickerStorage (actual class already exists in iosMain)
        single { StickerStorage() }

        // Repositories
        single<AuthRepository> { IosAuthRepositoryStub() }
        single<UserRepository> { IosUserRepositoryStub() }
        single<RoomRepository> { IosRoomRepositoryStub() }
        single<MessageRepository> { IosMessageRepositoryStub() }
        single<SeatRequestRepository> { IosSeatRequestRepositoryStub() }
        single<StorageRepository> { IosStorageRepositoryStub() }
        single<DeviceRepository> { IosDeviceRepositoryStub() }
        single<IdentityRepository> { IosIdentityRepositoryStub() }
        single<PrivateMessageRepository> { IosPrivateMessageRepositoryStub() }
        single<ReportRepository> { IosReportRepositoryStub() }
        single<TypingRepository> { IosTypingRepositoryStub() }
        single<NotificationRepository> { IosNotificationRepositoryStub() }
        single<GiftRepository> { IosGiftRepositoryStub() }
        single<EconomyRepository> { IosEconomyRepositoryStub() }
        single<BannerRepository> { IosBannerRepositoryStub() }
        single<FunFactRepository> { IosFunFactRepositoryStub() }
        single<TranslationRepository> { IosTranslationRepositoryStub() }
        single<OtpRepository> { IosOtpRepositoryStub() }
        single<PinRepository> { IosPinRepositoryStub() }
        single<BiometricRepository> { IosBiometricRepositoryStub() }
        single<AppLockRepository> { IosAppLockRepositoryStub() }

        // Services
        single<TokenService> { IosTokenServiceStub() }
        single<VoiceService> { IosVoiceServiceStub() }
        single<PresenceService> { IosPresenceServiceStub() }
        single<ConversationWebSocketService> { IosConversationWebSocketServiceStub() }
        single<AppConfigService> { IosAppConfigServiceStub() }

        // Managers
        single<RoomLifecycleManager> { IosRoomLifecycleManagerStub() }

        // Preloaders
        single<BannerImagePreloader> { IosBannerImagePreloaderStub() }
        single<WebContentPreloader> { IosWebContentPreloaderStub() }
    }
