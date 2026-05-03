import XCTest
import UIKit
@testable import iosApp

/// Tests for the GoogleSignIn presenter selection logic.
///
/// `GIDSignIn.sharedInstance.signIn(withPresenting:)` requires a UIViewController
/// that is in the active view hierarchy AND not already presenting a modal — Apple's
/// presenter-chain rule. SwiftUI's WindowGroup root is a `UIHostingController`. If
/// our app shows any modal (SwiftUI sheet, alert, Compose-hosted presentation),
/// passing the *root* VC to GoogleSignIn causes a silent failure because UIKit
/// refuses to present on an already-presenting VC.
///
/// `topMostViewController(from:)` walks the `presentedViewController` chain so we
/// always hand GoogleSignIn the actual top-most VC. These tests pin that
/// invariant so the next refactor doesn't accidentally bring back the bare-root
/// pattern that was a footgun on iOS DEV TestFlight.
final class GoogleSignInHelperTests: XCTestCase {

    /// Test double — a UIViewController that exposes a settable presentedViewController
    /// so we can build a chain in unit tests without needing a real window/UIWindow scene.
    private class StubViewController: UIViewController {
        private var stub: UIViewController?
        override var presentedViewController: UIViewController? { stub }
        func setStubPresented(_ vc: UIViewController?) { stub = vc }
    }

    func test_topMost_returnsRoot_whenNoPresentation() {
        let root = StubViewController()
        XCTAssertIdentical(topMostViewController(from: root), root)
    }

    func test_topMost_returnsPresentedModal_whenOneModal() {
        let root = StubViewController()
        let presented = UIViewController()
        root.setStubPresented(presented)
        XCTAssertIdentical(topMostViewController(from: root), presented)
    }

    func test_topMost_walksMultipleLevels() {
        let root = StubViewController()
        let middle = StubViewController()
        let top = UIViewController()
        root.setStubPresented(middle)
        middle.setStubPresented(top)
        XCTAssertIdentical(topMostViewController(from: root), top)
    }
}
