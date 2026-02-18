package com.shyden.shytalk.core.util

/**
 * Client-side moderation filter for PM messages.
 * Prohibited words are loaded from Firestore config/moderation document.
 */
object ModerationFilter {

    private var prohibitedWords: Set<String> = emptySet()
    private var recentMessages: MutableList<Pair<Long, String>> = mutableListOf()

    fun updateProhibitedWords(words: List<String>) {
        prohibitedWords = words.map { it.lowercase() }.toSet()
    }

    /**
     * Returns a warning message if the text violates moderation rules, or null if clean.
     */
    fun checkMessage(text: String): String? {
        val lower = text.lowercase()

        // Check prohibited words
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
    fun isSpam(text: String): Boolean {
        val now = currentTimeMillis()
        val windowMs = 60_000L // 1 minute

        // Clean old entries
        recentMessages.removeAll { now - it.first > windowMs }

        // Check for 3+ identical messages in the window
        val sameCount = recentMessages.count { it.second == text }
        if (sameCount >= 2) return true // Would be the 3rd

        // Track this message
        recentMessages.add(now to text)
        return false
    }

    fun reset() {
        recentMessages.clear()
    }
}
