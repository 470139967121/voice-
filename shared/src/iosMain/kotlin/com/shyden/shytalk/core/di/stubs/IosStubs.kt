@file:Suppress("TooManyFunctions")

package com.shyden.shytalk.core.di.stubs

import com.shyden.shytalk.core.model.BackpackItem
import com.shyden.shytalk.core.model.Banner
import com.shyden.shytalk.core.model.Broadcast
import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.model.CoinPackage
import com.shyden.shytalk.core.model.Conversation
import com.shyden.shytalk.core.model.ConversationSettings
import com.shyden.shytalk.core.model.DailyRewardResult
import com.shyden.shytalk.core.model.EconomyConfig
import com.shyden.shytalk.core.model.FunFact
import com.shyden.shytalk.core.model.GachaResult
import com.shyden.shytalk.core.model.Gift
import com.shyden.shytalk.core.model.GiftRankEntry
import com.shyden.shytalk.core.model.GiftSender
import com.shyden.shytalk.core.model.GiftWallEntry
import com.shyden.shytalk.core.model.GroupPermissions
import com.shyden.shytalk.core.model.Message
import com.shyden.shytalk.core.model.MessageEdit
import com.shyden.shytalk.core.model.MuteInfo
import com.shyden.shytalk.core.model.PrivateMessage
import com.shyden.shytalk.core.model.ProfileVisitor
import com.shyden.shytalk.core.model.SeatRequest
import com.shyden.shytalk.core.model.SystemMessageConfig
import com.shyden.shytalk.core.model.Transaction
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.room.RoomLifecycleManager
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.remote.AppConfigService
import com.shyden.shytalk.data.remote.BackendHealthStatus
import com.shyden.shytalk.data.remote.ConversationEvent
import com.shyden.shytalk.data.remote.ConversationWebSocketService
import com.shyden.shytalk.data.remote.PresenceService
import com.shyden.shytalk.data.remote.RoomEvent
import com.shyden.shytalk.data.remote.StartingScreen
import com.shyden.shytalk.data.remote.TokenResponse
import com.shyden.shytalk.data.remote.TokenService
import com.shyden.shytalk.data.remote.VoiceConnectionState
import com.shyden.shytalk.data.remote.VoiceService
import com.shyden.shytalk.data.repository.AppLockRepository
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.BanStatus
import com.shyden.shytalk.data.repository.BannerRepository
import com.shyden.shytalk.data.repository.BiometricRepository
import com.shyden.shytalk.data.repository.CreateUserResult
import com.shyden.shytalk.data.repository.DeviceRepository
import com.shyden.shytalk.data.repository.EconomyRepository
import com.shyden.shytalk.data.repository.FunFactRepository
import com.shyden.shytalk.data.repository.GiftRepository
import com.shyden.shytalk.data.repository.IdentityRepository
import com.shyden.shytalk.data.repository.MessageRepository
import com.shyden.shytalk.data.repository.NotificationRepository
import com.shyden.shytalk.data.repository.OtpRepository
import com.shyden.shytalk.data.repository.PinRepository
import com.shyden.shytalk.data.repository.PinVerifyResult
import com.shyden.shytalk.data.repository.PrivateMessageRepository
import com.shyden.shytalk.data.repository.ReportRepository
import com.shyden.shytalk.data.repository.RoomRepository
import com.shyden.shytalk.data.repository.SeatRequestRepository
import com.shyden.shytalk.data.repository.SignInResult
import com.shyden.shytalk.data.repository.StorageRepository
import com.shyden.shytalk.data.repository.TranslationQuota
import com.shyden.shytalk.data.repository.TranslationRepository
import com.shyden.shytalk.data.repository.TranslationResult
import com.shyden.shytalk.data.repository.TypingRepository
import com.shyden.shytalk.data.repository.UserFlags
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.feature.messaging.Report
import com.shyden.shytalk.feature.splash.BannerImagePreloader
import com.shyden.shytalk.feature.splash.WebContentPreloader
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.emptyFlow

