import Foundation
import GoogleSignIn
import FirebaseCore
import UIKit
import shared

/// Registers Google Sign-In handler with the shared Kotlin framework.
/// Called from iOSApp.init().
func setupGoogleSignIn() {
    IosGoogleSignInHelperKt.registerGoogleSignInHandler(handler: SwiftGoogleSignInHandler())
}

/// Swift implementation of the Kotlin GoogleSignInHandler interface.
private class SwiftGoogleSignInHandler: shared.GoogleSignInHandler {
    func signIn(completion: @escaping (String?, String?) -> Void) {
        guard let clientID = FirebaseApp.app()?.options.clientID else {
            completion(nil, "Firebase client ID not found")
            return
        }

        let config = GIDConfiguration(clientID: clientID)
        GIDSignIn.sharedInstance.configuration = config

        guard let windowScene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .first,
              let rootViewController = windowScene.windows.first?.rootViewController else {
            completion(nil, "No root view controller found")
            return
        }

        GIDSignIn.sharedInstance.signIn(withPresenting: rootViewController) { result, error in
            if let error = error {
                if (error as NSError).code == GIDSignInError.canceled.rawValue {
                    completion(nil, "cancelled")
                } else {
                    completion(nil, error.localizedDescription)
                }
                return
            }

            guard let idToken = result?.user.idToken?.tokenString else {
                completion(nil, "No ID token returned from Google")
                return
            }

            completion(idToken, nil)
        }
    }
}
