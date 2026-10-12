package com.benhealthos.app.presentation.screens

import android.app.Application
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.benhealthos.app.data.remote.SeriesDto
import com.benhealthos.app.di.appContainer
import com.benhealthos.app.domain.Cached
import com.benhealthos.app.presentation.components.SectionCard
import com.benhealthos.app.presentation.components.formatValue
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

class TrendsViewModel(app: Application) : AndroidViewModel(app) {
    private val container = app.appContainer
    val config = container.sharedConfig
    val series = MutableStateFlow<Cached<SeriesDto>?>(null)
    val trends = MutableStateFlow<com.benhealthos.app.data.remote.TrendsDto?>(null)
    val error = MutableStateFlow<String?>(null)

    fun load(metricId: String, days: Int) {
        viewModelScope.launch {
            error.value = null
            try { series.value = container.dashboard.series(metricId, days) } catch (e: Exception) { error.value = e.message; series.value = null }
            trends.value = runCatching { container.api.trends(metricId) }.getOrNull()
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TrendsScreen(initialMetric: String? = null, vm: TrendsViewModel = viewModel()) {
    val metrics = vm.config.metrics.filter { it.id != "lab_result" }
    var metricId by remember { mutableStateOf(initialMetric?.takeIf { id -> metrics.any { it.id == id } } ?: "resting_heart_rate") }
    var days by remember { mutableStateOf(90) }
    var menuOpen by remember { mutableStateOf(false) }
    val series by vm.series.collectAsState()
    val trends by vm.trends.collectAsState()
    val error by vm.error.collectAsState()
    LaunchedEffect(metricId, days) { vm.load(metricId, days) }
    val def = vm.config.metric(metricId)

    Scaffold(topBar = { TopAppBar(title = { Text("Trends") }) }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Column {
                    OutlinedButton(onClick = { menuOpen = true }) { Text(def?.label ?: metricId) }
                    DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                        metrics.forEach { m -> DropdownMenuItem(text = { Text("${m.label} · ${vm.config.domainLabels[m.domain] ?: m.domain}") }, onClick = { metricId = m.id; menuOpen = false }) }
                    }
                }
                listOf(30, 90, 365).forEach { d -> FilterChip(selected = days == d, onClick = { days = d }, label = { Text("${d}d") }) }
            }
            error?.let { Text("Could not load: $it", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            series?.let { cached ->
                val s = cached.value
                SectionCard(if (cached.fromCache) "Cached series" else "Daily values · ${def?.unit ?: s.unit}") {
                    val daily = s.daily
                    val values = daily.mapNotNull { it.value }
                    if (values.size < 2) {
                        Text("Not enough daily values to chart in this window. Missing days are never shown as zero.", style = MaterialTheme.typography.bodySmall)
                    } else {
                        val color = MaterialTheme.colorScheme.primary
                        val gridColor = MaterialTheme.colorScheme.outline
                        Canvas(Modifier.fillMaxWidth().height(200.dp)) {
                            val min = values.min(); val max = values.max(); val span = (max - min).takeIf { it > 0 } ?: 1.0
                            val stepX = size.width / maxOf(1, daily.size - 1)
                            for (i in 0..3) drawLine(gridColor, Offset(0f, size.height * i / 3), Offset(size.width, size.height * i / 3), strokeWidth = 1f)
                            var prev: Offset? = null
                            daily.forEachIndexed { i, d ->
                                val v = d.value
                                if (v == null) { prev = null; return@forEachIndexed }
                                val p = Offset(i * stepX, (size.height - 6f) - ((v - min) / span * (size.height - 12f)).toFloat())
                                prev?.let { drawLine(color, it, p, strokeWidth = 4f, cap = StrokeCap.Round) }
                                drawCircle(color, radius = 3f, center = p)
                                prev = p
                            }
                        }
                        Spacer(Modifier.height(4.dp))
                        Text("${formatValue(values.min(), s.unit, def?.precision ?: 1)} – ${formatValue(values.max(), s.unit, def?.precision ?: 1)} · ${values.size} of ${daily.size} days with data · ${s.points.count { !it.canonical }} linked duplicates excluded", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                trends?.let { t ->
                    SectionCard("Windows ending ${t.asOfDate}") {
                        t.windows.forEach { w ->
                            Row(Modifier.fillMaxWidth()) {
                                Text("${w.days}-day", style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                                Text(formatValue(w.stats.mean, t.unit, def?.precision ?: 1), style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                                Text("${w.stats.daysWithData}/${w.stats.days} days · ${w.confidence.lowercase()}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1.4f))
                            }
                        }
                        t.percentile365?.let { Text("Current week at the ${it.toInt()}th percentile of your trailing 365 days", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        t.zone?.let { z -> Text(if (z.maxHeartRate != null) "Max HR ${z.maxHeartRate} (${z.source}); Zone 2 ${z.zone2?.joinToString("–")} bpm" else "Set max heart rate or birth date in Settings for Zone 2.", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        t.signals.take(5).forEach { sg -> Text("• ${sg.kind.replace('_', ' ').lowercase()}: ${sg.explanation}", style = MaterialTheme.typography.bodySmall) }
                    }
                }
                SectionCard("Latest raw observations") {
                    s.points.takeLast(12).reversed().forEach { p ->
                        Text("${p.t.take(16).replace('T', ' ')}  ${formatValue(p.value, s.unit, def?.precision ?: 1)}  ${p.dataOrigin ?: p.connector}${if (!p.canonical) "  (duplicate)" else ""}", style = MaterialTheme.typography.bodySmall)
                    }
                    if (s.points.isEmpty()) Text("No raw observations in this window.", style = MaterialTheme.typography.bodySmall)
                }
            }
            @Suppress("UNUSED_VARIABLE") val keep = Color.Transparent
        }
    }
}
