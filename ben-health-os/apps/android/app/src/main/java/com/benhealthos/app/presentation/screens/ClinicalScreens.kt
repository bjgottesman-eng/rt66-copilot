package com.benhealthos.app.presentation.screens

import android.app.Application
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.benhealthos.app.data.remote.LabsOverviewDto
import com.benhealthos.app.data.remote.MedicationsDto
import com.benhealthos.app.data.remote.PreventiveDto
import com.benhealthos.app.di.appContainer
import com.benhealthos.app.presentation.components.KeyValue
import com.benhealthos.app.presentation.components.SectionCard
import com.benhealthos.app.presentation.components.StatusChip
import com.benhealthos.app.presentation.components.formatValue
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import java.time.LocalDate

class ClinicalViewModel(app: Application) : AndroidViewModel(app) {
    private val container = app.appContainer
    val labs = MutableStateFlow<LabsOverviewDto?>(null)
    val medications = MutableStateFlow<MedicationsDto?>(null)
    val preventive = MutableStateFlow<PreventiveDto?>(null)
    val error = MutableStateFlow<String?>(null)

    fun loadLabs() = viewModelScope.launch { runCatching { container.api.labs() }.onSuccess { labs.value = it; error.value = null }.onFailure { error.value = it.message } }
    fun loadMedications() = viewModelScope.launch { runCatching { container.api.medications() }.onSuccess { medications.value = it; error.value = null }.onFailure { error.value = it.message } }
    fun loadPreventive() = viewModelScope.launch { runCatching { container.api.preventive() }.onSuccess { preventive.value = it; error.value = null }.onFailure { error.value = it.message } }
    fun complete(id: String) = viewModelScope.launch {
        runCatching { container.api.completePreventive(id, LocalDate.now().toString()) }.onFailure { error.value = it.message }
        loadPreventive()
    }
}

