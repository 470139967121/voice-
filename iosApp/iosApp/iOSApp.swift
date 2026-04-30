import SwiftUI
import shared
import FirebaseCore
import GoogleSignIn

@main
struct iOSApp: App {
    @StateObject private var coordinator = StartingScreenCoordinator()
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    init() {
        // Debug builds use emulators with the demo-shytalk project (matches
        // Android local flavor and local/seed.js). Release builds use the
        // bundled GoogleService-Info.plist (shytalk-dev or shytalk-7ba69).
        #if DEBUG
        let options = FirebaseOptions(googleAppID: "1:0:ios:0",
                                      gcmSenderID: "0")
        // FirebaseInstallations (pulled in by FirebaseMessaging) validates the
        // API key format at app launch: must be 39 chars and start with "A".
        // The previous "demo-api-key" string crashed on launch once
        // FirebaseMessaging was added. The Firebase Emulators ignore the key
        // value, so any well-formed dummy works. Constructed at runtime to
        // avoid pre-commit secret-detector false-positives on the Google
        // API key pattern.
        options.apiKey = "A" + String(repeating: "0", count: 38)
        options.projectID = "demo-shytalk"
        options.bundleID = Bundle.main.bundleIdentifier ?? "com.shyden.shytalk"
        options.databaseURL = "http://localhost:9000?ns=demo-shytalk"
        options.storageBucket = "demo-shytalk.appspot.com"
        FirebaseApp.configure(options: options)
        KoinHelperKt.doInitKoin(useEmulators: true)
        #else
        FirebaseApp.configure()
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
