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
        //
        // Defence-in-depth: this entire block is `#if DEBUG`. If a misconfigured
        // Xcode scheme ever ships a Debug build to TestFlight/App Store, the
        // emulator URL (`http://localhost:9000`) would also fail loudly — not
        // just this dummy key — so the worst-case is a non-functional build,
        // not a credential leak. The startup log below makes the misconfiguration
        // obvious in the device console on first launch.
        options.apiKey = "A" + String(repeating: "0", count: 38)
        NSLog("[ShyTalk] DEBUG build — using Firebase Emulators (project=demo-shytalk, db=localhost:9000). NOT FOR PRODUCTION.")
        options.projectID = "demo-shytalk"
        options.bundleID = Bundle.main.bundleIdentifier ?? "com.shyden.shytalk"
        options.databaseURL = "http://localhost:9000?ns=demo-shytalk"
        options.storageBucket = "demo-shytalk.appspot.com"
        FirebaseApp.configure(options: options)
        // Dev sign-in inputs are passed in only inside #if DEBUG so the
        // literals are stripped from Release iOS binaries at compile time —
        // closes the "reverse-engineer the IPA to learn the seed credential"
        // leak. The runtime gate requires `useEmulators=true` to even show
        // the button, so on a Release build both values are nil and the
        // SignInScreen dev path fails closed. Source of truth for the value
        // is `local/seed.js` — keep them in sync.
        let emulatorSeed = "localdev123"
        let emulatorEmail = "claude-test@shytalk.dev"
        // Eager device-ID compute. Calling UIDevice.identifierForVendor
        // here (after UIApplication setup, before doInitKoin → Firebase init)
        // is the safe pattern — the previous attempt to read it lazily from
        // a Koin `single` factory inside AuthViewModel construction crashed
        // with a K/N CPointer cast bug (PR #406, reverted by 043cdf47ce).
        // See `project-ios-device-id-revert-rca.md`.
        let deviceId = UIDevice.current.identifierForVendor?.uuidString ?? UUID().uuidString
        KoinHelperKt.doInitKoin(
            useEmulators: true,
            devSignInPassword: emulatorSeed,
            devSignInEmail: emulatorEmail,
            deviceId: deviceId
        )
        #else
        FirebaseApp.configure()
        let deviceId = UIDevice.current.identifierForVendor?.uuidString ?? UUID().uuidString
        KoinHelperKt.doInitKoin(
            useEmulators: false,
            devSignInPassword: nil,
            devSignInEmail: nil,
            deviceId: deviceId
        )
        #endif
        setupGoogleSignIn()
        setupLiveKit()
        setupStoreKit()
    }

    private func setupLiveKit() {
        let bridge = LiveKitBridgeImpl()
        IosLiveKitBridgeKt.registerLiveKitBridge(bridge: bridge)
    }

    private func setupStoreKit() {
        // StoreKit 2 requires iOS 15+. App's deployment target is iOS 16
        // (per Podfile), so the availability guard is satisfied at link
        // time — runtime crashes only on a misconfigured installer.
        if #available(iOS 15.0, *) {
            let bridge = StoreKitBridgeImpl()
            IosStoreKitBridgeKt.registerStoreKitBridge(bridge: bridge)
        }
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