private fun num(v: Double?, unit: String?): String = if (v == null) "—" else formatValue(v, unit ?: "", 2)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LabsScreen(vm: ClinicalViewModel = viewModel()) {
    val labs by vm.labs.collectAsState()
    val error by vm.error.collectAsState()
    LaunchedEffect(Unit) { vm.loadLabs() }
    Scaffold(topBar = { TopAppBar(title = { Text("Labs") }) }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            error?.let { SectionCard { StatusChip("SYNC_ERROR"); Text(it, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 8.dp)) } }
            labs?.let { l ->
                SectionCard(title = "Overview") {
                    KeyValue("Analytes", "${l.analytes.size} · ${l.analytes.sumOf { it.count }} confirmed results")
                    KeyValue("Latest panel", l.latestCollectedAt?.take(10) ?: "—")
                    KeyValue("Pending review", if (l.pendingReview > 0) "${l.pendingReview} (review on the web dashboard)" else "0")
                    KeyValue("Sources", l.sources.joinToString().ifEmpty { "—" })
                }
                if (l.analytes.isEmpty()) SectionCard { Text("No confirmed results yet. Import a Function Health PDF/CSV or connect clinical records from the web dashboard.", style = MaterialTheme.typography.bodySmall) }
                l.analytes.forEach { a ->
                    SectionCard(title = a.label + if (!a.mapped) " (unmapped)" else "") {
                        val latest = a.latest
                        if (latest == null) Text("No value", style = MaterialTheme.typography.bodySmall) else {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text("${latest.valueText ?: num(latest.value, null)} ${latest.unit ?: ""}", style = MaterialTheme.typography.titleMedium)
                                if (latest.abnormalFlag != null) StatusChip(if (latest.abnormalFlag == "N") "CURRENT" else "WATCH") else if (a.flaggedLatest) StatusChip("WATCH")
                            }
                            KeyValue("Collected", (latest.collectedAt?.take(10) ?: "unknown") + (latest.laboratory?.let { " · $it" } ?: ""))
                            KeyValue("Reference (lab)", latest.referenceText ?: "—")
                            if (latest.canonicalValue != null && latest.canonicalUnit != latest.unit) KeyValue("Canonical", num(latest.canonicalValue, latest.canonicalUnit))
                            KeyValue("vs previous", when {
                                a.direction == null -> if (a.count > 1) "not comparable" else "single result"
                                else -> "${a.direction.lowercase()}${a.deltaPct?.let { " ${if (it > 0) "+" else ""}$it%" } ?: ""} (${a.count} results)"
                            })
                            KeyValue("Source", latest.source)
                        }
                    }
                }
                l.notes.forEach { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MedicationsScreen(vm: ClinicalViewModel = viewModel()) {
    val meds by vm.medications.collectAsState()
    val error by vm.error.collectAsState()
    LaunchedEffect(Unit) { vm.loadMedications() }
    Scaffold(topBar = { TopAppBar(title = { Text("Medications & allergies") }) }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            error?.let { SectionCard { StatusChip("SYNC_ERROR"); Text(it, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 8.dp)) } }
            meds?.let { m ->
                SectionCard(title = "Medications (${m.medications.size})") {
                    if (m.medications.isEmpty()) Text("None recorded. Add medications on the web dashboard or connect clinical records.", style = MaterialTheme.typography.bodySmall)
                    m.medications.forEach { med ->
                        Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text(med.name, style = MaterialTheme.typography.bodyMedium)
                                Text(med.status.lowercase().replace('_', ' '), style = MaterialTheme.typography.bodySmall)
                            }
                            Text(listOfNotNull(med.dosage, med.frequency, med.route, med.prescribingClinician?.let { "by $it" }, "source ${med.source}").joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                if (m.unreconciled.isNotEmpty()) SectionCard(title = "Waiting for reconciliation (${m.unreconciled.size})") {
                    m.unreconciled.forEach { r -> Text("${r.name ?: "Unnamed"} · ${r.source}${r.recordedAt?.let { " · ${it.take(10)}" } ?: ""}", style = MaterialTheme.typography.bodySmall) }
                    Text("Link, create or ignore these on the web dashboard.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
                }
                SectionCard(title = "Supplements (${m.supplements.size})") {
                    if (m.supplements.isEmpty()) Text("None recorded.", style = MaterialTheme.typography.bodySmall)
                    m.supplements.forEach { s -> Text("${s.name}${s.dose?.let { " — $it" } ?: ""}${s.frequency?.let { ", $it" } ?: ""} · ${s.status.lowercase().replace('_', ' ')}", style = MaterialTheme.typography.bodySmall) }
                }
                SectionCard(title = "Allergies (${m.allergies.size})") {
                    if (m.allergies.isEmpty()) Text("None recorded.", style = MaterialTheme.typography.bodySmall)
                    m.allergies.forEach { a -> Text("${a.substance}${a.reaction?.let { " — $it" } ?: ""} · ${a.severity.lowercase()} · ${a.source}", style = MaterialTheme.typography.bodySmall) }
                }
                SectionCard(title = "Interactions") {
                    StatusChip(m.interactionsCheck.status)
                    Text(m.interactionsCheck.note, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 8.dp))
                }
                m.notes.forEach { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PreventiveScreen(vm: ClinicalViewModel = viewModel()) {
    val p by vm.preventive.collectAsState()
    val error by vm.error.collectAsState()
    LaunchedEffect(Unit) { vm.loadPreventive() }
    Scaffold(topBar = { TopAppBar(title = { Text("Preventive care") }) }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            error?.let { SectionCard { StatusChip("SYNC_ERROR"); Text(it, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 8.dp)) } }
            p?.let { pr ->
                SectionCard(title = "As of ${pr.today}") {
                    KeyValue("Due", "${pr.counts.due}")
                    KeyValue("Due within 60 days", "${pr.counts.dueSoon}")
                    KeyValue("Completed", "${pr.counts.completed}")
                    KeyValue("Discuss with clinician", "${pr.counts.discuss}")
                }
                if (pr.items.isEmpty()) SectionCard { Text("No items yet. Add them from templates on the web dashboard; every item keeps its guideline source.", style = MaterialTheme.typography.bodySmall) }
                pr.items.forEach { item ->
                    SectionCard(title = item.title) {
                        StatusChip(when (item.computedStatus) { "DUE" -> "ATTENTION"; "DUE_SOON" -> "WATCH"; "COMPLETED" -> "CURRENT"; else -> "INSUFFICIENT_DATA" })
                        KeyValue("Status", item.computedStatus.lowercase().replace('_', ' ') + (item.computedDueAt?.let { " · due $it" } ?: ""))
                        KeyValue("Last completed", item.lastCompletedAt ?: "—")
                        KeyValue("Guideline source", item.guidelineSource.ifEmpty { "—" } + (item.guidelineReviewedAt?.let { " (reviewed $it)" } ?: ""))
                        if (item.computedStatus == "DUE" || item.computedStatus == "DUE_SOON") OutlinedButton(onClick = { vm.complete(item.id) }, modifier = Modifier.padding(top = 6.dp)) { Text("Mark completed today") }
                    }
                }
                pr.notes.forEach { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        }
    }
}
