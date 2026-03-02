package com.shyden.shytalk.feature.splash

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.shyden.shytalk.core.model.FunFact

@Composable
fun FunFactSplashScreen(
    warmUpComplete: Boolean,
    funFacts: List<FunFact>,
    onContinue: () -> Unit,
    modifier: Modifier = Modifier
) {
    // Auto-navigate when warmup finishes
    LaunchedEffect(warmUpComplete) {
        if (warmUpComplete) onContinue()
    }

    val primaryColor = MaterialTheme.colorScheme.primary
    val blushColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.2f)

    Surface(
        modifier = modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            // Speech bubble logo
            Canvas(modifier = Modifier.size(96.dp)) {
                val w = size.width
                val h = size.height

                // Speech bubble body
                drawRoundRect(
                    color = primaryColor,
                    topLeft = Offset(w * 0.12f, w * 0.08f),
                    size = Size(w * 0.76f, h * 0.52f),
                    cornerRadius = CornerRadius(w * 0.08f)
                )

                // Speech bubble tail
                val tail = Path().apply {
                    moveTo(w * 0.22f, h * 0.58f)
                    lineTo(w * 0.14f, h * 0.72f)
                    lineTo(w * 0.40f, h * 0.58f)
                    close()
                }
                drawPath(tail, color = primaryColor)

                // Three dots
                val dotY = h * 0.34f
                val dotRadius = w * 0.035f
                drawCircle(color = androidx.compose.ui.graphics.Color.White, radius = dotRadius, center = Offset(w * 0.36f, dotY), alpha = 0.9f)
                drawCircle(color = androidx.compose.ui.graphics.Color.White, radius = dotRadius, center = Offset(w * 0.50f, dotY), alpha = 0.65f)
                drawCircle(color = androidx.compose.ui.graphics.Color.White, radius = dotRadius, center = Offset(w * 0.64f, dotY), alpha = 0.4f)

                // Blush marks
                drawOval(color = blushColor, topLeft = Offset(w * 0.18f, h * 0.42f), size = Size(w * 0.14f, h * 0.08f))
                drawOval(color = blushColor, topLeft = Offset(w * 0.68f, h * 0.42f), size = Size(w * 0.14f, h * 0.08f))
            }

            Spacer(modifier = Modifier.height(20.dp))

            Text(
                text = "ShyTalk",
                style = MaterialTheme.typography.headlineLarge,
                color = MaterialTheme.colorScheme.primary,
                fontWeight = FontWeight.Bold
            )
        }
    }
}
