package com.benhealthos.app.presentation.screens

import android.app.Application
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.benhealthos.app.data.remote.AlertsDto
import com.benhealthos.app.data.remote.RecommendationDto
import com.benhealthos.app.data.remote.RecommendationsDto
import com.benhealthos.app.data.remote.ReportDto
import com.benhealthos.app.data.remote.ReportSummaryDto
import com.benhealthos.app.di.appContainer
import com.benhealthos.app.presentation.components.SectionCard
import com.benhealthos.app.presentation.components.StatusChip
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

class IntelligenceViewModel(app: Application) : AndroidViewModel(app) {
    private val container = app.appContainer
    val reports = MutableStateFlow<List<ReportSummaryDto>?>(null)
    val report = MutableStateFlow<ReportDto?>(null)
    val recommendations = MutableStateFlow<RecommendationsDto?>(null)
    val alerts = MutableStateFlow<AlertsDto?>(null)
    val error = MutableStateFlow<String?>(null)
    val busy = MutableStateFlow(false)

    fun loadReports() = viewModelScope.launch {
        runCatching { container.api.reports() }.onSuccess { list ->
            reports.value = list.reports
            error.value = null
            list.reports.firstOrNull()?.let { open(it) }
        }.onFailure { error.value = it.message }
    }
    fun open(summary: ReportSummaryDto) = viewModelScope.launch { runCatching { container.api.report(summary.kind, summary.id) }.onSuccess { report.value = it }.onFailure { error.value = it.message } }
    fun generate(kind: String) = viewModelScope.launch {
        busy.value = true
        runCatching { container.api.generateReport(kind) }.onSuccess { report.value = it; loadReports() }.onFailure { error.value = it.message }
        busy.value = false
    }
    fun loadInbox() = viewModelScope.launch {
        runCatching { container.api.recommendations() }.onSuccess { recommendations.value = it; error.value = null }.onFailure { error.value = it.message }
        runCatching { container.api.alerts(unreadOnly = false, refresh = true) }.onSuccess { alerts.value = it }.onFailure { error.value = it.message }
    }
    fun update(id: String, status: String) = viewModelScope.launch {
        runCatching { container.api.updateRecommendation(id, status) }.onFailure { error.value = it.message }
        loadInbox()
    }
    fun alertAction(id: String, action: String) = viewModelScope.launch {
        runCatching { container.api.alertAction(id, action) }.onFailure { error.value = it.message }
        loadInbox()
    }
}

