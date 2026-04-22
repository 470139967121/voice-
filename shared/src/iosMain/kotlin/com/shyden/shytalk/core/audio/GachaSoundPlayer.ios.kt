package com.shyden.shytalk.core.audio

import com.shyden.shytalk.core.util.logW

/**
 * iOS gacha sound player. Currently uses no-op stubs since
 * procedural audio generation requires AVAudioEngine setup
 * that is non-trivial. Sound effects will be added when
 * bundled audio assets are available.
 */
actual object GachaSoundPlayer {
    private const val TAG = "GachaSoundPlayer.ios"

    actual fun init() {
        logW(TAG, "init — iOS audio not yet implemented")
    }

    actual fun release() {}

    actual fun playSpinStart() {}

    actual fun playTick(progress: Float) {}

    actual fun playBlinkClick() {}

    actual fun playWinReveal(coinValue: Int) {}

    actual fun playHighTierFanfare() {}

    actual fun playCoinPurchase() {}
}
