package com.benhealthos.app.presentation.screens

import android.app.Application
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.benhealthos.app.data.remote.GlucoseDayDto
import com.benhealthos.app.data.remote.NutritionDaysDto
import com.benhealthos.app.data.remote.NutritionTotalsDto
import com.benhealthos.app.di.appContainer
import com.benhealthos.app.presentation.components.KeyValue
import com.benhealthos.app.presentation.components.SectionCard
import com.benhealthos.app.presentation.components.StatusChip
import com.benhealthos.app.presentation.components.formatValue
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlin.math.max
import kotlin.math.min

class NutritionViewModel(app: Application) : AndroidViewModel(app) {
    private val container = app.appContainer
    val days = MutableStateFlow<NutritionDaysDto?>(null)
    val glucose = MutableStateFlow<GlucoseDayDto?>(null)
    val error = MutableStateFlow<String?>(null)
    val loading = MutableStateFlow(false)

    fun load(date: String? = null) {
        viewModelScope.launch {
            loading.value = true
            error.value = null
            try {
                val to = LocalDate.now()
                days.value = container.api.nutritionDays(to.minusDays(13).toString(), to.toString())
                glucose.value = container.api.glucoseDay(date)
            } catch (e: Exception) {
                error.value = e.message ?: "request failed"
            } finally {
                loading.value = false
            }
        }
    }
}

/** Local minutes-of-day for an instant in the profile time zone (rendering only). */
internal fun minutesOfDay(iso: String, zone: ZoneId): Int {
    val t = Instant.parse(iso).atZone(zone)
    return t.hour * 60 + t.minute
}

private fun fmt(v: Double?, unit: String, precision: Int = 0): String = if (v == null) "—" else formatValue(v, unit, precision)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NutritionScreen(vm: NutritionViewModel = viewModel()) {
    val days by vm.days.collectAsState()
    val glucose by vm.glucose.collectAsState()
    val error by vm.error.collectAsState()
    val loading by vm.loading.collectAsState()
    LaunchedEffect(Unit) { vm.load() }
    Scaffold(topBar = { TopAppBar(title = { Text("Nutrition & glucose") }) }) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).padding(16.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (loading && days == null) Text("Loading…", style = MaterialTheme.typography.bodySmall)
            error?.let { msg ->
                SectionCard {
                    StatusChip("SYNC_ERROR")
                    Text(msg, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 8.dp))
                }
            }
            days?.let { d ->
                NutritionSummaryCard(d)
                NutritionDaysCard(d)
            }
            glucose?.let { g -> GlucoseDayCard(g, onPickDate = { vm.load(it) }) }
            SectionCard(title = "Import") {
                Text(
                    "Cronometer CSV exports are imported from the web dashboard (Nutrition page), with a mapping review before anything is written. Imported days appear here on the next refresh.",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}

@Composable
private fun NutritionSummaryCard(d: NutritionDaysDto) {
    val t = d.targets
    SectionCard(title = "Last 7 days · ${d.daysWithData7d} day(s) with data") {
        if (d.daysWithData7d == 0) {
            Text("No logged meals in the last 7 days. Missing days are missing, not zero.", style = MaterialTheme.typography.bodySmall)
        } else {
            val m: NutritionTotalsDto = d.mean7d
            KeyValue("Calories", fmt(m.calories, "kcal") + (t.calories?.let { " · target ${fmt(it, "kcal")}" } ?: ""))
            KeyValue("Protein", fmt(m.protein_g, "g") + (t.protein_g?.let { " · target ${fmt(it, "g")}" } ?: ""))
            KeyValue("Carbohydrates", fmt(m.carbs_g, "g") + (t.carbs_g?.let { " · target ${fmt(it, "g")}" } ?: ""))
            KeyValue("Fat", fmt(m.fat_g, "g") + (t.fat_g?.let { " · target ${fmt(it, "g")}" } ?: ""))
            KeyValue("Saturated fat", fmt(m.saturated_fat_g, "g") + (t.saturated_fat_g_max?.let { " · max ${fmt(it, "g")}" } ?: ""))
            KeyValue("Fiber", fmt(m.fiber_g, "g") + (t.fiber_g?.let { " · target ${fmt(it, "g")}" } ?: ""))
            KeyValue("Sodium", fmt(m.sodium_mg, "mg") + (t.sodium_mg_max?.let { " · max ${fmt(it, "mg")}" } ?: ""))
            KeyValue("Potassium", fmt(m.potassium_mg, "mg") + (t.potassium_mg?.let { " · target ${fmt(it, "mg")}" } ?: ""))
        }
        d.notes.forEach { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp)) }
    }
}

