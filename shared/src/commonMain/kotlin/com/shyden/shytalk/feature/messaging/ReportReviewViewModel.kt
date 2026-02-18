package com.shyden.shytalk.feature.messaging

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.ReportRepository
import com.shyden.shytalk.data.repository.UserRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class Report(
    val reportId: String = "",
    val reporterId: String = "",
    val reporterName: String = "",
    val reportedUserId: String = "",
    val reportedUserName: String = "",
    val conversationId: String = "",
    val messageId: String = "",
    val messageText: String = "",
    val reason: String = "",
    val description: String = "",
    val type: String = "", // "message" or "user"
    val timestamp: Long = 0,
    val status: String = "pending" // pending, resolved
)

data class ReportReviewUiState(
    val reports: List<Report> = emptyList(),
    val isLoading: Boolean = true,
    val message: String? = null
)

class ReportReviewViewModel(
    private val reportRepository: ReportRepository,
    private val userRepository: UserRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(ReportReviewUiState())
    val uiState: StateFlow<ReportReviewUiState> = _uiState.asStateFlow()

    init {
        loadReports()
    }

    private fun loadReports() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            when (val result = reportRepository.getPendingReports()) {
                is Resource.Success -> {
                    _uiState.update {
                        it.copy(isLoading = false, reports = result.data)
                    }
                }
                is Resource.Error -> {
                    _uiState.update {
                        it.copy(isLoading = false, message = result.message)
                    }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun resolveReport(reportId: String, action: String) {
        viewModelScope.launch {
            when (reportRepository.resolveReport(reportId, action)) {
                is Resource.Success -> {
                    _uiState.update {
                        it.copy(
                            reports = it.reports.filter { r -> r.reportId != reportId },
                            message = "Report resolved"
                        )
                    }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(message = "Failed to resolve report") }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun clearMessage() {
        _uiState.update { it.copy(message = null) }
    }
}
