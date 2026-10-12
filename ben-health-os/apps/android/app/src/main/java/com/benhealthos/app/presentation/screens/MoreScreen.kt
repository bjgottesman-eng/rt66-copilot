package com.benhealthos.app.presentation.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.benhealthos.app.presentation.components.SectionCard
import com.benhealthos.app.presentation.components.StatusChip

private val PLANNED = listOf(Triple("Health CEO", 6, "Weekly Health CEO and monthly Health Board reports."), Triple("Labs", 5, "Lab explorer, Function Health imports, clinical records."), Triple("Training", 7, "Strength module, progression, Zone 2 minutes."), Triple("Experiments", 7, "N-of-1 experiment engine."), Triple("Medications", 5, "Medication reconciliation and supplement ledger."))

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MoreScreen(onNavigate: (String) -> Unit) {
    Scaffold(topBar = { TopAppBar(title = { Text("More") }) }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(16.dp)) {
            Text("Settings", style = MaterialTheme.typography.titleMedium, modifier = Modifier.fillMaxWidth().clickable { onNavigate("settings") }.padding(vertical = 12.dp))
            HorizontalDivider()
            Column(Modifier.fillMaxWidth().clickable { onNavigate("nutrition") }.padding(vertical = 12.dp)) {
                Text("Nutrition & glucose", style = MaterialTheme.typography.titleMedium)
                Text("Cronometer day totals vs your targets, Stelo glucose day: time in range, overnight, meal excursions.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            HorizontalDivider()
            PLANNED.forEach { (name, phase, desc) ->
                Column(Modifier.fillMaxWidth().clickable { onNavigate("placeholder/$name/$phase") }.padding(vertical = 12.dp)) {
                    Text(name, style = MaterialTheme.typography.titleMedium)
                    Text("$desc Planned for phase $phase.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                HorizontalDivider()
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotImplementedScreen(name: String, phase: Int) {
    Scaffold(topBar = { TopAppBar(title = { Text(name) }) }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(16.dp)) {
            SectionCard {
                StatusChip("NOT_IMPLEMENTED")
                Text("$name is planned for phase $phase. Nothing on this screen is simulated; it appears once the feature is built and tested.", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp))
            }
        }
    }
}
