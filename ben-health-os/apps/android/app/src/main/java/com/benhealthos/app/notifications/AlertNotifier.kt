package com.benhealthos.app.notifications

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.benhealthos.app.MainActivity
import com.benhealthos.app.data.remote.AlertDto
import com.benhealthos.app.data.remote.ApiClient
import com.benhealthos.app.data.remote.NotificationPrefsDto
import java.time.LocalTime

/**
 * Pure decision logic for server alerts (unit-tested): the user's preferences decide whether an alert
 * is shown now, held for later (quiet hours) or marked delivered silently (kind or push disabled).
 */
object AlertPolicy {
    enum class Decision { SHOW, HOLD, SILENT }

    fun decide(prefs: NotificationPrefsDto, kind: String, now: LocalTime): Decision {
        if (!prefs.pushEnabled || kind !in prefs.enabledKinds) return Decision.SILENT
        return if (inQuietHours(prefs.quietHoursStart, prefs.quietHoursEnd, now)) Decision.HOLD else Decision.SHOW
    }

    /** Quiet hours may cross midnight (22:00 → 07:00). Equal or missing bounds mean no quiet hours. */
    fun inQuietHours(start: String?, end: String?, now: LocalTime): Boolean {
        val s = parse(start) ?: return false
        val e = parse(end) ?: return false
        if (s == e) return false
        return if (s < e) !now.isBefore(s) && now.isBefore(e) else !now.isBefore(s) || now.isBefore(e)
    }

    private fun parse(v: String?): LocalTime? = v?.let { runCatching { LocalTime.parse(it) }.getOrNull() }
}

/**
 * Pulls unread server alerts after each sync and posts them as lock-screen-private notifications.
 * Titles and bodies come from the server, which never puts measurement values in them; the public
 * (lock-screen) version shows only the app name.
 */
class AlertNotifier(private val context: Context, private val api: ApiClient) {
    suspend fun poll(now: LocalTime = LocalTime.now()): Int {
        val prefs = runCatching { api.notificationPrefs() }.getOrElse { NotificationPrefsDto() }
        val alerts = runCatching { api.alerts(unreadOnly = true, refresh = true) }.getOrNull() ?: return 0
        var shown = 0
        for (a in alerts.alerts.filter { it.deliveredAt == null }) {
            when (AlertPolicy.decide(prefs, a.kind, now)) {
                AlertPolicy.Decision.SHOW -> { if (show(a)) { shown++; runCatching { api.alertAction(a.id, "delivered") } } }
                AlertPolicy.Decision.SILENT -> runCatching { api.alertAction(a.id, "delivered") }
                AlertPolicy.Decision.HOLD -> Unit // retried on the next sync, after quiet hours
            }
        }
        return shown
    }

    private fun show(a: AlertDto): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return false
        ensureChannel(context)
        val intent = PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_notify_more)
            .setContentTitle(a.title)
            .setContentText(a.body ?: "Open the app for details.")
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(NotificationCompat.Builder(context, CHANNEL).setSmallIcon(android.R.drawable.stat_notify_more).setContentTitle("Ben Health OS").setContentText("Open the app for details.").build())
            .setContentIntent(intent)
            .setAutoCancel(true)
            .build()
        NotificationManagerCompat.from(context).notify(a.id.hashCode(), n)
        return true
    }

    companion object {
        const val CHANNEL = "bho_alerts"
        fun ensureChannel(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            context.getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(CHANNEL, "Reports and follow-ups", NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = "Weekly report ready, lab imports, due follow-ups, medication reviews. Never includes measurements."
                    lockscreenVisibility = android.app.Notification.VISIBILITY_PRIVATE
                },
            )
        }
    }
}
