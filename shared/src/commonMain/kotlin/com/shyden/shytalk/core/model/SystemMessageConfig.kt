package com.shyden.shytalk.core.model

data class SystemMessageConfig(
    val showJoins: Boolean = true,
    val showLeaves: Boolean = true,
    val showRoleChanges: Boolean = true,
    val showPermissionChanges: Boolean = true
) {
    fun toMap(): Map<String, Boolean> = mapOf(
        "showJoins" to showJoins,
        "showLeaves" to showLeaves,
        "showRoleChanges" to showRoleChanges,
        "showPermissionChanges" to showPermissionChanges
    )

    companion object {
        fun fromMap(map: Map<String, Any?>): SystemMessageConfig = SystemMessageConfig(
            showJoins = map["showJoins"] as? Boolean ?: true,
            showLeaves = map["showLeaves"] as? Boolean ?: true,
            showRoleChanges = map["showRoleChanges"] as? Boolean ?: true,
            showPermissionChanges = map["showPermissionChanges"] as? Boolean ?: true
        )
    }
}
