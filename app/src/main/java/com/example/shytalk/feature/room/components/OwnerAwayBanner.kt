package com.example.shytalk.feature.room.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun OwnerAwayBanner(
    remainingMs: Long,
    isOwner: Boolean,
    onOwnerReturn: () -> Unit
) {
    val minutes = (remainingMs / 60_000).toInt()
    val seconds = ((remainingMs % 60_000) / 1_000).toInt()

    Surface(
        color = MaterialTheme.colorScheme.errorContainer,
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                text = "Owner away - Room closes in ${minutes}:${"%02d".format(seconds)}",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onErrorContainer
            )

            if (isOwner) {
                Button(onClick = onOwnerReturn) {
                    Text("Return")
                }
            }
        }
    }
}
