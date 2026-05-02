import Foundation
import GoogleSignIn
import FirebaseCore
import UIKit
import shared

/// Walks the `presentedViewController` chain from `root` and returns the
/// deepest VC. `GIDSignIn.sharedInstance.signIn(withPresenting:)` will
/// silently fail if `presentingViewController` is already presenting another
/// modal (UIKit refuses to present on an already-presenting VC). SwiftUI's
/// WindowGroup root is a `UIHostingController`, and once any modal is up
/// (sheet/alert/Compose-hosted modal) the bare root would trip that rule.
/// Used by the bridge below; covered by `GoogleSignInHelperTests`.
///
/// Not annotated `@MainActor` so the existing nonisolated bridge `signIn`
/// callback can call it synchronously — matches the pattern of the
/// rootViewController access already in this file. UIKit traversal must
/// run on the main thread; that's a runtime contract honoured by Kotlin
/// dispatching the bridge call from `Dispatchers.Main`.
func topMostViewController(from root: UIViewController) -> UIViewController {
    var current = root
    while let next = current.presentedViewController {
        current = next
    }
    return current
}

/// Registers Google Sign-In handler with the shared Kotlin framework.
/// Called from iOSApp.init().
func setupGoogleSignIn() {
    IosGoogleSignInHelperKt.registerGoogleSignInHandler(handler: SwiftGoogleSignInHandler())
}

/// Swift implementation of the Kotlin GoogleSignInHandler interface.
private class SwiftGoogleSignInHandler: shared.GoogleSignInHandler {
    func signIn(completion: @escaping (String?, String?) -> Void) {
        guard let clientID = FirebaseApp.app()?.options.clientID else {
            NSLog("[ShyTalk] GoogleSignIn pre-flight: Firebase client ID not found — FirebaseApp.configure() not yet called or GoogleService-Info.plist missing")
            completion(nil, "Firebase client ID not found")
            return
        }

        let config = GIDConfiguration(clientID: clientID)
        GIDSignIn.sharedInstance.configuration = config

        // Prefer the key window — multi-window scenes (iPad split-view) can
        // surface a non-key window first, and presenting GoogleSignIn from
        // the wrong window's VC fails silently. Fall back to the first
        // window only if no window is currently the key (cold-start race).
        guard let windowScene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .first,
              let window = windowScene.windows.first(where: { $0.isKeyWindow }) ?? windowScene.windows.first,
              let rootViewController = window.rootViewController else {
            NSLog("[ShyTalk] GoogleSignIn pre-flight: No root view controller — connectedScenes/windows enumeration empty (cold-start race or background launch)")
            completion(nil, "No root view controller found")
            return
        }

        // Hand GoogleSignIn the topmost VC, not the SwiftUI hosting root —
        // see `topMostViewController(from:)` for the Apple-pattern reason.
        // This was the most likely culprit for the silent Google Sign-In
        // failure on iOS DEV TestFlight that worked on Android.
        let presenter = topMostViewController(from: rootViewController)
        NSLog("[ShyTalk] GoogleSignIn presenter: \(type(of: presenter)), root: \(type(of: rootViewController))")

        GIDSignIn.sharedInstance.signIn(withPresenting: presenter) { result, error in
            if let error = error {
                let nsError = error as NSError
                if nsError.code == GIDSignInError.canceled.rawValue {
                    completion(nil, "cancelled")
                } else {
                    // Log full NSError detail so future failures surface in
                    // the device console — `localizedDescription` alone strips
                    // the underlying domain/code that diagnosis depends on.
                    NSLog("[ShyTalk] GoogleSignIn failed: domain=\(nsError.domain) code=\(nsError.code) desc=\(nsError.localizedDescription)")
                    completion(nil, error.localizedDescription)
                }
                return
            }

            guard let idToken = result?.user.idToken?.tokenString else {
                // Sign-in succeeded but no idToken — this is the regression mode
                // NSLog was added to surface. Without this breadcrumb the device
                // console would be silent for an Apple Sign-In-style "sheet
                // appears, dismisses, no token" failure.
                NSLog("[ShyTalk] GoogleSignIn returned no idToken — result=\(String(describing: result)) user=\(String(describing: result?.user))")
                completion(nil, "No ID token returned from Google")
                return
            }

            completion(idToken, nil)
        }
    }
}
