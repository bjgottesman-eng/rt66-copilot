package com.benhealthos.app.data.local

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/** Compact local cache of single-value Health Connect readings for offline display. */
@Entity(tableName = "cached_observations", indices = [Index(value = ["metricId", "measuredAt"])])
data class CachedObservationEntity(
    @PrimaryKey val key: String,
    val hcId: String,
    val recordType: String,
    val metricId: String,
    val value: Double,
    val unit: String,
    val measuredAt: String,
    val localDate: String,
    val dataOrigin: String,
    val cachedAt: String,
)

/** Per record type sync bookkeeping: change token, backfill progress, last outcome. */
@Entity(tableName = "sync_state")
data class SyncStateEntity(
    @PrimaryKey val recordType: String,
    val changesToken: String? = null,
    val backfillDone: Boolean = false,
    val backfillFrom: String? = null,
    val lastSyncAt: String? = null,
    val lastStatus: String = "NEVER",
    val lastError: String? = null,
    val lastRecordsRead: Int = 0,
)

/** Request bodies that could not reach the backend (offline). Replayed on the next sync; the server is idempotent. */
@Entity(tableName = "pending_uploads")
data class PendingUploadEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val createdAt: String,
    val endpoint: String,
    val bodyJson: String,
    val attempts: Int = 0,
    val lastError: String? = null,
)

/** Last successful JSON responses for offline viewing (dashboard, sources). */
@Entity(tableName = "remote_cache")
data class RemoteCacheEntity(
    @PrimaryKey val key: String,
    val json: String,
    val fetchedAt: String,
)

@Entity(tableName = "sync_log")
data class SyncLogEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val at: String,
    val trigger: String,
    val status: String,
    val recordsRead: Int,
    val uploaded: Int,
    val deletions: Int,
    val error: String?,
)
