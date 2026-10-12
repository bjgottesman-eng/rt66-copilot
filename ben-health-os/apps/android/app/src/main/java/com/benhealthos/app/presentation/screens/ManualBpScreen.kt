package com.benhealthos.app.presentation.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.benhealthos.app.data.local.PendingUploadEntity
import com.benhealthos.app.data.remote.ApiException
import com.benhealthos.app.data.remote.ManualBpDto
import com.benhealthos.app.di.appContainer
import com.benhealthos.app.presentation.components.SectionCard
import kotlinx.coroutines.launch
import java.io.IOException
import java.time.Instant
import java.util.UUID

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ManualBpScreen() {
    val container = LocalContext.current.appContainer
    val scope = rememberCoroutineScope()
    var systolic by remember { mutableStateOf("") }
    var diastolic by remember { mutableStateOf("") }
    var pulse by remember { mutableStateOf("") }
    var rest by remember { mutableStateOf("5") }
    var notes by remember { mutableStateOf("") }
    var arm by remember { mutableStateOf("LEFT") }
    var posture by remember { mutableStateOf("SEATED") }
    var message by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val field = Modifier.fillMaxWidth()

    Scaffold(topBar = { TopAppBar(title = { Text("Blood pressure") }) }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            SectionCard("Primary source") {
                Text("Your Withings cuff syncs automatically: cuff → Withings cloud → backend (Phase 2 API connection) and via Health Connect when the Withings app exports to it. Manual entry below is optional and deduplicated against cuff readings.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            SectionCard("Manual entry") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(systolic, { systolic = it.filter(Char::isDigit) }, label = { Text("Systolic") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.weight(1f))
                    OutlinedTextField(diastolic, { diastolic = it.filter(Char::isDigit) }, label = { Text("Diastolic") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.weight(1f))
                    OutlinedTextField(pulse, { pulse = it.filter(Char::isDigit) }, label = { Text("Pulse") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.weight(1f))
                }
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { listOf("LEFT", "RIGHT").forEach { a -> FilterChip(selected = arm == a, onClick = { arm = a }, label = { Text("${a.lowercase()} arm") }) } }
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { listOf("SEATED", "STANDING", "LYING").forEach { p -> FilterChip(selected = posture == p, onClick = { posture = p }, label = { Text(p.lowercase()) }) } }
                OutlinedTextField(rest, { rest = it.filter(Char::isDigit) }, label = { Text("Seated rest before reading (min)") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = field)
                OutlinedTextField(notes, { notes = it }, label = { Text("Notes") }, modifier = field)
                Spacer(Modifier.height(8.dp))
                Button(enabled = !busy && systolic.isNotBlank() && diastolic.isNotBlank(), modifier = field, onClick = {
                    val dto = ManualBpDto(
                        systolic = systolic.toInt(), diastolic = diastolic.toInt(), pulse = pulse.toIntOrNull(), measuredAt = Instant.now().toString(),
                        arm = arm, posture = posture, seatedRestMinutes = rest.toIntOrNull(), notes = notes.ifBlank { null }, clientEntryId = "android-" + UUID.randomUUID(),
                    )
                    if (dto.diastolic >= dto.systolic) { message = "Diastolic must be lower than systolic."; return@Button }
                    busy = true; message = null
                    scope.launch {
                        try {
                            val r = container.api.manualBloodPressure(dto)
                            message = "Saved ${r.systolic.toInt()}/${r.diastolic.toInt()}${if (!r.canonical) " (linked as duplicate of a cuff reading)" else ""}."
                            systolic = ""; diastolic = ""; pulse = ""
                        } catch (e: ApiException) {
                            message = if (e.code in 400..499) "Rejected: ${e.message}" else queue(container, dto)
                        } catch (e: IOException) {
                            message = queue(container, dto)
                        } finally { busy = false }
                    }
                }) { Text(if (busy) "Saving…" else "Save reading") }
                message?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        }
    }
}

private suspend fun queue(container: com.benhealthos.app.di.AppContainer, dto: ManualBpDto): String {
    container.database.pendingUploads().insert(PendingUploadEntity(createdAt = Instant.now().toString(), endpoint = "/v1/measurements/blood-pressure", bodyJson = container.json.encodeToString(ManualBpDto.serializer(), dto)))
    return "Offline: saved locally and will upload on the next sync."
}