private fun pretty(s: String?): String = (s ?: "unlabelled").lowercase().replace('_', ' ')

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HealthCeoScreen(vm: IntelligenceViewModel = viewModel()) {
    val reports by vm.reports.collectAsState()
    val report by vm.report.collectAsState()
    val error by vm.error.collectAsState()
    val busy by vm.busy.collectAsState()
    LaunchedEffect(Unit) { vm.loadReports() }
    Scaffold(topBar = { TopAppBar(title = { Text("Health CEO") }) }) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(enabled = !busy, onClick = { vm.generate("weekly") }) { Text(if (busy) "Generating…" else "Weekly report") }
                    OutlinedButton(enabled = !busy, onClick = { vm.generate("monthly") }) { Text("Monthly report") }
                }
            }
            error?.let { item { Text(it, color = MaterialTheme.colorScheme.error) } }
            item {
                SectionCard("Reports") {
                    val list = reports
                    if (list == null) Text("Loading…", style = MaterialTheme.typography.bodySmall)
                    else if (list.isEmpty()) Text("No reports yet. Reports are built only from synced data; nothing is simulated.", style = MaterialTheme.typography.bodySmall)
                    else list.forEach { r ->
                        Text("${if (r.kind == "weekly") "Weekly Health CEO" else "Monthly Health Board"} · ${r.periodFrom} → ${r.periodTo}", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.fillMaxWidth().clickable { vm.open(r) }.padding(vertical = 6.dp))
                    }
                }
            }
            report?.let { r ->
                val c = r.content
                item {
                    SectionCard(if (r.kind == "weekly") "Weekly Health CEO report" else "Monthly Health Board report") {
                        Text("${r.periodFrom} → ${r.periodTo}" + (r.baselineFrom?.let { " · baseline $it → ${r.baselineTo}" } ?: ""), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        c.executiveSummary.forEach { Text("• $it", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(vertical = 2.dp)) }
                    }
                }
                item {
                    SectionCard(if (r.kind == "weekly") "Top three priorities" else "Priorities for next month") {
                        c.priorities.forEach { p ->
                            Text("${p.rank}. ${p.title}", style = MaterialTheme.typography.titleSmall, color = if (p.insufficient) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface)
                            Text(p.text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 6.dp))
                        }
                        Text("Never more than three; empty slots stay empty.", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                items(c.sections, key = { it.key }) { s ->
                    SectionCard {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Text(s.title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                            StatusChip(if (s.insufficient) "INSUFFICIENT_DATA" else (s.claimType ?: "UNLABELLED"))
                        }
                        s.lines.forEach { Text(it, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(vertical = 2.dp)) }
                    }
                }
                if (c.physicianFollowUp.isNotEmpty()) item { SectionCard("For your physician") { c.physicianFollowUp.forEach { Text("• $it", style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(vertical = 2.dp)) } } }
                item {
                    SectionCard("AI narrative") {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Text(c.aiNarrative.provider?.let { "${it}/${c.aiNarrative.model}" } ?: "no provider", style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                            StatusChip(c.aiNarrative.status)
                        }
                        Text(c.aiNarrative.note, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        c.aiNarrative.summary?.let { Text(it, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 6.dp)) }
                        c.aiNarrative.findings.forEach { f ->
                            HorizontalDivider(Modifier.padding(vertical = 6.dp))
                            Text("${pretty(f.claimType)} · ${f.title} · ${f.confidence.lowercase()} confidence", style = MaterialTheme.typography.titleSmall)
                            Text(f.text, style = MaterialTheme.typography.bodySmall)
                            Text("Cites ${f.citations.joinToString()}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        c.aiNarrative.physicianQuestions.forEach { Text("? $it", style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 4.dp)) }
                        if (c.aiNarrative.rejected.isNotEmpty()) Text("Withheld by the validator: " + c.aiNarrative.rejected.joinToString { "${it.title} (${it.reason})" }, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
                    }
                }
                item { Text("${c.algorithm} v${c.version} · packet ${c.packetHash.take(12)} · nothing here is a diagnosis or a medication change.", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InboxScreen(vm: IntelligenceViewModel = viewModel()) {
    val recs by vm.recommendations.collectAsState()
    val alerts by vm.alerts.collectAsState()
    val error by vm.error.collectAsState()
    LaunchedEffect(Unit) { vm.loadInbox() }
    Scaffold(topBar = { TopAppBar(title = { Text("Inbox") }) }) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            error?.let { item { Text(it, color = MaterialTheme.colorScheme.error) } }
            item {
                SectionCard("Alerts") {
                    val a = alerts
                    if (a == null) Text("Loading…", style = MaterialTheme.typography.bodySmall)
                    else if (a.alerts.isEmpty()) Text("No alerts.", style = MaterialTheme.typography.bodySmall)
                    else a.alerts.forEach { al ->
                        val unread = al.readAt == null && al.dismissedAt == null
                        Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                            Text(al.title, style = MaterialTheme.typography.bodyMedium, color = if (unread) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
                            al.body?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                            if (unread) Row { TextButton(onClick = { vm.alertAction(al.id, "read") }) { Text("Mark read") }; TextButton(onClick = { vm.alertAction(al.id, "dismissed") }) { Text("Dismiss") } }
                        }
                        HorizontalDivider()
                    }
                }
            }
            val open = recs?.recommendations?.filter { it.status in setOf("NEW", "ACCEPTED", "IN_PROGRESS", "DISCUSS_WITH_CLINICIAN", "SNOOZED") } ?: emptyList()
            item { Text("Recommendations (${open.size} open)", style = MaterialTheme.typography.titleMedium) }
            if (recs != null && open.isEmpty()) item { Text("No open recommendations. They are generated with each weekly report when the rules find enough evidence.", style = MaterialTheme.typography.bodySmall) }
            items(open, key = { it.id }) { r -> RecommendationCard(r, onUpdate = { vm.update(r.id, it) }) }
            recs?.notes?.let { notes -> item { notes.forEach { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) } } }
        }
    }
}

@Composable
private fun RecommendationCard(r: RecommendationDto, onUpdate: (String) -> Unit) {
    var showEvidence by remember { mutableStateOf(false) }
    SectionCard {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text((r.priority?.let { "P$it · " } ?: "") + r.title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            StatusChip(r.status)
        }
        Text("${pretty(r.claimType)} · ${r.confidence.lowercase()} confidence" + if (r.clinicianReviewStatus != "NOT_REQUIRED") " · clinician review ${r.clinicianReviewStatus.lowercase()}" else "", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(4.dp))
        Text("Observation: ${r.observation}", style = MaterialTheme.typography.bodySmall)
        Text("Proposed: ${r.proposedAction}", style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 2.dp))
        Text(r.reason, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 2.dp))
        r.limitations?.let { Text("Limitations: $it", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        TextButton(onClick = { showEvidence = !showEvidence }) { Text(if (showEvidence) "Hide evidence" else "Evidence (${r.evidence.size})") }
        if (showEvidence) r.evidence.forEach { e -> Text("${pretty(e.evidenceType)} · ${e.citation ?: ""}" + (e.lastVerifiedAt?.let { " · verified ${it.take(10)}" } ?: if (e.evidenceType == "GUIDELINE" || e.evidenceType == "STUDY") " · citation not yet verified by a clinician" else ""), style = MaterialTheme.typography.labelSmall) }
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            if (r.status == "NEW" || r.status == "DISCUSS_WITH_CLINICIAN" || r.status == "SNOOZED") TextButton(onClick = { onUpdate("ACCEPTED") }) { Text("Accept") }
            if (r.status == "ACCEPTED" || r.status == "IN_PROGRESS") TextButton(onClick = { onUpdate("COMPLETED") }) { Text("Completed") }
            if (r.status != "DISCUSS_WITH_CLINICIAN") TextButton(onClick = { onUpdate("DISCUSS_WITH_CLINICIAN") }) { Text("Discuss") }
            TextButton(onClick = { onUpdate("DISMISSED") }) { Text("Dismiss") }
        }
    }
}
