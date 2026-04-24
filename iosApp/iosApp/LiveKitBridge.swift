import Foundation
import LiveKitClient
import shared

/// Swift implementation of the Kotlin LiveKitBridge interface.
/// Uses LiveKit 2.0 RoomDelegate pattern for event handling.
class LiveKitBridgeImpl: NSObject, shared.LiveKitBridge, RoomDelegate {
    private var room: Room?
    private var kotlinDelegate: shared.LiveKitBridgeDelegate?

    func setDelegate(delegate: shared.LiveKitBridgeDelegate?) {
        self.kotlinDelegate = delegate
    }

    func connect(url: String, token: String) {
        let room = Room(delegate: self)
        self.room = room

        Task {
            do {
                try await room.connect(url: url, token: token)
            } catch {
                await MainActor.run {
                    self.kotlinDelegate?.onConnectionFailed(error: error.localizedDescription)
                }
            }
        }
    }

    func disconnect() {
        Task {
            await room?.disconnect()
            room = nil
        }
    }

    func setMicrophoneEnabled(enabled: Bool) {
        guard let room = room else { return }
        Task {
            do {
                try await room.localParticipant.setMicrophone(enabled: enabled)
            } catch {
                await MainActor.run {
                    self.kotlinDelegate?.onConnectionFailed(error: "Microphone error: \(error.localizedDescription)")
                }
            }
        }
    }

    func isMicrophoneEnabled() -> Bool {
        return room?.localParticipant.isMicrophoneEnabled() ?? false
    }

    func isConnected() -> Bool {
        return room?.connectionState == .connected
    }

    // MARK: - RoomDelegate

    func roomDidConnect(_ room: Room) {
        kotlinDelegate?.onConnected()
    }

    func room(_ room: Room, didDisconnectWithError error: LiveKitError?) {
        kotlinDelegate?.onDisconnected()
    }

    func roomIsReconnecting(_ room: Room) {
        kotlinDelegate?.onReconnecting()
    }

    func roomDidReconnect(_ room: Room) {
        kotlinDelegate?.onReconnected()
    }

    func room(_ room: Room, didUpdateSpeakingParticipants participants: [Participant]) {
        let identities = participants.compactMap { $0.identity?.stringValue }
        kotlinDelegate?.onActiveSpeakersChanged(speakerIdentities: identities)
    }

    func room(_ room: Room, participantDidDisconnect participant: RemoteParticipant) {
        if let identity = participant.identity?.stringValue {
            kotlinDelegate?.onParticipantDisconnected(identity: identity)
        }
    }

    func room(_ room: Room, didFailToConnectWithError error: LiveKitError?) {
        kotlinDelegate?.onConnectionFailed(error: error?.localizedDescription ?? "Connection failed")
    }
}
