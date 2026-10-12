package com.benhealthos.app.presentation.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

private val Light = lightColorScheme(
    primary = Color(0xFF2F5D50),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE2EFE9),
    onPrimaryContainer = Color(0xFF16181D),
    secondary = Color(0xFF4B5563),
    background = Color(0xFFF7F7F5),
    surface = Color(0xFFFFFFFF),
    surfaceVariant = Color(0xFFF1F1EE),
    onSurface = Color(0xFF16181D),
    onSurfaceVariant = Color(0xFF6B7280),
    outline = Color(0xFFE4E4DF),
    error = Color(0xFFB23A3A),
)

private val Dark = darkColorScheme(
    primary = Color(0xFF8CC7B2),
    onPrimary = Color(0xFF0F1114),
    primaryContainer = Color(0xFF1D3A32),
    onPrimaryContainer = Color(0xFFEBEDF0),
    secondary = Color(0xFFB1B8C2),
    background = Color(0xFF0F1114),
    surface = Color(0xFF171A1F),
    surfaceVariant = Color(0xFF1F2329),
    onSurface = Color(0xFFEBEDF0),
    onSurfaceVariant = Color(0xFF9AA3AD),
    outline = Color(0xFF2A2F37),
    error = Color(0xFFE07A7A),
)

/** Status tones shared with the web dashboard. */
object Tone {
    val good = Color(0xFF2E7D5B)
    val watch = Color(0xFFB7791F)
    val attention = Color(0xFFB23A3A)
    val neutral = Color(0xFF6B7280)
}

@Composable
fun BenHealthOsTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val context = LocalContext.current
    val scheme = when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        dark -> Dark
        else -> Light
    }
    MaterialTheme(colorScheme = scheme, content = content)
}
