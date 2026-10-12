package com.benhealthos.app.data.sync

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.benhealthos.app.di.appContainer
import java.util.concurrent.TimeUnit

/**
 * Background synchronization. Android decides when periodic work actually runs (Doze, App Standby
 * buckets, battery saver); the app never assumes unlimited background execution. Reads outside the
 * foreground additionally require READ_HEALTH_DATA_IN_BACKGROUND; without it this worker fails fast
 * and the next foreground launch syncs instead.
 */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val container = applicationContext.appContainer
        if (!container.secureStore.hasSession) return Result.success()
        val trigger = if (inputData.getString(KEY_TRIGGER) == "manual") SyncTrigger.MANUAL else SyncTrigger.PERIODIC
        val outcome = container.syncer.sync(trigger)
        return when (outcome.status) {
            "SUCCESS", "PARTIAL" -> Result.success()
            else -> if (runAttemptCount < 3) Result.retry() else Result.failure()
        }
    }

    companion object {
        const val KEY_TRIGGER = "trigger"
    }
}

object SyncScheduler {
    private const val PERIODIC = "bho-hc-periodic-sync"
    private const val ONE_TIME = "bho-hc-sync-now"

    fun ensurePeriodic(context: Context) {
        val request = PeriodicWorkRequestBuilder<SyncWorker>(4, TimeUnit.HOURS)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    fun syncNow(context: Context) {
        val request = OneTimeWorkRequestBuilder<SyncWorker>()
            .setInputData(androidx.work.workDataOf(SyncWorker.KEY_TRIGGER to "manual"))
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(ONE_TIME, ExistingWorkPolicy.KEEP, request)
    }
}
