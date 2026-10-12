package com.benhealthos.app.presentation.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.benhealthos.app.presentation.theme.Tone
import java.time.Duration
import java.time.Instant

fun toneFor(status: String): Color = when (status) {
    "CURRENT", "CONNECTED", "STEADY", "IMPROVING", "SUCCESS" -> Tone.good
    "RECENT", "SOURCE_DELAYED", "WATCH", "PARTIAL", "PENDING_AUTH" -> Tone.watch
    "STALE", "SYNC_ERROR", "ATTENTION", "ERROR", "EXPIRED", "REVOKED" -> Tone.attention
    else -> Tone.neutral
}

@Composable
fun StatusChip(status: String, modifier: Modifier = Modifier) {
    val tone = toneFor(status)
    Box(modifier.background(tone.copy(alpha = 0.15f), RoundedCornerShape(999.dp)).padding(horizontal = 8.dp, vertical = 2.dp)) {
        Text(status.replace('_', ' ').lowercase(), color = tone, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Medium)
    }
}

@Composable
fun SectionCard(title: String? = null, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Card(modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), elevation = CardDefaults.cardElevation(0.dp)) {
        Column(Modifier.padding(16.dp)) {
            if (title != null) {
                Text(title.uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, letterSpacing = androidx.compose.ui.unit.TextUnit(1.5f, androidx.compose.ui.unit.TextUnitType.Sp))
                androidx.compose.foundation.layout.Spacer(Modifier.padding(4.dp))
            }
            content()
        }
    }
}

@Composable
fun KeyValue(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
        Text(value, style = MaterialTheme.typography.bodySmall)
    }
}

fun relativeTime(iso: String?, now: Instant = Instant.now()): String {
    if (iso == null) return "never"
    val t = runCatching { Instant.parse(iso) }.getOrNull() ?: return iso
    val d = Duration.between(t, now)
    return when {
        d.toMinutes() < 60 -> "${maxOf(1, d.toMinutes())} min ago"
        d.toHours() < 48 -> "${d.toHours()} h ago"
        else -> "${d.toDays()} days ago"
    }
}

fun formatValue(value: Double?, unit: String, precision: Int): String {
    if (value == null) return "—"
    val s = String.format(java.util.Locale.US, "%.${precision}f", value)
    return if (unit == "%") "$s%" else if (unit.isBlank() || unit == "score") s else "$s $unit"
}
