package com.shyden.shytalk.feature.messaging

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddPhotoAlternate
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage

private val reportReasons = listOf("Spam", "Harassment", "Inappropriate Content", "Other")

@Composable
fun ReportUserDialog(
    userName: String,
    onDismiss: () -> Unit,
    onSubmit: (reason: String, description: String) -> Unit,
    evidenceItems: List<ByteArray> = emptyList(),
    onAddEvidence: (() -> Unit)? = null,
    onRemoveEvidence: ((Int) -> Unit)? = null,
    isSubmitting: Boolean = false,
    isCompressing: Boolean = false,
    errorMessage: String? = null
) {
    var selectedReason by remember { mutableStateOf(reportReasons[0]) }
    var description by remember { mutableStateOf("") }

    val requiresEvidence = onAddEvidence != null

    AlertDialog(
        onDismissRequest = { if (!isSubmitting) onDismiss() },
        title = { Text("Report $userName") },
        text = {
            Column {
                Text(
                    text = "Why are you reporting this user?",
                    style = MaterialTheme.typography.bodyMedium
                )
                Spacer(modifier = Modifier.height(8.dp))
                reportReasons.forEach { reason ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable(enabled = !isSubmitting) { selectedReason = reason }
                            .padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        RadioButton(
                            selected = selectedReason == reason,
                            onClick = { selectedReason = reason },
                            enabled = !isSubmitting
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(text = reason, style = MaterialTheme.typography.bodyMedium)
                    }
                }
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedTextField(
                    value = description,
                    onValueChange = { description = it },
                    placeholder = { Text("Additional details (optional)") },
                    modifier = Modifier.fillMaxWidth(),
                    maxLines = 3,
                    enabled = !isSubmitting
                )

                // Evidence section
                if (requiresEvidence) {
                    Spacer(modifier = Modifier.height(12.dp))
                    Text(
                        text = "Evidence",
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.primary
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "At least one screenshot or recording is required.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(modifier = Modifier.height(8.dp))

                    // Evidence thumbnails
                    if (evidenceItems.isNotEmpty()) {
                        LazyRow(
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            itemsIndexed(evidenceItems) { index, bytes ->
                                Box(modifier = Modifier.size(72.dp)) {
                                    AsyncImage(
                                        model = bytes,
                                        contentDescription = "Evidence ${index + 1}",
                                        modifier = Modifier
                                            .size(72.dp)
                                            .clip(RoundedCornerShape(8.dp)),
                                        contentScale = ContentScale.Crop
                                    )
                                    if (onRemoveEvidence != null && !isSubmitting) {
                                        IconButton(
                                            onClick = { onRemoveEvidence(index) },
                                            modifier = Modifier
                                                .size(24.dp)
                                                .align(Alignment.TopEnd)
                                        ) {
                                            Icon(
                                                Icons.Default.Close,
                                                contentDescription = "Remove",
                                                modifier = Modifier.size(16.dp),
                                                tint = MaterialTheme.colorScheme.error
                                            )
                                        }
                                    }
                                }
                            }
                        }
                        Spacer(modifier = Modifier.height(8.dp))
                    }

                    OutlinedButton(
                        onClick = { onAddEvidence?.invoke() },
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !isSubmitting && !isCompressing
                    ) {
                        if (isCompressing) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(18.dp),
                                strokeWidth = 2.dp
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Compressing...")
                        } else {
                            Icon(
                                Icons.Default.AddPhotoAlternate,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp)
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Attach Evidence")
                        }
                    }
                }

                // Inline error message
                if (errorMessage != null) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = errorMessage,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error
                    )
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onSubmit(selectedReason, description) },
                enabled = !isSubmitting && !isCompressing && (!requiresEvidence || evidenceItems.isNotEmpty())
            ) {
                if (isSubmitting) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        strokeWidth = 2.dp
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Submitting...")
                } else {
                    Text("Submit Report")
                }
            }
        },
        dismissButton = {
            TextButton(
                onClick = onDismiss,
                enabled = !isSubmitting
            ) {
                Text("Cancel")
            }
        }
    )
}
