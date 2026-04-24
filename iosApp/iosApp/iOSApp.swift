import SwiftUI
import shared
import FirebaseCore
import GoogleSignIn

@main
struct iOSApp: App {
    @StateObject private var coordinator = StartingScreenCoordinator()

    init() {
        FirebaseApp.configure()
        // Debug builds use emulators, release builds use production Firebase.
        // iOS has 2 build configurations (Debug/Release) vs Android's 3 flavors
        // (local/dev/prod). Debug ≈ local, Release ≈ prod.
        #if DEBUG
        KoinHelperKt.doInitKoin(useEmulators: true)
        #else
        KoinHelperKt.doInitKoin(useEmulators: false)
        #endif
        setupGoogleSignIn()
        setupLiveKit()
    }

    private func setupLiveKit() {
        let bridge = LiveKitBridgeImpl()
        IosLiveKitBridgeKt.registerLiveKitBridge(bridge: bridge)
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if coordinator.isBlocked, let screen = coordinator.blockingScreen {
                    StartingScreenView(screen: screen,
                                       onDismiss: { coordinator.dismiss() })
                } else if !coordinator.isReady {
                    // Loading state while checking API
                    ProgressView(NSLocalizedString("starting_screen_loading", comment: "Loading"))
                        .accessibilityIdentifier("startingScreen_loading")
                } else if let screen = coordinator.dismissableScreens.first {
                    StartingScreenView(screen: screen,
                                       onDismiss: { coordinator.dismissDismissableScreen(screen) })
                } else {
                    ContentView()
                }
            }
            .task {
                await coordinator.checkStartingScreens()
            }
            .onOpenURL { url in
                GIDSignIn.sharedInstance.handle(url)
            }
        }
    }
}
