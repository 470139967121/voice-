package com.shyden.shytalk.core.util

import platform.UIKit.UIPasteboard

actual fun getClipboardText(): String? = UIPasteboard.generalPasteboard.string
