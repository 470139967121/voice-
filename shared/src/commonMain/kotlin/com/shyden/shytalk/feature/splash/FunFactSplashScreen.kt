package com.shyden.shytalk.feature.splash

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

@Composable
fun FunFactSplashScreen(
    warmUpComplete: Boolean,
    onContinue: () -> Unit,
    modifier: Modifier = Modifier
) {
    // Auto-continue when warm-up finishes (min 1.5s so it's not a flash)
    var minTimeElapsed by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        delay(1500)
        minTimeElapsed = true
    }
    LaunchedEffect(warmUpComplete, minTimeElapsed) {
        if (warmUpComplete && minTimeElapsed) {
            onContinue()
        }
    }

    // Safety timeout — don't block user forever if warm-up hangs
    var showSkip by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        delay(5000)
        showSkip = true
    }

    Box(
        modifier = modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
            modifier = Modifier.padding(32.dp)
        ) {
            Text(
                text = "ShyTalk",
                style = MaterialTheme.typography.headlineLarge,
                color = MaterialTheme.colorScheme.primary
            )
            Spacer(modifier = Modifier.height(24.dp))
            CircularProgressIndicator(
                modifier = Modifier.size(32.dp),
                strokeWidth = 3.dp,
                color = MaterialTheme.colorScheme.primary
            )
            Spacer(modifier = Modifier.height(16.dp))
            Text(
                text = "Getting things ready...",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center
            )
        }

        // Skip button after timeout
        AnimatedVisibility(
            visible = showSkip && !warmUpComplete,
            enter = fadeIn(),
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 48.dp)
        ) {
            TextButton(onClick = onContinue) {
                Text("Skip")
            }
        }
    }
}
