package com.shyden.shytalk.ui.components.seasonal

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.semantics.clearAndSetSemantics
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

// Pre-computed colours (avoid allocation in draw loop)
private val GoldColor = Color(0xFFD4A017)
private val GoldBright = Color(0xFFF0C246)
private val SaffronColor = Color(0xFFE67E22)
private val LotusPink = Color(0xFFD4618A)
private val BgTop = Color(0xFF1A1510)
private val BgBottom = Color(0xFF0F0A06)
private val WaterDrop = Color(0x40B8D4E8)
private val NagaColor = Color(0x0AD4A017)

private data class LotusSpec(
    val xFraction: Float,
    val yFraction: Float,
    val size: Float,
    val speedFactor: Float,
)

private data class DropSpec(
    val xFraction: Float,
    val speedFactor: Float,
    val size: Float,
)

/**
 * Animated Khmer New Year room background.
 *
 * Features:
 * - Gold-to-temple-stone vertical gradient
 * - 5 floating lotus flowers with gentle bob animation
 * - 12 water droplet particles falling (water ceremony tradition)
 * - Naga serpent watermark at low opacity
 * - Cloud wisps at bottom
 */
@Composable
fun KhmerNewYearBackground() {
    val lotuses =
        remember {
            listOf(
                LotusSpec(0.15f, 0.20f, 28f, 0.8f),
                LotusSpec(0.80f, 0.35f, 24f, 1.2f),
                LotusSpec(0.45f, 0.65f, 32f, 1.0f),
                LotusSpec(0.25f, 0.80f, 20f, 1.4f),
                LotusSpec(0.70f, 0.15f, 26f, 0.9f),
            )
        }
    val drops =
        remember {
            List(12) {
                DropSpec(
                    xFraction = (it * 0.08f + 0.04f) % 1f,
                    speedFactor = 0.6f + (it % 5) * 0.15f,
                    size = 2f + (it % 3) * 1.5f,
                )
            }
        }

    val transition = rememberInfiniteTransition(label = "kny")

    // Lotus bob animation (6-second cycle)
    val lotusPhase by transition.animateFloat(
        initialValue = 0f,
        targetValue = 2f * PI.toFloat(),
        animationSpec =
            infiniteRepeatable(
                animation = tween(6000, easing = LinearEasing),
                repeatMode = RepeatMode.Restart,
            ),
        label = "lotusBob",
    )

    // Water droplet fall animation (10-second cycle)
    val dropPhase by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec =
            infiniteRepeatable(
                animation = tween(10000, easing = LinearEasing),
                repeatMode = RepeatMode.Restart,
            ),
        label = "dropFall",
    )

    Canvas(modifier = Modifier.fillMaxSize().clearAndSetSemantics { }) {
        val w = size.width
        val h = size.height

        // Background gradient
        drawRect(
            brush =
                Brush.verticalGradient(
                    colors = listOf(BgTop, BgBottom),
                ),
        )

        // Naga watermark (very subtle)
        drawNagaWatermark(w, h)

        // Cloud wisps at bottom
        drawCloudWisps(w, h)

        // Lotus flowers
        for (lotus in lotuses) {
            val bobOffset = sin(lotusPhase * lotus.speedFactor) * 6f
            val x = w * lotus.xFraction
            val y = h * lotus.yFraction + bobOffset
            drawLotus(x, y, lotus.size)
        }

        // Water droplets
        for (drop in drops) {
            val progress = (dropPhase * drop.speedFactor) % 1f
            val x = w * drop.xFraction
            val y = h * progress
            val alpha =
                if (progress < 0.1f) {
                    progress * 10f
                } else if (progress > 0.9f) {
                    (1f - progress) * 10f
                } else {
                    1f
                }
            drawCircle(
                color = WaterDrop.copy(alpha = alpha * 0.5f),
                radius = drop.size,
                center = Offset(x, y),
            )
        }
    }
}

private fun DrawScope.drawLotus(
    cx: Float,
    cy: Float,
    baseSize: Float,
) {
    // Outer petals
    for (angle in listOf(-25f, 25f)) {
        val path =
            Path().apply {
                moveTo(cx, cy)
                val rad = angle * PI.toFloat() / 180f
                val tipX = cx + sin(rad) * baseSize * 1.2f
                val tipY = cy - cos(rad) * baseSize * 1.8f
                quadraticTo(
                    cx + sin(rad) * baseSize * 0.3f,
                    cy - baseSize * 1.0f,
                    tipX,
                    tipY,
                )
                quadraticTo(
                    cx + sin(rad) * baseSize * 0.8f,
                    cy - baseSize * 0.5f,
                    cx,
                    cy,
                )
            }
        drawPath(path, GoldColor.copy(alpha = 0.3f))
    }

    // Centre petal
    val centrePath =
        Path().apply {
            moveTo(cx, cy)
            quadraticTo(cx - baseSize * 0.2f, cy - baseSize * 1.2f, cx, cy - baseSize * 2f)
            quadraticTo(cx + baseSize * 0.2f, cy - baseSize * 1.2f, cx, cy)
        }
    drawPath(centrePath, GoldBright.copy(alpha = 0.4f))

    // Centre dot
    drawCircle(SaffronColor.copy(alpha = 0.5f), baseSize * 0.15f, Offset(cx, cy - baseSize * 0.3f))
}

private fun DrawScope.drawNagaWatermark(
    w: Float,
    h: Float,
) {
    // Simple serpentine curve as a Naga silhouette
    val path =
        Path().apply {
            val cx = w * 0.5f
            val cy = h * 0.5f
            moveTo(cx - w * 0.15f, cy + h * 0.05f)
            cubicTo(
                cx - w * 0.08f,
                cy - h * 0.1f,
                cx + w * 0.08f,
                cy + h * 0.1f,
                cx + w * 0.15f,
                cy - h * 0.05f,
            )
        }
    drawPath(
        path,
        NagaColor,
        style =
            androidx.compose.ui.graphics.drawscope
                .Stroke(width = 8f),
    )
}

private fun DrawScope.drawCloudWisps(
    w: Float,
    h: Float,
) {
    val y = h * 0.92f
    for (i in 0..2) {
        val cx = w * (0.2f + i * 0.3f)
        val path =
            Path().apply {
                moveTo(cx - w * 0.12f, y)
                cubicTo(
                    cx - w * 0.06f,
                    y - h * 0.03f,
                    cx + w * 0.06f,
                    y - h * 0.03f,
                    cx + w * 0.12f,
                    y,
                )
            }
        drawPath(
            path,
            Color.White.copy(alpha = 0.02f),
            style =
                androidx.compose.ui.graphics.drawscope
                    .Stroke(width = 20f),
        )
    }
}
