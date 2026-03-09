package com.shyden.shytalk.core.util

/**
 * Client-side moderation filter for PM messages.
 * Prohibited words are loaded from Firestore config/moderation document.
 *
 * Thread-safety: all public methods are synchronized to prevent concurrent
 * modification of recentMessages from multiple coroutines.
 */
object ModerationFilter {

    @kotlin.concurrent.Volatile
    private var prohibitedWords: Set<String> = emptySet()
    private val recentMessages: MutableList<Pair<Long, String>> = mutableListOf()
    private val lock = Any()

    fun updateProhibitedWords(words: List<String>) {
        prohibitedWords = words.map { it.lowercase() }.toSet()
    }

    /**
     * Returns a warning message if the text violates moderation rules, or null if clean.
     */
    fun checkMessage(text: String): String? {
        val lower = text.lowercase()

        for (word in prohibitedWords) {
            if (lower.contains(word)) {
                return "Your message may contain inappropriate content. Please review before sending."
            }
        }

        return null
    }

    /**
     * Checks for repeated message spam. Returns true if the message is considered spam.
     */
    fun isSpam(text: String): Boolean = synchronized(lock) {
        val now = currentTimeMillis()
        val windowMs = 60_000L

        recentMessages.removeAll { now - it.first > windowMs }

        val sameCount = recentMessages.count { it.second == text }
        if (sameCount >= 2) return@synchronized true

        recentMessages.add(now to text)
        false
    }

    fun reset(): Unit = synchronized(lock) {
        recentMessages.clear()
    }
}