// ── AuthRepository ──────────────────────────────────────────────────────────────

class IosAuthRepositoryStub : AuthRepository {
    override val currentUserId: String? = null
    override val isAuthenticated: Boolean = false
    override val currentUserEmail: String? = null
    override val currentFirebaseUid: String? = null
    override var resolvedUniqueId: String? = null

    override fun getProviderInfo(): Pair<String, String>? = TODO("iOS: Phase 3")

    override suspend fun signInWithGoogleIdToken(idToken: String): Resource<String> = TODO("iOS: Phase 3")

    override suspend fun signInWithAppleIdToken(
        idToken: String,
        rawNonce: String,
    ): Resource<String> = TODO("iOS: Phase 3")

    override suspend fun signInWithAppleViaProvider(activity: Any): Resource<String> = TODO("iOS: Phase 3")

    override suspend fun sendSignInLink(email: String): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun signInWithEmailLink(
        email: String,
        link: String,
    ): Resource<String> = TODO("iOS: Phase 3")

    override suspend fun signInWithCustomToken(token: String): Resource<String> = TODO("iOS: Phase 3")

    override fun signOut() = TODO("iOS: Phase 3")
}

// ── UserRepository ──────────────────────────────────────────────────────────────

class IosUserRepositoryStub : UserRepository {
    override val userUpdates: SharedFlow<User> get() = MutableSharedFlow()

    override suspend fun createOrUpdateUser(user: User): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun getUser(userId: String): Resource<User> = TODO("iOS: Phase 3")

    override suspend fun userExists(userId: String): Resource<Boolean> = TODO("iOS: Phase 3")

