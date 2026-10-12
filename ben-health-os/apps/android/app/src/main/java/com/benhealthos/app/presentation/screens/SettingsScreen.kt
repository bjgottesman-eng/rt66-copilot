package com.benhealthos.app.presentation.screens

import android.content.Intent
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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import com.benhealthos.app.BuildConfig
import com.benhealthos.app.PermissionsRationaleActivity
import com.benhealthos.app.di.appContainer
import com.benhealthos.app.presentation.components.SectionCard
import com.benhealthos.app.presentation.components.StatusChip
import com.benhealthos.app.security.BiometricGate
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(onSignOut: () -> Unit) {
    val context = LocalContext.current
    val container = context.appContainer
    val scope = rememberCoroutineScope()
    val biometric by container.settings.biometricLock.collectAsState(initial = true)
    var apiUrl by remember { mutableStateOf(container.settings.apiBaseUrlBlocking()) }
    var message by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }

    Scaffold(topBar = { TopAppBar(title = { Text("Settings") }) }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            SectionCard("Account") {
                Text(container.secureStore.email ?: "signed in", style = MaterialTheme.typography.bodyMedium)
                OutlinedTextField(apiUrl, { apiUrl = it }, label = { Text("API base URL") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { scope.launch { container.settings.setApiBaseUrl(apiUrl); message = "API URL saved." } }) { Text("Save URL") }
                    TextButton(onClick = onSignOut) { Text("Sign out") }
                }
            }
            SectionCard("Security") {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Biometric / device-credential lock", style = MaterialTheme.typography.bodyMedium)
                        Text(if (BiometricGate.canAuthenticate(context)) "Locks after 60 s in the background." else "No biometric or device credential enrolled; lock unavailable.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Switch(checked = biometric, enabled = BiometricGate.canAuthenticate(context), onCheckedChange = { v -> scope.launch { container.settings.setBiometricLock(v) } })
                }
                Text("Session token encrypted with an Android Keystore key; local database excluded from backups; no analytics or advertising SDKs.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                TextButton(onClick = { context.startActivity(Intent(context, PermissionsRationaleActivity::class.java)) }) { Text("Privacy policy") }
            }
            SectionCard("Your data") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(enabled = !busy, onClick = {
                        busy = true
                        scope.launch {
                            try {
                                val file = withContext(Dispatchers.IO) {
                                    val dir = File(context.cacheDir, "exports").apply { mkdirs() }
                                    val f = File(dir, "ben-health-os-export.json")
                                    val url = container.api.exportUrl()
                                    val req = okhttp3.Request.Builder().url(url).header("authorization", "Bearer ${container.secureStore.token}").build()
                                    okhttp3.OkHttpClient().newCall(req).execute().use { res ->
                                        if (!res.isSuccessful) throw IllegalStateException("export failed: ${res.code}")
                                        f.writeBytes(res.body!!.bytes())
                                    }
                                    f
                                }
                                val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
                                context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply { type = "application/json"; putExtra(Intent.EXTRA_STREAM, uri); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION) }, "Export health data"))
                            } catch (e: Exception) { message = "Export failed: ${e.message}" } finally { busy = false }
                        }
                    }) { Text("Export all (JSON)") }
                    OutlinedButton(enabled = !busy, onClick = { confirmDelete = true }) { Text("Delete all") }
                }
            }
            SectionCard("Demo mode") {
                Text("Loads 120 days of synthetic data on the backend. Refused while real data exists.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(enabled = !busy, onClick = { busy = true; scope.launch { message = runCatching { container.api.seedDemo(120); "Demo data loaded." }.getOrElse { "Demo seed failed: ${it.message}" }; busy = false } }) { Text("Load demo data") }
                    OutlinedButton(enabled = !busy, onClick = { busy = true; scope.launch { message = runCatching { container.api.clearDemo(); "Demo data cleared." }.getOrElse { "Clear failed: ${it.message}" }; busy = false } }) { Text("Clear demo") }
                }
            }
            SectionCard("Implementation status") {
                container.sharedConfig.connectors.forEach { c ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("${c.displayName} · phase ${c.phase}", style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                        StatusChip(c.implementationStatus)
                    }
                }
                Spacer(Modifier.height(4.dp))
                Text("App ${BuildConfig.VERSION_NAME} · shared config v${container.sharedConfig.version}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            message?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Delete all health data?") },
            text = { Text("Removes every raw and normalized record, connection, derived metric and cached copy on this phone. This cannot be undone.") },
            confirmButton = { Button(onClick = { confirmDelete = false; busy = true; scope.launch { message = runCatching { container.api.deleteAllData(); container.syncer.resetLocalState(); "All data deleted." }.getOrElse { "Delete failed: ${it.message}" }; busy = false } }) { Text("Delete") } },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel") } },
        )
    }
}
