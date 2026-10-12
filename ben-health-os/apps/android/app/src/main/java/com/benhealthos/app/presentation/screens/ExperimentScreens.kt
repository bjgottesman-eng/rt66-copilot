package com.benhealthos.app.presentation.screens

import android.app.Application
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
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
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
import com.benhealthos.app.data.remote.CheckInInputDto
import com.benhealthos.app.data.remote.CheckInsDto
import com.benhealthos.app.data.remote.ExperimentDto
import com.benhealthos.app.data.remote.ExperimentsDto
import com.benhealthos.app.data.remote.TrainingOverviewDto
import com.benhealthos.app.di.appContainer
import com.benhealthos.app.presentation.components.SectionCard
import com.benhealthos.app.presentation.components.StatusChip
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import java.time.LocalDate

class ExperimentsViewModel(app: Application) : AndroidViewModel(app) {
    private val container = app.appContainer
    val experiments = MutableStateFlow<ExperimentsDto?>(null)
    val training = MutableStateFlow<TrainingOverviewDto?>(null)
    val checkIns = MutableStateFlow<CheckInsDto?>(null)
    val error = MutableStateFlow<String?>(null)
    val message = MutableStateFlow<String?>(null)

    fun loadExperiments() = viewModelScope.launch { runCatching { container.api.experiments() }.onSuccess { experiments.value = it; error.value = null }.onFailure { error.value = it.message } }
    fun loadTraining() = viewModelScope.launch {
        runCatching { container.api.training() }.onSuccess { training.value = it; error.value = null }.onFailure { error.value = it.message }
        runCatching { container.api.checkIns() }.onSuccess { checkIns.value = it }.onFailure { error.value = it.message }
    }
    fun adherence(id: String, adhered: Boolean) = viewModelScope.launch { runCatching { container.api.experimentAdherence(id, LocalDate.now().toString(), adhered) }.onFailure { error.value = it.message }; loadExperiments() }
    fun evaluate(id: String) = viewModelScope.launch { runCatching { container.api.evaluateExperiment(id) }.onFailure { error.value = it.message }; loadExperiments() }
    fun action(id: String, action: String, decision: String? = null) = viewModelScope.launch { runCatching { container.api.experimentAction(id, action, decision) }.onFailure { error.value = it.message }; loadExperiments() }
    fun addSet(exercise: String, setIndex: Int, reps: Int, loadKg: Double) = viewModelScope.launch {
        message.value = runCatching { container.api.addTrainingSet(LocalDate.now().toString(), exercise, setIndex, reps, loadKg, null); "Set saved." }.getOrElse { "Save failed: ${it.message}" }
        loadTraining()
    }
    fun addCheckIn(input: CheckInInputDto) = viewModelScope.launch {
        message.value = runCatching { container.api.addCheckIn(input); "Check-in saved." }.getOrElse { "Save failed: ${it.message}" }
        loadTraining()
    }
}

private fun pretty(s: String?): String = (s ?: "—").lowercase().replace('_', ' ')
private fun n(v: Double?, digits: Int = 1): String = if (v == null) "—" else String.format(java.util.Locale.US, "%.${digits}f", v)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ExperimentsScreen(vm: ExperimentsViewModel = viewModel()) {
    val data by vm.experiments.collectAsState()
    val error by vm.error.collectAsState()
    LaunchedEffect(Unit) { vm.loadExperiments() }
    Scaffold(topBar = { TopAppBar(title = { Text("Experiments") }) }) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            error?.let { item { Text(it, color = MaterialTheme.colorScheme.error) } }
            val list = data?.experiments ?: emptyList()
            if (data != null && list.isEmpty()) item { SectionCard { Text("No experiments yet. Design one on the web dashboard; the inbox proposes low-risk candidates.", style = MaterialTheme.typography.bodyMedium) } }
            items(list, key = { it.id }) { e -> ExperimentCard(e, vm) }
            data?.notes?.let { notes -> item { notes.forEach { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 4.dp)) } } }
        }
    }
}

