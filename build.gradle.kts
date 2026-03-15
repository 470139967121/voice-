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
    }
}