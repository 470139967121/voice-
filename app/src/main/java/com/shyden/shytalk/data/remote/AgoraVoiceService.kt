package com.shyden.shytalk.data.remote

import android.content.Context
import android.os.SystemClock
import android.util.Log
import dagger.hilt.android.qualifiers.ApplicationContext
import io.agora.rtc2.ChannelMediaOptions
import io.agora.rtc2.Constants
import io.agora.rtc2.IRtcEngineEventHandler
import io.agora.rtc2.RtcEngine
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import com.shyden.shytalk.core.util.Constants as AppConstants
import javax.inject.Singleton

/**
 * Wrapper around the Agora RtcEngine for voice chat functionality.
 *
 * Prerequisites:
 * - Set your Agora App ID in the AGORA_APP_ID constant below
 * - For production, use AgoraTokenService to fetch tokens
 */
@Singleton
class AgoraVoiceService @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val tokenService: AgoraTokenService
) {
    enum class ConnectionState { CONNECTED, DISCONNECTED, RECONNECTING }

    companion object {
        private const val TAG = "AgoraVoiceService"
        const val AGORA_APP_ID = "7bdf5596c88f49edba75568f529c4389"

        /**
         * Processes raw Agora speaker data into a set of speaking user UIDs.
         * Uses separate thresholds: local mic capture levels are higher than
         * remote decoded playback levels, so remote uses a lower threshold.
         */
        fun processSpeakers(
            speakers: Array<out IRtcEngineEventHandler.AudioVolumeInfo>?,
            localUid: Int,
            isLocalMuted: Boolean,
            localThreshold: Int = AppConstants.AGORA_SPEAKING_VOLUME_THRESHOLD,
            remoteThreshold: Int = AppConstants.AGORA_REMOTE_SPEAKING_THRESHOLD
        ): Set<Int> {
            return speakers
                ?.filter {
                    val threshold = if (it.uid == 0) localThreshold else remoteThreshold
                    it.volume > threshold
                }
                ?.filter { !(it.uid == 0 && isLocalMuted) }
                ?.map { if (it.uid == 0) localUid else it.uid }
                ?.toSet() ?: emptySet()
        }
    }

    @Volatile private var rtcEngine: RtcEngine? = null
    @Volatile private var currentChannelName: String? = null
    @Volatile private var localUid: Int = 0
    @Volatile private var isLocalMuted = false
    private val joinMutex = Mutex()

    // Track last-seen timestamp per speaker UID to merge split SDK callbacks.
    // The Agora SDK fires onAudioVolumeIndication multiple times per interval
    // (once for local, once for remote), each replacing the previous set.
    // By keeping speakers "alive" for one full interval window, both local
    // and remote speakers remain visible simultaneously.
    private val speakerLastSeen = ConcurrentHashMap<Int, Long>()

    private val _speakingUsers = MutableStateFlow<Set<Int>>(emptySet())
    val speakingUsers: StateFlow<Set<Int>> = _speakingUsers.asStateFlow()

    private val _isJoined = MutableStateFlow(false)
    val isJoined: StateFlow<Boolean> = _isJoined.asStateFlow()

    private val _connectionState = MutableStateFlow(ConnectionState.DISCONNECTED)
    val connectionState: StateFlow<ConnectionState> = _connectionState.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    fun clearError() { _error.value = null }

    private val rtcEventHandler = object : IRtcEngineEventHandler() {
        override fun onJoinChannelSuccess(channel: String?, uid: Int, elapsed: Int) {
            Log.d(TAG, "onJoinChannelSuccess channel=$channel uid=$uid elapsed=${elapsed}ms")
            localUid = uid  // Use Agora-confirmed UID
            _isJoined.value = true
            _connectionState.value = ConnectionState.CONNECTED
            // Ensure volume indication is active after channel join completes —
            // calls made before onJoinChannelSuccess may be ignored by the SDK.
            // reportVad=false so local + remote speakers arrive in ONE callback.
            rtcEngine?.enableAudioVolumeIndication(
                AppConstants.AGORA_VOLUME_INDICATION_INTERVAL_MS,
                AppConstants.AGORA_VOLUME_INDICATION_SMOOTH,
                false
            )
        }

        override fun onLeaveChannel(stats: RtcStats?) {
            Log.d(TAG, "onLeaveChannel")
            _isJoined.value = false
            _speakingUsers.value = emptySet()
            speakerLastSeen.clear()
            _connectionState.value = ConnectionState.DISCONNECTED
        }

        override fun onError(err: Int) {
            Log.e(TAG, "Agora onError code=$err")
            _error.value = "Voice error (code $err)"
        }

        override fun onConnectionStateChanged(state: Int, reason: Int) {
            Log.d(TAG, "onConnectionStateChanged state=$state reason=$reason")
            _connectionState.value = when (state) {
                Constants.CONNECTION_STATE_CONNECTED -> ConnectionState.CONNECTED
                Constants.CONNECTION_STATE_DISCONNECTED,
                Constants.CONNECTION_STATE_FAILED -> ConnectionState.DISCONNECTED
                else -> ConnectionState.RECONNECTING
            }
        }

        override fun onAudioVolumeIndication(
            speakers: Array<out AudioVolumeInfo>?,
            totalVolume: Int
        ) {
            val now = SystemClock.elapsedRealtime()
            val newSpeakers = processSpeakers(speakers, localUid, isLocalMuted)

            // Record timestamp for each speaker reported in this callback
            for (uid in newSpeakers) {
                speakerLastSeen[uid] = now
            }

            // Keep speakers visible for one full interval + margin so split
            // callbacks (local vs remote) don't erase each other
            val keepWindow = AppConstants.AGORA_VOLUME_INDICATION_INTERVAL_MS + 100L
            val active = speakerLastSeen.entries
                .filter { now - it.value < keepWindow }
                .map { it.key }
                .toSet()

            // Prune stale entries
            speakerLastSeen.entries.removeIf { now - it.value >= keepWindow }

            if (active != _speakingUsers.value) {
                Log.d(TAG, "speakingUsers changed: $active (was: ${_speakingUsers.value})")
                _speakingUsers.value = active
            }
        }

        override fun onUserOffline(uid: Int, reason: Int) {
            Log.d(TAG, "onUserOffline uid=$uid reason=$reason")
            _speakingUsers.value = _speakingUsers.value - uid
        }

        override fun onUserJoined(uid: Int, elapsed: Int) {
            Log.d(TAG, "onUserJoined uid=$uid elapsed=${elapsed}ms")
        }
    }

    fun initialize() {
        if (AGORA_APP_ID.isEmpty()) {
            Log.e(TAG, "AGORA_APP_ID is empty, cannot initialize")
            return
        }
        if (rtcEngine != null) return

        try {
            rtcEngine = RtcEngine.create(context, AGORA_APP_ID, rtcEventHandler)
            if (rtcEngine == null) {
                Log.e(TAG, "RtcEngine.create() returned null — check Agora App ID and SDK setup")
                _error.value = "Voice engine returned null — check Agora App ID"
                return
            }
            Log.d(TAG, "RtcEngine created successfully")
            rtcEngine?.apply {
                setChannelProfile(Constants.CHANNEL_PROFILE_LIVE_BROADCASTING)
                setAudioProfile(
                    Constants.AUDIO_PROFILE_SPEECH_STANDARD,
                    Constants.AUDIO_SCENARIO_CHATROOM
                )
                enableAudioVolumeIndication(
                    AppConstants.AGORA_VOLUME_INDICATION_INTERVAL_MS,
                    AppConstants.AGORA_VOLUME_INDICATION_SMOOTH,
                    false
                )
                setDefaultAudioRoutetoSpeakerphone(true)
                // Keep audio session alive when another app (e.g. WeChat) takes audio focus
                setParameters("{\"che.audio.keep.audiosession\":true}")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize RtcEngine", e)
            _error.value = "Voice engine init failed: ${e.message}"
            rtcEngine = null
        }
    }

    suspend fun joinChannel(channelName: String, uid: Int, asBroadcaster: Boolean = false) = joinMutex.withLock {
        // Already in this channel — no-op
        if (_isJoined.value && currentChannelName == channelName) {
            Log.d(TAG, "Already joined channel=$channelName, skipping rejoin")
            return@withLock
        }

        initialize()
        val engine = rtcEngine ?: run {
            Log.e(TAG, "RtcEngine is null, cannot join channel")
            _error.value = "Voice engine failed to initialize"
            return@withLock
        }

        // Leave any existing channel first
        if (currentChannelName != null) {
            Log.d(TAG, "Already in a channel, leaving first")
            engine.leaveChannel()
            _isJoined.value = false
            currentChannelName = null
            delay(500)
        }

        // Only enable audio capture when joining as broadcaster (requires RECORD_AUDIO permission)
        if (asBroadcaster) {
            engine.enableAudio()
        }

        val token: String? = try {
            tokenService.fetchToken(channelName, uid)
        } catch (e: Exception) {
            Log.w(TAG, "Token fetch failed, joining without token (App Certificate must be disabled in Agora Console)", e)
            _error.value = "Token fetch failed — check Cloud Function deployment"
            null  // null = no token mode; empty string may cause auth errors
        }

        val options = ChannelMediaOptions().apply {
            clientRoleType = if (asBroadcaster) Constants.CLIENT_ROLE_BROADCASTER else Constants.CLIENT_ROLE_AUDIENCE
            channelProfile = Constants.CHANNEL_PROFILE_LIVE_BROADCASTING
            autoSubscribeAudio = true
            publishMicrophoneTrack = asBroadcaster
            autoSubscribeVideo = false
        }

        try {
            Log.d(TAG, "Joining channel=$channelName uid=$uid asBroadcaster=$asBroadcaster hasToken=${token != null}")
            val result = engine.joinChannel(token, channelName, uid, options)
            if (result != 0) {
                Log.e(TAG, "joinChannel failed with error code $result")
                _error.value = "Voice join failed (code $result)"
            } else {
                currentChannelName = channelName
                localUid = uid
                // Re-apply volume indication after join (may be reset by leaveChannel in some SDK versions)
                engine.enableAudioVolumeIndication(
                    AppConstants.AGORA_VOLUME_INDICATION_INTERVAL_MS,
                    AppConstants.AGORA_VOLUME_INDICATION_SMOOTH,
                    false
                )
                Log.d(TAG, "joinChannel call succeeded (waiting for onJoinChannelSuccess callback)")
                if (asBroadcaster) {
                    engine.setEnableSpeakerphone(true)
                    engine.muteLocalAudioStream(false)
                    engine.adjustRecordingSignalVolume(AppConstants.AGORA_RECORDING_SIGNAL_VOLUME)
                    Log.d(TAG, "Audio configured: speakerphone=on, mic=unmuted, recordingVolume=${AppConstants.AGORA_RECORDING_SIGNAL_VOLUME}")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "joinChannel threw exception", e)
            _error.value = "Voice join failed: ${e.message}"
        }
    }

    fun setRole(broadcaster: Boolean) {
        val engine = rtcEngine ?: return
        try {
            Log.d(TAG, "setRole broadcaster=$broadcaster")
            if (broadcaster) {
                engine.enableAudio()
                engine.setClientRole(Constants.CLIENT_ROLE_BROADCASTER)
                engine.updateChannelMediaOptions(ChannelMediaOptions().apply {
                    publishMicrophoneTrack = true
                })
                engine.setEnableSpeakerphone(true)
                engine.muteLocalAudioStream(false)
                engine.adjustRecordingSignalVolume(AppConstants.AGORA_RECORDING_SIGNAL_VOLUME)
                isLocalMuted = false
            } else {
                engine.setClientRole(Constants.CLIENT_ROLE_AUDIENCE)
                engine.updateChannelMediaOptions(ChannelMediaOptions().apply {
                    publishMicrophoneTrack = false
                })
                isLocalMuted = false
            }
            // Re-enable volume indication after role change — enableAudio() can reset it
            engine.enableAudioVolumeIndication(
                AppConstants.AGORA_VOLUME_INDICATION_INTERVAL_MS,
                AppConstants.AGORA_VOLUME_INDICATION_SMOOTH,
                false
            )
        } catch (e: Exception) {
            Log.e(TAG, "setRole failed", e)
            _error.value = "Voice role change failed: ${e.message}"
        }
    }

    fun leaveChannel() {
        Log.d(TAG, "leaveChannel called, isJoined=${_isJoined.value}")
        _isJoined.value = false
        currentChannelName = null
        localUid = 0
        isLocalMuted = false
        try {
            rtcEngine?.leaveChannel()
        } catch (e: Exception) {
            Log.e(TAG, "leaveChannel failed", e)
        }
    }

    fun muteLocalAudio(mute: Boolean) {
        Log.d(TAG, "muteLocalAudio mute=$mute")
        isLocalMuted = mute
        try {
            rtcEngine?.muteLocalAudioStream(mute)
        } catch (e: Exception) {
            Log.e(TAG, "muteLocalAudio failed", e)
        }
    }

    fun destroy() {
        try {
            rtcEngine?.leaveChannel()
            RtcEngine.destroy()
        } catch (e: Exception) {
            Log.e(TAG, "destroy failed", e)
        }
        rtcEngine = null
        _isJoined.value = false
        _speakingUsers.value = emptySet()
        speakerLastSeen.clear()
        _connectionState.value = ConnectionState.DISCONNECTED
        isLocalMuted = false
    }
}
