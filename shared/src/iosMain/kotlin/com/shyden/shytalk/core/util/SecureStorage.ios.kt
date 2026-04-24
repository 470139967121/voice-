@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class, kotlinx.cinterop.BetaInteropApi::class)

package com.shyden.shytalk.core.util

import kotlinx.cinterop.addressOf
import kotlinx.cinterop.alloc
import kotlinx.cinterop.memScoped
import kotlinx.cinterop.ptr
import kotlinx.cinterop.usePinned
import kotlinx.cinterop.value
import platform.CoreFoundation.CFDictionaryCreateMutable
import platform.CoreFoundation.CFDictionaryRef
import platform.CoreFoundation.CFDictionarySetValue
import platform.CoreFoundation.CFMutableDictionaryRef
import platform.CoreFoundation.CFTypeRef
import platform.CoreFoundation.kCFBooleanTrue
import platform.CoreFoundation.kCFTypeDictionaryKeyCallBacks
import platform.CoreFoundation.kCFTypeDictionaryValueCallBacks
import platform.Foundation.CFBridgingRetain
import platform.Foundation.NSData
import platform.Foundation.NSString
import platform.Foundation.NSUTF8StringEncoding
import platform.Foundation.create
import platform.Security.SecItemAdd
import platform.Security.SecItemCopyMatching
import platform.Security.SecItemDelete
import platform.Security.errSecSuccess
import platform.Security.kSecAttrAccount
import platform.Security.kSecAttrService
import platform.Security.kSecClass
import platform.Security.kSecClassGenericPassword
import platform.Security.kSecMatchLimit
import platform.Security.kSecMatchLimitOne
import platform.Security.kSecReturnData
import platform.Security.kSecValueData

private const val SERVICE_NAME = "com.shyden.shytalk.secure"

private val ALL_KEYS =
    listOf(
        "credentialVersion",
        "uniqueId",
        "deviceId",
        "appLockEnabled",
        "biometricEnabled",
        "lockTimeoutMinutes",
        "lastActiveTimestamp",
        "localPinHash",
    )

actual class SecureStorage {
    private fun createQuery(
        key: String,
        extras: Map<CFTypeRef?, CFTypeRef?> = emptyMap(),
    ): CFMutableDictionaryRef {
        val dict = CFDictionaryCreateMutable(null, 0, null, null)!!
        CFDictionarySetValue(dict, kSecClass, kSecClassGenericPassword)
        CFDictionarySetValue(dict, kSecAttrService, CFBridgingRetain(SERVICE_NAME))
        CFDictionarySetValue(dict, kSecAttrAccount, CFBridgingRetain(key))
        for ((k, v) in extras) {
            CFDictionarySetValue(dict, k, v)
        }
        return dict
    }

    actual fun getString(key: String): String? {
        val query =
            createQuery(
                key,
                mapOf(
                    kSecReturnData to kCFBooleanTrue,
                    kSecMatchLimit to kSecMatchLimitOne,
                ),
            )
        memScoped {
            val result = alloc<platform.CoreFoundation.CFTypeRefVar>()
            val status = SecItemCopyMatching(query, result.ptr)
            if (status != errSecSuccess) return null
            @Suppress("UNCHECKED_CAST")
            val data = result.value as? NSData ?: return null
            return NSString.create(data = data, encoding = NSUTF8StringEncoding) as? String
        }
    }

    actual fun putString(
        key: String,
        value: String,
    ) {
        delete(key)
        val bytes = value.encodeToByteArray()
        if (bytes.isEmpty()) return
        val data =
            bytes.usePinned { pinned ->
                NSData.create(bytes = pinned.addressOf(0), length = bytes.size.toULong())
            }
        val query =
            createQuery(
                key,
                mapOf(kSecValueData to CFBridgingRetain(data)),
            )
        SecItemAdd(query, null)
    }

    actual fun getInt(
        key: String,
        default: Int,
    ): Int = getString(key)?.toIntOrNull() ?: default

    actual fun putInt(
        key: String,
        value: Int,
    ) = putString(key, value.toString())

    actual fun getBoolean(
        key: String,
        default: Boolean,
    ): Boolean = getString(key)?.toBooleanStrictOrNull() ?: default

    actual fun putBoolean(
        key: String,
        value: Boolean,
    ) = putString(key, value.toString())

    actual fun getLong(
        key: String,
        default: Long,
    ): Long = getString(key)?.toLongOrNull() ?: default

    actual fun putLong(
        key: String,
        value: Long,
    ) = putString(key, value.toString())

    actual fun remove(key: String) = delete(key)

    actual fun clear() {
        ALL_KEYS.forEach { delete(it) }
    }

    private fun delete(key: String) {
        val query = createQuery(key)
        SecItemDelete(query)
    }
}
