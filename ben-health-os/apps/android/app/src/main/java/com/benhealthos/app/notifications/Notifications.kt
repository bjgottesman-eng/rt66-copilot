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

object NotificationChannels {
    const val SYNC = "bho_sync"

    fun ensure(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(SYNC, "Data source status", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Connection problems and permission changes. Never includes measurements."
                lockscreenVisibility = android.app.Notification.VISIBILITY_PRIVATE
            },
        )
        AlertNotifier.ensureChannel(context)
    }
}

/** High-signal notifications only. Titles and bodies never contain health values. */
object SyncNotifier {
    private const val ID_PERMISSIONS = 1001
    private const val ID_SYNC_FAILED = 1002

    fun permissionsRevoked(context: Context) = notify(context, ID_PERMISSIONS, "Health Connect permissions needed", "Ben Health OS can no longer read Health Connect. Open the app to re-grant access.")

    fun syncFailed(context: Context, reason: String) = notify(context, ID_SYNC_FAILED, "Health Connect sync failed", "Open Data Sources for details.")

    private fun notify(context: Context, id: Int, title: String, body: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        val intent = PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = NotificationCompat.Builder(context, NotificationChannels.SYNC)
            .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
            .setContentTitle(title)
            .setContentText(body)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(NotificationCompat.Builder(context, NotificationChannels.SYNC).setSmallIcon(android.R.drawable.stat_notify_sync_noanim).setContentTitle("Ben Health OS").setContentText("Open the app for details.").build())
            .setContentIntent(intent)
            .setAutoCancel(true)
            .build()
        NotificationManagerCompat.from(context).notify(id, n)
    }
}
