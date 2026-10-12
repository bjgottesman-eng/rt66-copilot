package com.benhealthos.app.presentation.screens

import android.app.Application
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
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
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.benhealthos.app.data.local.SyncLogEntity
import com.benhealthos.app.data.local.SyncStateEntity
import com.benhealthos.app.data.remote.SourcesDto
import com.benhealthos.app.data.sync.SyncTrigger
import com.benhealthos.app.di.appContainer
import com.benhealthos.app.domain.Cached
import com.benhealthos.app.integrations.healthconnect.SdkAvailability
import com.benhealthos.app.presentation.components.KeyValue
import com.benhealthos.app.presentation.components.SectionCard
import com.benhealthos.app.presentation.components.StatusChip
import com.benhealthos.app.presentation.components.relativeTime
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class SourcesViewModel(app: Application) : AndroidViewModel(app) {
    private val container = app.appContainer
    val hc = container.healthConnect
    val sources = MutableStateFlow<Cached<SourcesDto>?>(null)
    val error = MutableStateFlow<String?>(null)
    val granted = MutableStateFlow<Set<String>>(emptySet())
    val syncing = MutableStateFlow(false)
    val syncStates = container.database.syncState().observeAll().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())
    val pending = container.database.pendingUploads().count().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), 0)
    val log = container.database.syncLog().recent(10).stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    /** Permissions our code asks for that are missing from the manifest would silently fail: surface them. */
    val undeclaredPermissions: List<String> by lazy {
        val declared = runCatching { app.packageManager.getPackageInfo(app.packageName, PackageManager.GET_PERMISSIONS).requestedPermissions?.toSet() }.getOrNull() ?: emptySet()
        hc.requestablePermissions().filter { it !in declared }
    }

    fun load() {
        viewModelScope.launch {
            error.value = null
            try { sources.value = container.dashboard.sources() } catch (e: Exception) { error.value = e.message }
            granted.value = runCatching { if (hc.availability() == SdkAvailability.AVAILABLE) hc.grantedPermissions() else emptySet() }.getOrDefault(emptySet())
        }
    }

    fun refreshPermissions(result: Set<String>) { granted.value = result }

    fun syncNow() {
        viewModelScope.launch {
            syncing.value = true
            runCatching { container.syncer.sync(SyncTrigger.MANUAL) }
            syncing.value = false
            load()
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SourcesScreen(vm: SourcesViewModel = viewModel()) {
    val context = LocalContext.current
    val sources by vm.sources.collectAsState()
    val error by vm.error.collectAsState()
    val granted by vm.granted.collectAsState()
    val syncing by vm.syncing.collectAsState()
    val syncStates by vm.syncStates.collectAsState()
    val pending by vm.pending.collectAsState()
    val log by vm.log.collectAsState()
    val launcher = rememberLauncherForActivityResult(vm.hc.permissionContract()) { vm.refreshPermissions(it) }
    LaunchedEffect(Unit) { vm.load() }
    var showStates by remember { mutableStateOf(false) }

    Scaffold(topBar = { TopAppBar(title = { Text("Data Sources") }, actions = { IconButton(onClick = { vm.load() }) { Icon(Icons.Filled.Refresh, contentDescription = "Reload") } }) }) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                SectionCard("Health Connect on this phone") {
                    val availability = vm.hc.availability()
                    KeyValue("Availability", availability.name.lowercase().replace('_', ' '))
                    KeyValue("Read permissions granted", "${granted.count { it in vm.hc.readPermissions.values }} of ${vm.hc.readPermissions.size}")
                    KeyValue("Background reads", if (!vm.hc.isBackgroundReadSupported()) "not supported" else if (vm.hc.backgroundPermission in granted) "granted" else "not granted (sync runs when the app is open)")
                    KeyValue("History beyond 30 days", if (!vm.hc.isHistoryReadSupported()) "not supported" else if (vm.hc.historyPermission in granted) "granted" else "not granted")
                    KeyValue("Pending offline uploads", pending.toString())
                    if (vm.undeclaredPermissions.isNotEmpty()) Text("Manifest is missing: ${vm.undeclaredPermissions.joinToString()}", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    val missing = vm.hc.readPermissions.filterValues { it !in granted }.keys
                    if (missing.isNotEmpty()) Text("Not granted: ${missing.joinToString()} — these metrics stay NOT CONNECTED (never assumed empty).", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(enabled = !syncing, onClick = { vm.syncNow() }) { Text(if (syncing) "Syncing…" else "Sync now") }
                        OutlinedButton(onClick = { launcher.launch(vm.hc.requestablePermissions()) }) { Text("Permissions") }
                        OutlinedButton(onClick = { runCatching { context.startActivity(vm.hc.settingsIntent()) } }) { Text("HC settings") }
                    }
                    Spacer(Modifier.height(8.dp))
                    OutlinedButton(onClick = { showStates = !showStates }) { Text(if (showStates) "Hide sync state" else "Show per-type sync state") }
                    if (showStates) syncStates.forEach { st -> SyncStateRow(st) }
                }
            }
            error?.let { e -> item { Text("Backend status unavailable: $e", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) } }
            sources?.let { cached ->
                if (cached.fromCache) item { Text("Showing cached source status from ${relativeTime(cached.fetchedAt)}.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                items(cached.value.sources, key = { it.connectorId }) { s ->
                    SectionCard {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(s.displayName, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                            StatusChip(s.connectionStatus)
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(vertical = 4.dp)) {
                            StatusChip(s.integrationClass)
                            StatusChip(s.implementationStatus)
                        }
                        KeyValue("Latest observation", s.latestObservationAt?.let { relativeTime(it) } ?: "—")
                        KeyValue("Last successful sync", s.lastSuccessfulSyncAt?.let { relativeTime(it) } ?: "never")
                        KeyValue("Expected cadence", "every ${s.expectedSyncIntervalHours.toInt()} h")
                        KeyValue("Measured → ingested", s.actualLatencyHours?.let { String.format(java.util.Locale.US, "%.1f h", it) } ?: "—")
                        KeyValue("Observations / coverage", "${s.observationCount} · ${s.coverageDays30}/30 days")
                        s.lastError?.let { Text("Last error: $it", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                        if (s.missingPermissions.isNotEmpty()) Text("Missing: ${s.missingPermissions.joinToString { it.removePrefix("android.permission.health.") }}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                        if (s.devices.isNotEmpty()) Text("Devices: ${s.devices.joinToString { it.label }}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        s.notes.forEach { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                }
            }
            if (log.isNotEmpty()) item {
                SectionCard("Recent sync attempts (this phone)") { log.forEach { SyncLogRow(it) } }
            }
        }
    }
}

@Composable
private fun SyncStateRow(st: SyncStateEntity) {
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(st.recordType, style = MaterialTheme.typography.bodySmall)
            Text("${if (st.backfillDone) "backfilled" else "not backfilled"} · token ${if (st.changesToken != null) "ok" else "none"} · ${st.lastSyncAt?.let { relativeTime(it) } ?: "never"}${st.lastError?.let { " · $it" } ?: ""}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        StatusChip(st.lastStatus)
    }
}

@Composable
private fun SyncLogRow(e: SyncLogEntity) {
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        Text("${relativeTime(e.at)} · ${e.trigger.lowercase()} · ${e.recordsRead} read, ${e.uploaded} stored${e.error?.let { " · $it" } ?: ""}", style = MaterialTheme.typography.labelSmall, modifier = Modifier.weight(1f))
        StatusChip(e.status)
    }
}
