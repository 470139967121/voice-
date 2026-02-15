package com.shyden.shytalk.feature.profile

import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import com.shyden.shytalk.core.util.isAtLeast13

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DOBDatePickerDialog(
    onDismiss: () -> Unit,
    onDateSelected: (millis: Long, error: String?) -> Unit
) {
    val datePickerState = rememberDatePickerState()
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(
                onClick = {
                    onDismiss()
                    val millis = datePickerState.selectedDateMillis
                    if (millis != null) {
                        val error = if (!isAtLeast13(millis)) {
                            "You must be at least 13 years old"
                        } else {
                            null
                        }
                        onDateSelected(millis, error)
                    }
                }
            ) {
                Text("OK")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        }
    ) {
        DatePicker(state = datePickerState)
    }
}