@Composable
private fun NutritionDaysCard(d: NutritionDaysDto) {
    SectionCard(title = "Days (${d.from} → ${d.to})") {
        if (d.days.isEmpty()) Text("No nutrition days in this window.", style = MaterialTheme.typography.bodySmall)
        d.days.reversed().forEach { day ->
            Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(day.date, style = MaterialTheme.typography.bodyMedium)
                    Text("${fmt(day.totals.calories, "kcal")} · ${fmt(day.totals.protein_g, "g")} protein", style = MaterialTheme.typography.bodyMedium)
                }
                Text("${day.mealsCount} meal(s) · ${day.sources.joinToString()}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun GlucoseDayCard(g: GlucoseDayDto, onPickDate: (String) -> Unit) {
    val zone = runCatching { ZoneId.of(g.timeZone) }.getOrDefault(ZoneId.systemDefault())
    SectionCard(title = "Glucose · ${g.date}") {
        if (g.datesWithData.size > 1) {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                g.datesWithData.take(10).forEach { date -> FilterChip(selected = date == g.date, onClick = { onPickDate(date) }, label = { Text(date.substring(5)) }) }
            }
        }
        if (g.samples.isEmpty()) {
            Text("No glucose samples on this day.", style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 8.dp))
        } else {
            val pts = g.samples.map { minutesOfDay(it.t, zone) to it.mgDl }.sortedBy { it.first }
            val mealMinutes = g.meals.map { minutesOfDay(it.at, zone) }
            val band = MaterialTheme.colorScheme.primaryContainer
            val line = MaterialTheme.colorScheme.primary
            val marker = MaterialTheme.colorScheme.outline
            Canvas(Modifier.fillMaxWidth().height(150.dp).padding(top = 8.dp)) {
                val lo = min(g.range.lowMgDl - 10.0, pts.minOf { it.second })
                val hi = max(g.range.highMgDl + 10.0, pts.maxOf { it.second })
                fun x(m: Int) = size.width * m / 1440f
                fun y(v: Double) = size.height * (1f - ((v - lo) / (hi - lo)).toFloat())
                drawRect(color = band, topLeft = Offset(0f, y(g.range.highMgDl)), size = Size(size.width, y(g.range.lowMgDl) - y(g.range.highMgDl)))
                var prev: Pair<Int, Double>? = null
                for (p in pts) {
                    val q = prev
                    if (q != null && p.first - q.first <= 45) drawLine(line, Offset(x(q.first), y(q.second)), Offset(x(p.first), y(p.second)), strokeWidth = 4f, cap = StrokeCap.Round)
                    prev = p
                }
                for (m in mealMinutes) drawLine(marker, Offset(x(m), 0f), Offset(x(m), size.height), strokeWidth = 2f)
            }
            Text("00:00 → 24:00 · shaded band = your range ${fmt(g.range.lowMgDl, "")}–${fmt(g.range.highMgDl, "mg/dL")} · vertical lines = meals · gaps are gaps", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            val s = g.stats
            KeyValue("Samples", "${s.n} · ${fmt(s.coverageHours, "h", 1)} covered" + (s.intervalMinutes?.let { " · every ${fmt(it, "min")}" } ?: ""))
            KeyValue("Mean · SD · CV", "${fmt(s.mean, "mg/dL")} · ${fmt(s.sd, "")} · ${fmt(s.cvPct, "%", 1)}")
            KeyValue("Time in range", "${fmt(s.timeInRangePct, "%", 1)} (below ${fmt(s.timeBelowPct, "%", 1)}, above ${fmt(s.timeAbovePct, "%", 1)})")
            KeyValue("Overnight mean (00–06)", fmt(s.overnightMean, "mg/dL"))
            KeyValue("Range source", g.range.source ?: "default placeholder")
            if (g.excursions.isNotEmpty()) {
                Text("Meal excursions", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 8.dp))
                g.excursions.forEach { e ->
                    val body = if (e.peakMgDl == null) "not enough samples in the 2 h after the meal" else "baseline ${fmt(e.baselineMgDl, "")} → peak ${fmt(e.peakMgDl, "mg/dL")} (+${fmt(e.peakDeltaMgDl, "")}) after ${fmt(e.minutesToPeak, "min")} · iAUC ${fmt(e.iAuc2h, "")} · ${e.confidence.lowercase()} confidence"
                    Text("${e.label}: $body", style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 2.dp))
                }
            }
        }
        Text(g.freshness.note, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
        Text(g.disclaimer, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
    }
}
