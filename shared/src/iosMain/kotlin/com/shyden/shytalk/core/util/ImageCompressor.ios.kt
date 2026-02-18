package com.shyden.shytalk.core.util

actual suspend fun compressImage(
    imageData: ByteArray,
    maxDimension: Int,
    quality: Int
): ByteArray {
    // TODO: Implement iOS image compression using UIImage/CGImage
    return imageData
}