@Composable
private fun ExperimentCard(e: ExperimentDto, vm: ExperimentsViewModel) {
    val ev = e.evaluation
    val open = e.status !in setOf("COMPLETED", "ABANDONED")
    SectionCard {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(e.title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            StatusChip(e.status)
        }
        Text("${pretty(e.design)} · outcome ${e.primaryOutcomeLabel}" + (e.startDate?.let { " · $it → ${e.endDate ?: "open"}" } ?: " · not started"), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text("Intervention: ${e.intervention}", style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 4.dp))
        e.phases.forEach { p ->
            val pe = ev?.phases?.find { it.sequence == p.sequence }
            Text("${p.sequence}. ${p.phase.lowercase()} ${p.startDate} → ${p.endDate ?: "open"}" + (pe?.let { " · mean ${n(it.stats.mean)} ${ev.unit} · ${it.stats.daysWithData}/${it.stats.days} days" + (it.adherenceRate?.let { r -> " · adherence ${(r * 100).toInt()}%" } ?: "") } ?: ""), style = MaterialTheme.typography.labelSmall)
        }
        if (ev != null) {
            HorizontalDivider(Modifier.padding(vertical = 6.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                StatusChip(ev.verdict)
                Spacer(Modifier.height(0.dp).padding(horizontal = 4.dp))
                Text((if (ev.preliminary) "preliminary · " else "") + "${ev.confidence.lowercase()} confidence · ${pretty(ev.changeClass)}", style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(start = 8.dp))
            }
            Text(ev.summary, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 4.dp))
            ev.reasons.forEach { Text("• $it", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            Text("Limitations: ${ev.limitations.joinToString(" ")}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
        }
        e.decision?.let { Text("Decision: ${pretty(it)}" + (e.decisionNote?.let { note -> " — $note" } ?: ""), style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 4.dp)) }
        if (open) {
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                if (e.status == "DRAFT") TextButton(onClick = { vm.action(e.id, "start") }) { Text("Start today") }
                if (e.status == "INTERVENTION") { TextButton(onClick = { vm.adherence(e.id, true) }) { Text("Did it today") }; TextButton(onClick = { vm.adherence(e.id, false) }) { Text("Skipped") } }
                if (e.status != "DRAFT") TextButton(onClick = { vm.evaluate(e.id) }) { Text("Evaluate") }
            }
            if (e.status != "DRAFT") Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                listOf("ADOPT", "RETEST", "INCONCLUSIVE", "REJECT").forEach { d -> TextButton(onClick = { vm.action(e.id, "decide", d) }) { Text(pretty(d)) } }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TrainingScreen(vm: ExperimentsViewModel = viewModel()) {
    val t by vm.training.collectAsState()
    val c by vm.checkIns.collectAsState()
    val error by vm.error.collectAsState()
    val message by vm.message.collectAsState()
    var exercise by remember { mutableStateOf("") }
    var reps by remember { mutableStateOf("5") }
    var load by remember { mutableStateOf("") }
    var setIndex by remember { mutableStateOf("1") }
    val ratings = remember { mutableStateOf(mapOf("energy" to 6f, "mood" to 7f, "stress" to 4f, "soreness" to 3f, "fatigue" to 4f, "focus" to 7f, "pain" to 0f, "perceivedSleepQuality" to 7f, "subjectiveRecovery" to 6f)) }
    LaunchedEffect(Unit) { vm.loadTraining() }
    Scaffold(topBar = { TopAppBar(title = { Text("Training & check-ins") }) }) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            error?.let { item { Text(it, color = MaterialTheme.colorScheme.error) } }
            message?.let { item { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) } }
            t?.let { tr ->
                item {
                    SectionCard("Last 8 weeks") {
                        Text("Resistance sessions per week: ${n(tr.summary.sessionsPerWeek)} · ${tr.summary.weeksWithoutSession} week(s) without a session", style = MaterialTheme.typography.bodyMedium)
                        Text("Zone 2 this week: ${n(tr.zone2.minutes7d, 0)} min · ${tr.zone2.note}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text("Recovery context: HRV ${n(tr.recovery.hrv7d, 0)} ms · RHR ${n(tr.recovery.restingHr7d, 0)} bpm · sleep ${n(tr.recovery.sleep7d, 0)} min", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                item {
                    SectionCard("Progression by exercise") {
                        if (tr.summary.progression.isEmpty()) Text("No sets logged yet.", style = MaterialTheme.typography.bodySmall)
                        tr.summary.progression.forEach { p ->
                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                Text(p.exercise, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                                StatusChip(p.status)
                            }
                            Text("Best est. 1RM ${n(p.bestEstimatedOneRepMaxKg)} kg · last 4 weeks ${n(p.recentMeanKg)} vs prior ${n(p.priorMeanKg)} kg" + (p.deltaPct?.let { " (${if (it > 0) "+" else ""}$it%)" } ?: ""), style = MaterialTheme.typography.labelSmall)
                            Text(p.note, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 6.dp))
                        }
                    }
                }
                item {
                    SectionCard("Weeks") {
                        tr.summary.weeks.reversed().take(8).forEach { w -> Text("${w.weekStart}: ${w.sessions} session(s), ${w.loggedSets} sets, ${n(w.volumeKg, 0)} kg, ${n(w.minutes, 0)} min", style = MaterialTheme.typography.bodySmall) }
                    }
                }
                item {
                    SectionCard("Log a set (today)") {
                        OutlinedTextField(exercise, { exercise = it }, label = { Text("Exercise") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedTextField(setIndex, { setIndex = it.filter(Char::isDigit) }, label = { Text("Set #") }, singleLine = true, modifier = Modifier.weight(1f))
                            OutlinedTextField(reps, { reps = it.filter(Char::isDigit) }, label = { Text("Reps") }, singleLine = true, modifier = Modifier.weight(1f))
                            OutlinedTextField(load, { load = it }, label = { Text("kg") }, singleLine = true, modifier = Modifier.weight(1f))
                        }
                        OutlinedButton(enabled = exercise.isNotBlank() && reps.toIntOrNull() != null && load.toDoubleOrNull() != null, onClick = { vm.addSet(exercise.trim(), setIndex.toIntOrNull() ?: 1, reps.toInt(), load.toDouble()); setIndex = ((setIndex.toIntOrNull() ?: 1) + 1).toString() }) { Text("Save set") }
                        tr.recentSets.take(10).forEach { s -> Text("${s.localDate} · ${s.exercise} · set ${s.setIndex}: ${s.reps} × ${s.loadKg} kg", style = MaterialTheme.typography.labelSmall) }
                    }
                }
            }
            item {
                SectionCard("How do I feel? (1–10)") {
                    val labels = listOf("energy" to "Energy", "mood" to "Mood", "stress" to "Stress", "soreness" to "Soreness", "fatigue" to "Fatigue", "focus" to "Focus", "pain" to "Pain (0–10)", "perceivedSleepQuality" to "Sleep quality", "subjectiveRecovery" to "Recovery")
                    labels.forEach { (key, label) ->
                        val v = ratings.value[key] ?: 5f
                        Text("$label: ${v.toInt()}", style = MaterialTheme.typography.labelSmall)
                        Slider(value = v, onValueChange = { nv -> ratings.value = ratings.value + (key to nv) }, valueRange = if (key == "pain") 0f..10f else 1f..10f, steps = if (key == "pain") 9 else 8)
                    }
                    OutlinedButton(onClick = {
                        val r = ratings.value
                        vm.addCheckIn(CheckInInputDto(energy = r["energy"]?.toInt(), mood = r["mood"]?.toInt(), stress = r["stress"]?.toInt(), soreness = r["soreness"]?.toInt(), fatigue = r["fatigue"]?.toInt(), focus = r["focus"]?.toInt(), pain = r["pain"]?.toInt(), perceivedSleepQuality = r["perceivedSleepQuality"]?.toInt(), subjectiveRecovery = r["subjectiveRecovery"]?.toInt()))
                    }) { Text("Save check-in") }
                    c?.let { ci ->
                        Text("${ci.summary.daysLogged7d} of the last 7 days logged", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
                        ci.summary.dimensions.filter { it.mean7d != null || it.mean28d != null }.forEach { d ->
                            Text("${d.label}: 7-day ${n(d.mean7d)} (${d.daysWithData7d}d) vs 28-day ${n(d.mean28d)} (${d.daysWithData28d}d) · ${pretty(d.changeClass)}", style = MaterialTheme.typography.labelSmall)
                        }
                        ci.summary.notes.forEach { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp)) }
                    }
                }
            }
            t?.let { tr -> item { (tr.summary.notes + tr.notes).forEach { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 4.dp)) } } }
        }
    }
}
