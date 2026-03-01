package com.shyden.shytalk.feature.splash

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.shyden.shytalk.core.model.FunFact
import kotlinx.coroutines.delay

@Composable
fun FunFactSplashScreen(
    warmUpComplete: Boolean,
    funFacts: List<FunFact>,
    onContinue: () -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background
    ) {
        Column(
            modifier = Modifier.fillMaxSize().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Text(
                text = "ShyTalk",
                style = MaterialTheme.typography.headlineLarge,
                color = MaterialTheme.colorScheme.primary,
                fontWeight = FontWeight.Bold
            )

            Spacer(modifier = Modifier.height(32.dp))

            if (funFacts.isNotEmpty()) {
                FunFactCarousel(
                    facts = funFacts,
                    modifier = Modifier.fillMaxWidth().weight(1f, fill = false)
                )
            } else {
                // Loading state before facts arrive
                FunFactPlaceholder()
            }

            Spacer(modifier = Modifier.height(32.dp))

            // Continue button — only enabled when warm-up is complete
            Button(
                onClick = onContinue,
                enabled = warmUpComplete,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 32.dp)
            ) {
                if (warmUpComplete) {
                    Text("Continue")
                } else {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.onPrimary
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}

@Composable
private fun FunFactCarousel(
    facts: List<FunFact>,
    modifier: Modifier = Modifier
) {
    val pagerState = rememberPagerState(pageCount = { facts.size })

    // Auto-advance every 5 seconds
    LaunchedEffect(pagerState, facts.size) {
        if (facts.size <= 1) return@LaunchedEffect
        while (true) {
            delay(5000)
            val next = (pagerState.currentPage + 1) % facts.size
            pagerState.animateScrollToPage(next)
        }
    }

    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            text = "Did you know?",
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        Spacer(modifier = Modifier.height(16.dp))

        HorizontalPager(
            state = pagerState,
            modifier = Modifier.fillMaxWidth()
        ) { page ->
            FunFactCard(fact = facts[page])
        }

        // Page indicator dots
        if (facts.size > 1) {
            Spacer(modifier = Modifier.height(12.dp))
            PageIndicator(
                pageCount = facts.size,
                currentPage = pagerState.currentPage
            )
        }
    }
}

@Composable
private fun FunFactCard(fact: FunFact) {
    Surface(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
        tonalElevation = 2.dp
    ) {
        Column(
            modifier = Modifier.padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            if (fact.emoji.isNotBlank()) {
                Text(
                    text = fact.emoji,
                    style = MaterialTheme.typography.displaySmall
                )
                Spacer(modifier = Modifier.height(12.dp))
            }

            Text(
                text = fact.text,
                style = MaterialTheme.typography.bodyLarge,
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.height(12.dp))

            val label = buildString {
                val categoryLabels = mapOf(
                    "language" to "Language",
                    "greeting" to "Greeting",
                    "culture" to "Culture",
                    "trivia" to "Trivia"
                )
                append(categoryLabels[fact.category] ?: fact.category)
                if (fact.sourceLanguage.isNotBlank()) {
                    append(" · ")
                    append(fact.sourceLanguage)
                }
            }
            Text(
                text = label,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)
            )
        }
    }
}

@Composable
private fun FunFactPlaceholder() {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
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
}

@Composable
private fun PageIndicator(pageCount: Int, currentPage: Int) {
    androidx.compose.foundation.layout.Row(
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        repeat(pageCount) { i ->
            Surface(
                modifier = Modifier.size(if (i == currentPage) 8.dp else 6.dp),
                shape = androidx.compose.foundation.shape.CircleShape,
                color = if (i == currentPage) MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.3f)
            ) {}
        }
    }
}
