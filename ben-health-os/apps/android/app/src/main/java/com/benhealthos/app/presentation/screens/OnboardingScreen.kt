package com.benhealthos.app.presentation.screens

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.benhealthos.app.data.sync.SyncOutcome
import com.benhealthos.app.data.sync.SyncTrigger
import com.benhealthos.app.di.appContainer
import com.benhealthos.app.integrations.healthconnect.SdkAvailability
import com.benhealthos.app.presentation.components.SectionCard
import kotlinx.coroutines.launch

@Composable
fun OnboardingScreen(onDone: () -> Unit) {
    val context = LocalContext.current
    val container = context.appContainer
    val scope = rememberCoroutineScope()
    var step by remember { mutableStateOf(if (container.secureStore.hasSession) 1 else 0) }
    var apiUrl by remember { mutableStateOf(container.settings.apiBaseUrlBlocking()) }
    var email by remember { mutableStateOf(container.secureStore.email ?: "ben@example.com") }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var availability by remember { mutableStateOf(container.healthConnect.availability()) }
    var granted by remember { mutableStateOf<Set<String>>(emptySet()) }
    var outcome by remember { mutableStateOf<SyncOutcome?>(null) }
    val hc = container.healthConnect

    val permissionLauncher = rememberLauncherForActivityResult(hc.permissionContract()) { result ->
        granted = result
        message = if (result.isEmpty()) "No permissions granted. You can continue, but no Health Connect data will be read." else "${result.size} of ${hc.requestablePermissions().size} permissions granted."
    }

    Scaffold { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(20.dp).verticalScroll(rememberScrollState())) {
            Text("BEN HEALTH OS", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(8.dp))
            when (step) {
                0 -> {
                    Text("Sign in", style = MaterialTheme.typography.headlineSmall)
                    Text("Local development sign-in. Hosted Supabase sign-in arrives with the production deployment.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(16.dp))
                    OutlinedTextField(apiUrl, { apiUrl = it }, label = { Text("API base URL") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(email, { email = it }, label = { Text("Email") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    Spacer(Modifier.height(16.dp))
                    Button(enabled = !busy, onClick = {
                        busy = true; message = null
                        scope.launch {
                            try {
                                container.settings.setApiBaseUrl(apiUrl)
                                val login = container.api.devLogin(email.trim())
                                container.secureStore.setSession(login.accessToken, login.userId, email.trim())
                                container.api.me()
                                step = 1
                            } catch (e: Exception) {
                                message = "Sign-in failed: ${e.message}"
                            } finally { busy = false }
                        }
                    }, modifier = Modifier.fillMaxWidth()) { Text(if (busy) "Signing in…" else "Continue") }
                }
                1 -> {
                    Text("Health Connect", style = MaterialTheme.typography.headlineSmall)
                    Spacer(Modifier.height(8.dp))
                    SectionCard("Status") {
                        Text(
                            when (availability) {
                                SdkAvailability.AVAILABLE -> "Health Connect is available on this device."
                                SdkAvailability.PROVIDER_UPDATE_REQUIRED -> "Health Connect needs to be installed or updated."
                                SdkAvailability.UNAVAILABLE -> "Health Connect is not available on this device (Android version too old)."
                            },
                        )
                        if (availability == SdkAvailability.PROVIDER_UPDATE_REQUIRED) {
                            Spacer(Modifier.height(8.dp))
                            OutlinedButton(onClick = { runCatching { context.startActivity(hc.installIntent()) } }) { Text("Install / update Health Connect") }
                            TextButton(onClick = { availability = hc.availability() }) { Text("Re-check") }
                        }
                    }
                    Spacer(Modifier.height(12.dp))
                    SectionCard("Permissions") {
                        Text("Ben Health OS asks to READ ${hc.readPermissions.size} record types (steps, sleep, heart, body, nutrition, glucose, vitals). Background reads: ${if (hc.isBackgroundReadSupported()) "supported" else "not supported on this device"}. History beyond 30 days: ${if (hc.isHistoryReadSupported()) "supported" else "not supported"}.", style = MaterialTheme.typography.bodySmall)
                        Spacer(Modifier.height(8.dp))
                        Button(enabled = availability == SdkAvailability.AVAILABLE, onClick = { permissionLauncher.launch(hc.requestablePermissions()) }, modifier = Modifier.fillMaxWidth()) { Text("Grant Health Connect access") }
                        Text("You can grant a subset; metrics without permission are shown as not connected, never assumed empty.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Spacer(Modifier.height(16.dp))
                    Button(onClick = { step = 2 }, modifier = Modifier.fillMaxWidth()) { Text("Continue") }
                }
                else -> {
                    Text("First synchronization", style = MaterialTheme.typography.headlineSmall)
                    Text("Reads the last 30 days (or up to a year with the history permission) in 7-day windows and uploads them with their source, device and timestamps intact.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(16.dp))
                    Button(enabled = !busy, onClick = {
                        busy = true
                        scope.launch {
                            outcome = try { container.syncer.sync(SyncTrigger.ONBOARDING) } catch (e: Exception) { SyncOutcome("ERROR", 0, 0, 0, 0, emptyMap(), e.message) }
                            busy = false
                        }
                    }, modifier = Modifier.fillMaxWidth()) { Text(if (busy) "Syncing…" else "Sync now") }
                    outcome?.let { o ->
                        Spacer(Modifier.height(12.dp))
                        SectionCard("Result: ${o.status}") {
                            Text("${o.recordsRead} records read, ${o.uploaded} stored, ${o.deletions} deletions, ${o.queuedOffline} batches queued offline.")
                            o.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                            o.perType.forEach { (t, s) -> Text("$t: $s", style = MaterialTheme.typography.bodySmall) }
                        }
                    }
                    Spacer(Modifier.height(16.dp))
                    OutlinedButton(onClick = onDone, modifier = Modifier.fillMaxWidth()) { Text(if (outcome == null) "Skip for now" else "Finish") }
                }
            }
            message?.let { Spacer(Modifier.height(12.dp)); Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
}
