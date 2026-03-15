// Top-level build file where you can add configuration options common to all sub-projects/modules.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.multiplatform.library) apply false
    alias(libs.plugins.kotlin.multiplatform) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.compose.multiplatform) apply false
    alias(libs.plugins.google.services) apply false
    alias(libs.plugins.play.publisher) apply false
    id("org.sonarqube") version "7.2.3.7755"
}

sonar {
    properties {
        property("sonar.projectKey", "ShydenMcM_ShyTalk")
        property("sonar.organization", "shydenmcm")
        property("sonar.host.url", "https://sonarcloud.io")

        // Kotlin sources
        property("sonar.sources", listOf(
            "shared/src/commonMain/kotlin",
            "shared/src/androidMain/kotlin",
            "app/src/main/java",
            "express-api/src",
        ).joinToString(","))

        // Test sources
        property("sonar.tests", listOf(
            "shared/src/commonTest/kotlin",
            "shared/src/jvmTest/kotlin",
            "app/src/test/java",
            "app/src/androidTest/java",
            "express-api/tests",
        ).joinToString(","))

        // Kotlin test reports
        property("sonar.junit.reportPaths", listOf(
            "app/build/test-results/testDevDebugUnitTest",
            "shared/build/test-results/jvmTest",
        ).joinToString(","))

        // Exclusions (generated code, resources)
        property("sonar.exclusions", listOf(
            "**/build/**",
            "**/node_modules/**",
            "**/*.json",
            "**/composeResources/**",
        ).joinToString(","))
    }
}
