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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.benhealthos.app.data.remote.MetricCardDto
import com.benhealthos.app.data.remote.TodayDto
import com.benhealthos.app.data.sync.SyncTrigger
import com.benhealthos.app.di.appContainer
import com.benhealthos.app.domain.Cached
import com.benhealthos.app.presentation.components.SectionCard
import com.benhealthos.app.presentation.components.StatusChip
import com.benhealthos.app.presentation.components.formatValue
import com.benhealthos.app.presentation.components.relativeTime
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

data class TodayState(val loading: Boolean = true, val data: Cached<TodayDto>? = null, val error: String? = null, val syncing: Boolean = false, val syncMessage: String? = null)

class TodayViewModel(app: Application) : AndroidViewModel(app) {
    private val container = app.appContainer
    val state = MutableStateFlow(TodayState())

    init { load() }

    fun load() {
        viewModelScope.launch {
            state.value = state.value.copy(loading = true, error = null)
            state.value = try {
                state.value.copy(loading = false, data = container.dashboard.today())
            } catch (e: Exception) {
                state.value.copy(loading = false, error = e.message ?: "failed to load")
            }
        }
    }

    fun syncAndReload() {
        viewModelScope.launch {
            state.value = state.value.copy(syncing = true, syncMessage = null)
            val outcome = runCatching { container.syncer.sync(SyncTrigger.MANUAL) }.getOrNull()
            state.value = state.value.copy(syncing = false, syncMessage = outcome?.let { "Sync ${it.status.lowercase()}: ${it.recordsRead} read, ${it.uploaded} stored" } ?: "sync failed")
            load()
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TodayScreen(onOpenMetric: (String) -> Unit, vm: TodayViewModel = viewModel()) {
    val s by vm.state.collectAsState()
    Scaffold(topBar = {
        TopAppBar(title = { Text("Today") }, actions = {
            IconButton(onClick = { vm.syncAndReload() }, enabled = !s.syncing) { Icon(Icons.Filled.Refresh, contentDescription = "Sync now") }
        })
    }) { padding ->
        when {
            s.loading && s.data == null -> Column(Modifier.fillMaxSize().padding(padding), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) { CircularProgressIndicator() }
            s.data == null -> Column(Modifier.fillMaxSize().padding(padding).padding(20.dp)) {
                Text("Could not load the dashboard", style = MaterialTheme.typography.titleMedium)
                Text(s.error ?: "", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                Text("No cached copy is available yet. Check the API URL in Settings.", style = MaterialTheme.typography.bodySmall)
            }
            else -> {
                val cached = s.data!!
                val t = cached.value
                LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (cached.fromCache) item { SectionCard { Text("Offline: showing data cached ${relativeTime(cached.fetchedAt)}. ${cached.error ?: ""}", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall) } }
                    if (t.demoMode) item { SectionCard { Text("Demo mode: all data shown is synthetic.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) } }
                    s.syncMessage?.let { m -> item { Text(m, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) } }
                    item { SectionCard("How am I doing?") { Text(t.headline, style = MaterialTheme.typography.titleMedium) } }
                    item { ListCard("What changed", t.whatChanged.ifEmpty { listOf("No meaningful or directional changes versus your 28-day baseline.") }) }
                    item { ListCard("What matters", t.whatMatters) }
                    item { ListCard("What should I do today", t.doToday) }
                    items(t.domains, key = { it.domain }) { d ->
                        SectionCard {
                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                Text(d.label, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                                StatusChip(d.status)
                            }
                            Text(d.summary, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Spacer(Modifier.height(8.dp))
                            d.metrics.forEachIndexed { i, m ->
                                if (i > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                                MetricRow(m, onClick = { onOpenMetric(m.metricId) })
                            }
                        }
                    }
                    item {
                        SectionCard("Data quality") {
                            val q = t.dataQuality
                            Text("${q.connectedSources} connected sources · ${q.staleSources} stale · ${q.observations30d} observations (30d) · ${q.crossSourceDuplicates30d} cross-source duplicates · ${q.implausibleValues30d} implausible values", style = MaterialTheme.typography.bodySmall)
                            q.notes.forEach { Text("• $it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        }
                    }
                    item { Text(t.disclaimer, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
            }
        }
    }
}

@Composable
private fun ListCard(title: String, items: List<String>) {
    SectionCard(title) { items.forEach { Text("• $it", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(vertical = 2.dp)) } }
}

@Composable
fun MetricRow(m: MetricCardDto, onClick: () -> Unit) {
    val precision = when (m.unit) { "kg", "°C", "breaths/min", "mL/kg/min" -> 1; else -> 0 }
    val valueText = m.latest?.let { l ->
        if (m.metricId == "blood_pressure_systolic" && l.companions?.get("blood_pressure_diastolic") != null) "${l.value.toInt()}/${l.companions["blood_pressure_diastolic"]!!.toInt()} mmHg" else formatValue(l.value, m.unit, precision)
    } ?: "—"
    Column(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(m.label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(valueText, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            }
            StatusChip(m.freshness.status)
        }
        m.comparison?.let { c ->
            val delta = c.delta
            val text = if (c.changeClass == "INSUFFICIENT_EVIDENCE" || delta == null) "insufficient evidence for a baseline comparison" else "${if (delta >= 0) "+" else ""}${String.format(java.util.Locale.US, "%.${precision}f", delta)} vs 28-day baseline · ${c.changeClass.lowercase()}"
            Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Text(m.latest?.let { "${relativeTime(it.measuredAt)} · ${it.sourceLabel}" } ?: m.freshness.reason, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2)
    }
}
