package com.shyden.shytalk.core.effects

import androidx.compose.runtime.Composable

@Composable
expect fun KeepScreenOn()

@Composable
expect fun RequestMicPermission(onResult: (Boolean) -> Unit)