    override suspend fun updateDisplayName(
        userId: String,
        displayName: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun updateAvatar(
        userId: String,
        avatarUrl: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun updateLastSeen(userId: String): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun updateProfile(
        userId: String,
        fields: Map<String, Any?>,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun generateUniqueId(userId: String): Resource<Long> = TODO("iOS: Phase 3")

    override suspend fun blockUser(
        userId: String,
        blockedUserId: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun unblockUser(
        userId: String,
        blockedUserId: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun getBlockedUserIds(userId: String): Resource<Set<String>> = TODO("iOS: Phase 3")

    override suspend fun checkBlockedBy(
        userIds: List<String>,
        targetUserId: String,
    ): Resource<Set<String>> = TODO("iOS: Phase 3")

    override suspend fun followUser(
        currentUserId: String,
        targetUserId: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun unfollowUser(
        currentUserId: String,
        targetUserId: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun getUsers(userIds: List<String>): Resource<List<User>> = TODO("iOS: Phase 3")

    override suspend fun removeFollower(
        userId: String,
        followerId: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun recordProfileVisit(
        profileUserId: String,
        visitorId: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun getStalkers(profileUserId: String): Resource<List<ProfileVisitor>> = TODO("iOS: Phase 3")

    override suspend fun markStalkersViewed(userId: String): Resource<Unit> = TODO("iOS: Phase 3")

    override fun observeUsers(userIds: Set<String>): Flow<User> = emptyFlow()

    override suspend fun submitSuspensionAppeal(
        userId: String,
        appealText: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun liftExpiredSuspension(userId: String): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun getAliases(userId: String): Resource<Map<String, String>> = TODO("iOS: Phase 3")

    override suspend fun setAlias(
        userId: String,
        targetUserId: String,
        alias: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun removeAlias(
        userId: String,
        targetUserId: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override fun observeUserFlags(userId: String): Flow<UserFlags> = emptyFlow()

    override suspend fun acknowledgeWarning(userId: String): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun getWarningReason(userId: String): Resource<String?> = TODO("iOS: Phase 3")

    override suspend fun requestAccountDeletion(
        userId: String,
        pin: String,
    ): Resource<Long> = TODO("iOS: Phase 3")

    override suspend fun cancelAccountDeletion(userId: String): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun getAccountDeletionStatus(userId: String): Resource<UserRepository.DeletionStatus> = TODO("iOS: Phase 3")

    override suspend fun requestDataExport(userId: String): Resource<Long> = TODO("iOS: Phase 3")

    override suspend fun getDataExportStatus(userId: String): Resource<UserRepository.DataExportStatus> = TODO("iOS: Phase 3")
}

// ── RoomRepository ──────────────────────────────────────────────────────────────

class IosRoomRepositoryStub : RoomRepository {
    override fun getActiveRooms(): Flow<List<ChatRoom>> = emptyFlow()

    override fun getRoomFlow(roomId: String): Flow<ChatRoom?> = emptyFlow()

    override suspend fun getRoom(roomId: String): Resource<ChatRoom> = TODO("iOS: Phase 3")

    override suspend fun createRoom(
        name: String,
        ownerId: String,
    ): Resource<String> = TODO("iOS: Phase 3")

    override suspend fun joinRoom(
        roomId: String,
        userId: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun leaveRoom(
        roomId: String,
        userId: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun takeSeat(
        roomId: String,
        seatIndex: Int,
        userId: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun leaveSeat(
        roomId: String,
        seatIndex: Int,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun removeFromSeat(
        roomId: String,
        seatIndex: Int,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun moveSeat(
        roomId: String,
        fromIndex: Int,
        toIndex: Int,
        userId: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun kickUser(
        roomId: String,
        userId: String,
        seatIndex: Int?,
        kickerName: String,
        reason: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun toggleMute(
        roomId: String,
        seatIndex: Int,
        isMuted: Boolean,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun addHost(
        roomId: String,
        userId: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun removeHost(
        roomId: String,
        userId: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun updateRoomName(
        roomId: String,
        newName: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun setRequireApproval(
        roomId: String,
        requireApproval: Boolean,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun setOwnerAway(roomId: String): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun setOwnerReturned(
        roomId: String,
        ownerId: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun sendInvite(
        roomId: String,
        userId: String,
        invitedBy: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun cancelInvite(
        roomId: String,
        userId: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun acceptInvite(
        roomId: String,
        userId: String,
        seatIndex: Int,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun closeRoom(roomId: String): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun findActiveRoomByOwner(ownerId: String): String? = TODO("iOS: Phase 3")

    override suspend fun recordFirstJoinTimestamp(
        roomId: String,
        userId: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun leaveAllRooms(
        userId: String,
        exceptRoomId: String?,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun closeAllRoomsByOwner(ownerId: String): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun removeDisconnectedUser(
        roomId: String,
        userId: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")
}

// ── MessageRepository ───────────────────────────────────────────────────────────

class IosMessageRepositoryStub : MessageRepository {
    override fun getMessages(roomId: String): Flow<List<Message>> = emptyFlow()

    override suspend fun sendMessage(
        roomId: String,
        senderId: String,
        senderName: String,
        text: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun sendSystemMessage(
        roomId: String,
        text: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun sendJoinMessage(
        roomId: String,
        senderId: String,
        senderName: String,
        text: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun editMessage(
        roomId: String,
        messageId: String,
        newText: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")
}

// ── SeatRequestRepository ───────────────────────────────────────────────────────

class IosSeatRequestRepositoryStub : SeatRequestRepository {
    override fun getPendingRequests(roomId: String): Flow<List<SeatRequest>> = emptyFlow()

    override fun getRequestsByUser(
        roomId: String,
        userId: String,
    ): Flow<List<SeatRequest>> = emptyFlow()

    override suspend fun createRequest(
        roomId: String,
        userId: String,
        userName: String,
        seatIndex: Int,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun approveRequest(
        roomId: String,
        requestId: String,
        resolvedBy: String,
    ): Resource<SeatRequest> = TODO("iOS: Phase 3")

    override suspend fun denyRequest(
        roomId: String,
        requestId: String,
        resolvedBy: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun cancelApprovedRequest(
        roomId: String,
        requestId: String,
        userId: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")
}

// ── StorageRepository ───────────────────────────────────────────────────────────

class IosStorageRepositoryStub : StorageRepository {
    override suspend fun uploadImage(
        userId: String,
        path: String,
        imageData: ByteArray,
        contentType: String,
    ): Resource<String> = TODO("iOS: Phase 3")

    override suspend fun deleteImageByUrl(url: String) = TODO("iOS: Phase 3")
}

// ── DeviceRepository ────────────────────────────────────────────────────────────

class IosDeviceRepositoryStub : DeviceRepository {
    override suspend fun getDeviceBinding(deviceId: String): Resource<String?> = TODO("iOS: Phase 3")

    override suspend fun bindDevice(
        deviceId: String,
        userId: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun checkBanStatus(deviceId: String): Resource<BanStatus> = TODO("iOS: Phase 3")
}

// ── IdentityRepository ──────────────────────────────────────────────────────────

class IosIdentityRepositoryStub : IdentityRepository {
    override suspend fun resolveIdentity(
        provider: String,
        identifier: String,
    ): Resource<SignInResult> = TODO("iOS: Phase 3")

    override suspend fun createUser(
        provider: String,
        identifier: String,
        displayName: String?,
        email: String?,
        profilePhotoUrl: String?,
        dateOfBirth: Long?,
        language: String,
    ): Resource<CreateUserResult> = TODO("iOS: Phase 3")

    override suspend fun linkProvider(
        uniqueId: Long,
        provider: String,
        identifier: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun unlinkProvider(
        uniqueId: Long,
        provider: String,
        identifier: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun forceRefreshToken(): Resource<Unit> = TODO("iOS: Phase 3")
}

// ── PrivateMessageRepository ────────────────────────────────────────────────────

class IosPrivateMessageRepositoryStub : PrivateMessageRepository {
    override fun getConversations(userId: String): Flow<List<Conversation>> = emptyFlow()

    override suspend fun getOrCreateConversation(
        uid1: String,
        uid2: String,
    ): Resource<Conversation> = TODO("iOS: Phase 3")

    override suspend fun getConversationSettings(
        conversationId: String,
        userId: String,
    ): Resource<ConversationSettings> = TODO("iOS: Phase 3")

    override fun observeConversationSettings(
        conversationId: String,
        userId: String,
    ): Flow<ConversationSettings> = emptyFlow()

    override fun getMessages(
        conversationId: String,
        limit: Int,
    ): Flow<List<PrivateMessage>> = emptyFlow()

    override suspend fun loadOlderMessages(
        conversationId: String,
        beforeTimestamp: Long,
        limit: Int,
    ): Resource<List<PrivateMessage>> = TODO("iOS: Phase 3")

    override suspend fun sendTextMessage(
        conversationId: String,
        senderId: String,
        senderName: String,
        text: String,
        replyToMessageId: String?,
        replyToText: String?,
        replyToSenderName: String?,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun sendImageMessage(
        conversationId: String,
        senderId: String,
        senderName: String,
        imageUrls: List<String>,
        replyToMessageId: String?,
        replyToText: String?,
        replyToSenderName: String?,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun editMessage(
        conversationId: String,
        messageId: String,
        newText: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun getEditHistory(
        conversationId: String,
        messageId: String,
    ): Resource<List<MessageEdit>> = TODO("iOS: Phase 3")

    override suspend fun markAsRead(
        conversationId: String,
        userId: String,
        messageId: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun resetUnreadCount(
        conversationId: String,
        userId: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun muteConversation(
        conversationId: String,
        userId: String,
        muted: Boolean,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun pinConversation(
        conversationId: String,
        userId: String,
        pinned: Boolean,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun hideConversation(
        conversationId: String,
        userId: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun toggleReaction(
        conversationId: String,
        messageId: String,
        emoji: String,
        userId: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun searchMessages(
        conversationId: String,
        query: String,
    ): Resource<List<PrivateMessage>> = TODO("iOS: Phase 3")

    override suspend fun createGroupConversation(
        creatorId: String,
        participantIds: List<String>,
        groupName: String,
        groupDescription: String?,
        groupPhotoUrl: String?,
        adminIds: List<String>,
        modIds: List<String>,
        permissions: GroupPermissions,
        systemMessageConfig: SystemMessageConfig,
    ): Resource<Conversation> = TODO("iOS: Phase 3")

    override suspend fun addGroupParticipant(
        conversationId: String,
        userId: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun removeGroupParticipant(
        conversationId: String,
        userId: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun updateGroupName(
        conversationId: String,
        newName: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun sendStickerMessage(
        conversationId: String,
        senderId: String,
        senderName: String,
        stickerUrl: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun sendRoomInviteMessage(
        conversationId: String,
        senderId: String,
        senderName: String,
        roomId: String,
        roomName: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun getModerationConfig(): Resource<List<String>> = TODO("iOS: Phase 3")

    override suspend fun getConversation(conversationId: String): Resource<Conversation> = TODO("iOS: Phase 3")

    override suspend fun closeGroupConversation(conversationId: String): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun recallMessage(
        conversationId: String,
        messageId: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun muteGroupMember(
        conversationId: String,
        userId: String,
        duration: Long?,
        reason: String?,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun unmuteGroupMember(
        conversationId: String,
        userId: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun getGroupMutes(conversationId: String): Resource<List<MuteInfo>> = TODO("iOS: Phase 3")

    override suspend fun hideMessage(
        conversationId: String,
        messageId: String,
        hiddenBy: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun updateGroupRoles(
        conversationId: String,
        adminIds: List<String>,
        modIds: List<String>,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun transferOwnership(
        conversationId: String,
        newOwnerId: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun updateGroupPermissions(
        conversationId: String,
        permissions: GroupPermissions,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun updateSystemMessageConfig(
        conversationId: String,
        config: SystemMessageConfig,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun updateModNotifyMode(
        conversationId: String,
        mode: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun updateGroupDescription(
        conversationId: String,
        description: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun updateGroupPhoto(
        conversationId: String,
        photoUrl: String?,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun searchUsers(
        query: String,
        currentUserId: String,
    ): Resource<List<User>> = TODO("iOS: Phase 3")

    override suspend fun getOwnedGroupCount(userId: String): Resource<Int> = TODO("iOS: Phase 3")
}

// ── ReportRepository ────────────────────────────────────────────────────────────

@Suppress("kotlin:S107")
class IosReportRepositoryStub : ReportRepository {
    override suspend fun reportMessage(
        reporterId: String,
        reporterName: String,
        reporterUniqueId: Long,
        reportedUserId: String,
        reportedUserName: String,
        reportedUserUniqueId: Long,
        conversationId: String,
        messageId: String,
        messageText: String,
        reason: String,
        description: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun reportUser(
        reporterId: String,
        reporterName: String,
        reporterUniqueId: Long,
        reportedUserId: String,
        reportedUserName: String,
        reportedUserUniqueId: Long,
        conversationId: String,
        reason: String,
        description: String,
        evidenceUrls: List<String>,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun getPendingReports(): Resource<List<Report>> = TODO("iOS: Phase 3")

    override suspend fun resolveReport(
        reportId: String,
        action: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")
}

// ── TypingRepository ────────────────────────────────────────────────────────────

class IosTypingRepositoryStub : TypingRepository {
    override fun setTyping(
        conversationId: String,
        userId: String,
        isTyping: Boolean,
    ) = TODO("iOS: Phase 3")

    override fun observeTyping(
        conversationId: String,
        otherUserId: String,
    ): Flow<Boolean> = emptyFlow()
}

// ── NotificationRepository ──────────────────────────────────────────────────────

class IosNotificationRepositoryStub : NotificationRepository {
    override suspend fun saveFcmToken(
        userId: String,
        token: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun removeFcmToken(
        userId: String,
        token: String,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun setPmNotificationsEnabled(
        userId: String,
        enabled: Boolean,
    ): Resource<Unit> = TODO("iOS: Phase 3")

    override suspend fun getPmNotificationsEnabled(userId: String): Resource<Boolean> = TODO("iOS: Phase 3")
}

// ── GiftRepository ──────────────────────────────────────────────────────────────

class IosGiftRepositoryStub : GiftRepository {
    override fun observeGiftCatalog(): Flow<List<Gift>> = emptyFlow()

    override fun observeAllGifts(): Flow<List<Gift>> = emptyFlow()

    override fun observeBackpack(userId: String): Flow<List<BackpackItem>> = emptyFlow()

    override fun observeGiftWall(userId: String): Flow<List<GiftWallEntry>> = emptyFlow()

    override fun observeBroadcasts(): Flow<List<Broadcast>> = emptyFlow()

    override suspend fun getGiftWallSenders(
        userId: String,
        giftId: String,
    ): List<GiftSender> = TODO("iOS: Phase 3")

    override suspend fun getGiftRanking(giftId: String): List<GiftRankEntry> = TODO("iOS: Phase 3")
}

// ── EconomyRepository ───────────────────────────────────────────────────────────

class IosEconomyRepositoryStub : EconomyRepository {
    override fun observeBalance(): Flow<Long> = emptyFlow()

    override fun observeEconomyConfig(): Flow<EconomyConfig> = emptyFlow()

    override suspend fun claimDailyReward(): Resource<DailyRewardResult> = TODO("iOS: Phase 3")

    override suspend fun pullGacha(
        pullCount: Int,
        expectedCost: Int,
    ): Resource<GachaResult> = TODO("iOS: Phase 3")

    override suspend fun sendGift(
        recipientId: String,
        giftId: String,
        quantity: Int,
    ): Resource<Map<String, Any?>> = TODO("iOS: Phase 3")

    override suspend fun sendGiftDirect(
        recipientId: String,
        giftId: String,
        quantity: Int,
    ): Resource<Map<String, Any?>> = TODO("iOS: Phase 3")

    override suspend fun sendGiftBatch(
        recipientIds: List<String>,
        giftId: String,
        quantity: Int,
        fromBackpack: Boolean,
    ): Resource<Map<String, Any?>> = TODO("iOS: Phase 3")

    override suspend fun sendEntireBackpack(recipientId: String): Resource<Map<String, Any?>> = TODO("iOS: Phase 3")

    override suspend fun redeemBeans(amount: Long): Resource<Map<String, Any?>> = TODO("iOS: Phase 3")

    override suspend fun purchaseCoins(
        productId: String,
        purchaseToken: String,
    ): Resource<Map<String, Any?>> = TODO("iOS: Phase 3")

    override suspend fun purchaseSubscription(
        productId: String,
        purchaseToken: String,
    ): Resource<Map<String, Any?>> = TODO("iOS: Phase 3")

    override suspend fun getCoinPackages(): Resource<List<CoinPackage>> = TODO("iOS: Phase 3")

    override suspend fun getRecentTransactions(limit: Int): Resource<List<Transaction>> = TODO("iOS: Phase 3")

    override suspend fun getAllTransactions(filterType: String?): Resource<List<Transaction>> = TODO("iOS: Phase 3")

    override suspend fun addTestCoins(amount: Int): Resource<Map<String, Any?>> = TODO("iOS: Phase 3")

    override suspend fun claimSuperShyTrial(): Resource<Map<String, Any?>> = TODO("iOS: Phase 3")

    override suspend fun activateSuperShyTrial(): Resource<Map<String, Any?>> = TODO("iOS: Phase 3")
}

// ── BannerRepository ────────────────────────────────────────────────────────────

class IosBannerRepositoryStub : BannerRepository {
    override suspend fun getActiveBanners(): List<Banner> = TODO("iOS: Phase 3")
}

// ── FunFactRepository ───────────────────────────────────────────────────────────

class IosFunFactRepositoryStub : FunFactRepository {
    override suspend fun syncFacts(): List<FunFact> = TODO("iOS: Phase 3")

    override fun getCachedFacts(): List<FunFact> = emptyList()
}

// ── TranslationRepository ───────────────────────────────────────────────────────

class IosTranslationRepositoryStub : TranslationRepository {
    override suspend fun translate(
        text: String,
        targetLang: String,
        messagePath: String?,
    ): Resource<TranslationResult> = TODO("iOS: Phase 3")

    override suspend fun getQuota(): Resource<TranslationQuota> = TODO("iOS: Phase 3")
}

// ── OtpRepository ───────────────────────────────────────────────────────────────

class IosOtpRepositoryStub : OtpRepository {
    override suspend fun sendOtp(email: String): Result<Unit> = TODO("iOS: Phase 3")

    override suspend fun verifyOtp(
        email: String,
        code: String,
    ): Result<String> = TODO("iOS: Phase 3")
}

// ── PinRepository ───────────────────────────────────────────────────────────────

class IosPinRepositoryStub : PinRepository {
    override suspend fun setupPin(pin: String): Result<String> = TODO("iOS: Phase 3")

    override suspend fun verifyPin(
        uniqueId: String,
        deviceId: String,
        pin: String,
    ): Result<PinVerifyResult> = TODO("iOS: Phase 3")

    override suspend fun resetPin(newPin: String): Result<Unit> = TODO("iOS: Phase 3")
}

// ── BiometricRepository ─────────────────────────────────────────────────────────

class IosBiometricRepositoryStub : BiometricRepository {
    override suspend fun register(
        publicKeyBase64: String,
        deviceId: String,
    ): Result<Unit> = TODO("iOS: Phase 3")

    override suspend fun getChallenge(
        uniqueId: String,
        deviceId: String,
    ): Result<String> = TODO("iOS: Phase 3")

    override suspend fun verify(
        uniqueId: String,
        deviceId: String,
        signatureBase64: String,
    ): Result<String> = TODO("iOS: Phase 3")

    override suspend fun revoke(deviceId: String): Result<Unit> = TODO("iOS: Phase 3")
}

// ── AppLockRepository ───────────────────────────────────────────────────────────

class IosAppLockRepositoryStub : AppLockRepository {
    override val hasCredential: Boolean = false
    override val isAppLockEnabled: Boolean = false
    override val isBiometricEnabled: Boolean = false
    override val lockTimeoutMinutes: Int = 0
    override val storedUniqueId: String? = null
    override val storedDeviceId: String? = null
    override val localPinHash: String? = null
    override val credentialVersion: Int = 0

    override fun setCredential(
        uniqueId: String,
        deviceId: String,
        localPinHash: String,
    ) = TODO("iOS: Phase 3")

    override fun setAppLockEnabled(enabled: Boolean) = TODO("iOS: Phase 3")

    override fun setBiometricEnabled(enabled: Boolean) = TODO("iOS: Phase 3")

    override fun setLockTimeoutMinutes(minutes: Int) = TODO("iOS: Phase 3")

    override fun updateLastActiveTimestamp() = TODO("iOS: Phase 3")

    override fun isLockRequired(): Boolean = false

    override fun clearCredential() = TODO("iOS: Phase 3")
}

// ── TokenService ────────────────────────────────────────────────────────────────

class IosTokenServiceStub : TokenService {
    override suspend fun fetchToken(roomName: String): TokenResponse = TODO("iOS: Phase 3")
}

// ── VoiceService ────────────────────────────────────────────────────────────────

class IosVoiceServiceStub : VoiceService {
    override val speakingUsers: StateFlow<Set<String>> get() = MutableStateFlow(emptySet<String>()).asStateFlow()
    override val isJoined: StateFlow<Boolean> get() = MutableStateFlow(false).asStateFlow()
    override val connectionState: StateFlow<VoiceConnectionState> get() = MutableStateFlow(VoiceConnectionState.DISCONNECTED).asStateFlow()
    override val error: StateFlow<String?> get() = MutableStateFlow<String?>(null).asStateFlow()

    override suspend fun joinRoom(
        roomName: String,
        userId: String,
    ) = TODO("iOS: Phase 3")

    override fun leaveChannel() = TODO("iOS: Phase 3")

    override fun setMicrophoneEnabled(enabled: Boolean) = TODO("iOS: Phase 3")

    override fun setAudioMode(voiceMode: Boolean) = TODO("iOS: Phase 3")

    override fun clearError() = TODO("iOS: Phase 3")

    override fun prewarmToken(
        roomName: String,
        userId: String,
    ) = TODO("iOS: Phase 3")
}

// ── PresenceService ─────────────────────────────────────────────────────────────

class IosPresenceServiceStub : PresenceService {
    override fun setPresence(
        roomId: String,
        userId: String,
    ) = TODO("iOS: Phase 3")

    override fun removePresence() = TODO("iOS: Phase 3")

    override fun observeRoomPresence(roomId: String): Flow<Set<String>> = emptyFlow()

    override suspend fun isUserPresent(
        roomId: String,
        userId: String,
    ): Boolean = TODO("iOS: Phase 3")

    override val roomEvents: Flow<RoomEvent> get() = emptyFlow()
}

// ── ConversationWebSocketService ────────────────────────────────────────────────

class IosConversationWebSocketServiceStub : ConversationWebSocketService {
    override fun connect(
        conversationId: String,
        userId: String,
    ) = TODO("iOS: Phase 3")

    override fun disconnect() = TODO("iOS: Phase 3")

    override fun sendTyping(isTyping: Boolean) = TODO("iOS: Phase 3")

    override val events: Flow<ConversationEvent> get() = emptyFlow()
}

// ── AppConfigService ────────────────────────────────────────────────────────────

class IosAppConfigServiceStub : AppConfigService {
    override val currentVersionCode: Int = 0

    override suspend fun getLatestVersionInfo(): Resource<Triple<Int, Int, String>> = TODO("iOS: Phase 3")

    override suspend fun checkBackendHealth(): Resource<BackendHealthStatus> = TODO("iOS: Phase 3")

    override suspend fun getStartingScreens(): Resource<Map<String, StartingScreen>> = TODO("iOS: Phase 3")

    override fun getCacheSizeBytes(): Long = 0L

    override fun clearAppCache() = TODO("iOS: Phase 3")
}

// ── RoomLifecycleManager ────────────────────────────────────────────────────────

class IosRoomLifecycleManagerStub : RoomLifecycleManager {
    override val activeRoomId: StateFlow<String?> get() = MutableStateFlow<String?>(null).asStateFlow()
    override val activeRoom: StateFlow<ChatRoom?> get() = MutableStateFlow<ChatRoom?>(null).asStateFlow()
    override val activeMessages: StateFlow<List<Message>> get() = MutableStateFlow(emptyList<Message>()).asStateFlow()
    override val currentUserId: String = ""
    override var isAppInForeground: Boolean = false
    override val disconnectedUserIds: StateFlow<Set<String>> get() = MutableStateFlow(emptySet<String>()).asStateFlow()
    override val sharedUserCache: Map<String, User> = emptyMap()

    override fun isInRoom(roomId: String): Boolean = false

    override fun trackRoom(roomId: String) = TODO("iOS: Phase 3")

    override fun updateTrackedRoom(room: ChatRoom) = TODO("iOS: Phase 3")

    override fun updateSharedUserCache(users: Map<String, User>) = TODO("iOS: Phase 3")

    override fun untrackRoom() = TODO("iOS: Phase 3")

    override fun setRoomScreenVisible(visible: Boolean) = TODO("iOS: Phase 3")

    override fun markLeaveStarted(roomId: String) = TODO("iOS: Phase 3")

    override fun markLeaveCompleted(roomId: String) = TODO("iOS: Phase 3")

    override suspend fun awaitLeaveCompletion(roomId: String) = TODO("iOS: Phase 3")
}

// ── BannerImagePreloader ────────────────────────────────────────────────────────

class IosBannerImagePreloaderStub : BannerImagePreloader {
    override suspend fun preload(url: String) = TODO("iOS: Phase 3")
}

// ── WebContentPreloader ─────────────────────────────────────────────────────────

class IosWebContentPreloaderStub : WebContentPreloader {
    override suspend fun preload(url: String) = TODO("iOS: Phase 3")
}
