package com.shyden.shytalk.feature.auth

import dev.gitlive.firebase.Firebase
import dev.gitlive.firebase.auth.auth

/**
 * iOS actual for [performDevSignIn]. GitLive Firebase KMP exposes
 * `signInWithEmailAndPassword` as a native suspend fun — no Tasks
 * adapter needed.
 */
actual suspend fun performDevSignIn(
    email: String,
    password: String,
) {
    Firebase.auth.signInWithEmailAndPassword(email, password)
}
