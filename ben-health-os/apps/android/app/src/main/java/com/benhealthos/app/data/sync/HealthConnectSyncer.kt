package com.benhealthos.app.data.sync

import android.content.Context
import android.os.Build
import androidx.health.connect.client.changes.DeletionChange
import androidx.health.connect.client.changes.UpsertionChange
import androidx.health.connect.client.records.Record
import com.benhealthos.app.BuildConfig
import com.benhealthos.app.data.local.AppDatabase
import com.benhealthos.app.data.local.CachedObservationEntity
import com.benhealthos.app.data.local.PendingUploadEntity
import com.benhealthos.app.data.local.SettingsStore
import com.benhealthos.app.data.local.SyncLogEntity
import com.benhealthos.app.data.local.SyncStateEntity
import com.benhealthos.app.data.remote.ApiClient
import com.benhealthos.app.data.remote.ApiException
import com.benhealthos.app.data.remote.HcDeletionDto
import com.benhealthos.app.data.remote.HcRecordDto
import com.benhealthos.app.data.remote.IngestBatchDto
import com.benhealthos.app.data.remote.IngestResultDto
import com.benhealthos.app.data.remote.PermissionStateDto
import com.benhealthos.app.data.remote.SyncReportDto
import com.benhealthos.app.integrations.healthconnect.HealthConnectManager
import com.benhealthos.app.integrations.healthconnect.HealthConnectMapper
import com.benhealthos.app.integrations.healthconnect.HealthConnectRecordTypes
import com.benhealthos.app.integrations.healthconnect.SdkAvailability
import com.benhealthos.app.notifications.SyncNotifier
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive
import java.io.IOException
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import kotlin.reflect.KClass

enum class SyncTrigger { ONBOARDING, MANUAL, PERIODIC, APP_OPEN }

data class SyncOutcome(
    val status: String,
    val recordsRead: Int,
    val uploaded: Int,
    val deletions: Int,
    val queuedOffline: Int,
    val perType: Map<String, String>,
    val error: String? = null,
)

/**
 * Orchestrates Health Connect → backend synchronization:
 *  1. availability + granted permissions (never assumes a denied permission means no data)
 *  2. per record type: initial backfill (30 days, or up to a year with the history permission) in
 *     7-day windows, then a changes token; afterwards incremental getChanges loops, with
 *     expiry handling (token > 30 days old → re-backfill the last 30 days and mint a new token)
 *  3. upload in batches; when offline the batch is queued locally and replayed later (idempotent server)
 *  4. a sync report is always sent so the Data Sources screen can explain failures
 */
class HealthConnectSyncer(
    private val context: Context,
    private val hc: HealthConnectManager,
    private val api: ApiClient,
    private val db: AppDatabase,
    private val settings: SettingsStore,
    private val json: Json,
) {
    private val appVersion = BuildConfig.VERSION_NAME
    private val deviceLabel = "${Build.MANUFACTURER} ${Build.MODEL}".trim()

    suspend fun sync(trigger: SyncTrigger): SyncOutcome {
        val startedAt = Instant.now()
        val deviceInstanceId = settings.deviceInstanceId()
        val availability = hc.availability()
        val sdkStatus = when (availability) {
            SdkAvailability.AVAILABLE -> "SDK_AVAILABLE"
            SdkAvailability.UNAVAILABLE -> "SDK_UNAVAILABLE"
            SdkAvailability.PROVIDER_UPDATE_REQUIRED -> "SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED"
        }
        if (availability != SdkAvailability.AVAILABLE) {
            val outcome = SyncOutcome("ERROR", 0, 0, 0, 0, emptyMap(), "Health Connect is $sdkStatus")
            report(deviceInstanceId, startedAt, outcome, sdkStatus, emptySet())
            log(trigger, outcome)
            return outcome
        }

        val granted = runCatching { hc.grantedPermissions() }.getOrElse { emptySet() }
        val requested = hc.requestablePermissions()
        val readableTypes = hc.readPermissions.filter { (_, perm) -> perm in granted }.keys
        if (readableTypes.isEmpty()) {
            val outcome = SyncOutcome("ERROR", 0, 0, 0, 0, emptyMap(), "No Health Connect read permissions granted")
            SyncNotifier.permissionsRevoked(context)
            report(deviceInstanceId, startedAt, outcome, sdkStatus, granted)
            log(trigger, outcome)
            return outcome
        }

        var recordsRead = 0
        var uploaded = 0
        var deletions = 0
        var queued = 0
        val perType = LinkedHashMap<String, String>()
        var firstError: String? = null
        val historyGranted = hc.historyPermission in granted

        queued += flushPendingUploads()

        for (typeName in readableTypes) {
            val type = HealthConnectRecordTypes.ALL.getValue(typeName)
            val state = db.syncState().get(typeName) ?: SyncStateEntity(recordType = typeName)
            try {
                val result = if (state.changesToken == null || !state.backfillDone) {
                    backfill(typeName, type, state, historyGranted, deviceInstanceId, granted, requested)
                } else {
                    incremental(typeName, type, state, deviceInstanceId, granted, requested)
                }
                recordsRead += result.read
                uploaded += result.uploaded
                deletions += result.deleted
                queued += result.queued
                perType[typeName] = result.summary
            } catch (e: SecurityException) {
                perType[typeName] = "permission revoked"
                firstError = firstError ?: "permission revoked for $typeName"
                db.syncState().upsert(state.copy(lastSyncAt = now(), lastStatus = "ERROR", lastError = "permission revoked"))
            } catch (e: IllegalStateException) {
                // Health Connect signals its rate limit with IllegalStateException; back off and retry later.
                perType[typeName] = "rate limited"
                firstError = firstError ?: "Health Connect rate limit reached; retry later"
                db.syncState().upsert(state.copy(lastSyncAt = now(), lastStatus = "ERROR", lastError = "rate limited"))
                break
            } catch (e: Exception) {
                perType[typeName] = "error: ${e.message?.take(80)}"
                firstError = firstError ?: (e.message ?: e.javaClass.simpleName)
                db.syncState().upsert(state.copy(lastSyncAt = now(), lastStatus = "ERROR", lastError = e.message?.take(300)))
            }
        }

        val status = when {
            firstError != null && uploaded == 0 && queued == 0 -> "ERROR"
            firstError != null || queued > 0 -> "PARTIAL"
            else -> "SUCCESS"
        }
        val outcome = SyncOutcome(status, recordsRead, uploaded, deletions, queued, perType, firstError)
        report(deviceInstanceId, startedAt, outcome, sdkStatus, granted)
        log(trigger, outcome)
        if (status == "ERROR") SyncNotifier.syncFailed(context, firstError ?: "unknown error")
        return outcome
    }

    private data class TypeResult(val read: Int, val uploaded: Int, val deleted: Int, val queued: Int, val summary: String)

    private suspend fun backfill(typeName: String, type: KClass<out Record>, state: SyncStateEntity, historyGranted: Boolean, deviceInstanceId: String, granted: Set<String>, requested: Set<String>): TypeResult {
        val now = Instant.now()
        val start = state.backfillFrom?.let { Instant.parse(it) } ?: BackfillPlanner.backfillStart(now, historyGranted)
        // Mint the token BEFORE reading so nothing written during the backfill is missed.
        val token = hc.changesToken(type)
        var read = 0
        var uploaded = 0
        var queued = 0
        for (window in BackfillPlanner.windows(start, now)) {
            val records = hc.readAll(type, window.start, window.end)
            read += records.size
            val dtos = records.mapNotNull(HealthConnectMapper::toDto)
            for (batch in BackfillPlanner.batches(dtos)) {
                val r = upload(IngestBatchDto(deviceInstanceId = deviceInstanceId, deviceLabel = deviceLabel, appVersion = appVersion, timeZone = ZoneId.systemDefault().id, clientTime = now(), mode = if (historyGranted) "HISTORY_BACKFILL" else "INITIAL_BACKFILL", permissions = permissionStates(granted, requested), records = batch))
                if (r == null) queued++ else uploaded += r.inserted + r.updated
                cache(batch)
            }
        }
        db.syncState().upsert(state.copy(changesToken = token, backfillDone = true, backfillFrom = start.toString(), lastSyncAt = now(), lastStatus = "SUCCESS", lastError = null, lastRecordsRead = read))
        return TypeResult(read, uploaded, 0, queued, "backfilled $read records since ${start.toString().take(10)}")
    }

    private suspend fun incremental(typeName: String, type: KClass<out Record>, state: SyncStateEntity, deviceInstanceId: String, granted: Set<String>, requested: Set<String>): TypeResult {
        var token = state.changesToken!!
        val upserts = ArrayList<HcRecordDto>()
        val deleted = ArrayList<HcDeletionDto>()
        var read = 0
        var expired = false
        do {
            val response = hc.changes(token)
            if (response.changesTokenExpired) {
                expired = true
                break
            }
            for (change in response.changes) {
                when (change) {
                    is UpsertionChange -> {
                        read++
                        HealthConnectMapper.toDto(change.record)?.let { upserts += it }
                    }
                    is DeletionChange -> deleted += HcDeletionDto(hcId = change.recordId, recordType = typeName)
                }
            }
            token = response.nextChangesToken
        } while (response.hasMore)

        if (expired) {
            // Token older than 30 days: re-read the last 30 days (server dedups by id + hash) and start over.
            val refreshed = backfill(typeName, type, state.copy(changesToken = null, backfillDone = false, backfillFrom = Instant.now().minusSeconds(30L * 86_400).toString()), historyGranted = false, deviceInstanceId, granted, requested)
            return refreshed.copy(summary = "token expired; " + refreshed.summary)
        }

        var uploaded = 0
        var queued = 0
        val batches = BackfillPlanner.batches(upserts)
        if (batches.isEmpty() && deleted.isEmpty()) {
            upload(IngestBatchDto(deviceInstanceId = deviceInstanceId, deviceLabel = deviceLabel, appVersion = appVersion, timeZone = ZoneId.systemDefault().id, clientTime = now(), mode = "CHANGES", changeTokens = mapOf(typeName to token), permissions = permissionStates(granted, requested), records = emptyList()))?.let { }
        }
        batches.forEachIndexed { i, batch ->
            val r = upload(IngestBatchDto(deviceInstanceId = deviceInstanceId, deviceLabel = deviceLabel, appVersion = appVersion, timeZone = ZoneId.systemDefault().id, clientTime = now(), mode = "CHANGES", changeTokens = mapOf(typeName to token), permissions = permissionStates(granted, requested), records = batch, deletions = if (i == batches.lastIndex) deleted else emptyList()))
            if (r == null) queued++ else uploaded += r.inserted + r.updated
            cache(batch)
        }
        if (batches.isEmpty() && deleted.isNotEmpty()) {
            val r = upload(IngestBatchDto(deviceInstanceId = deviceInstanceId, deviceLabel = deviceLabel, appVersion = appVersion, timeZone = ZoneId.systemDefault().id, clientTime = now(), mode = "CHANGES", changeTokens = mapOf(typeName to token), permissions = permissionStates(granted, requested), records = emptyList(), deletions = deleted))
            if (r == null) queued++
        }
        for (d in deleted) db.cachedObservations().deleteByHcId(d.hcId)
        db.syncState().upsert(state.copy(changesToken = token, lastSyncAt = now(), lastStatus = if (queued > 0) "PARTIAL" else "SUCCESS", lastError = null, lastRecordsRead = read))
        return TypeResult(read, uploaded, deleted.size, queued, "$read changed, ${deleted.size} deleted")
    }

    /** Returns null when the upload was queued for later (offline / server unreachable). */
    private suspend fun upload(batch: IngestBatchDto): IngestResultDto? {
        return try {
            api.ingest(batch)
        } catch (e: ApiException) {
            if (e.code in 400..499) throw e // our bug or auth problem: surface it, do not queue forever
            queue(batch, e.message)
            null
        } catch (e: IOException) {
            queue(batch, e.message)
            null
        }
    }

    private suspend fun queue(batch: IngestBatchDto, error: String?) {
        db.pendingUploads().insert(PendingUploadEntity(createdAt = now(), endpoint = "/v1/ingest/health-connect", bodyJson = json.encodeToString(IngestBatchDto.serializer(), batch), lastError = error?.take(200)))
    }

    /** Replays queued batches (oldest first). Returns the number still pending. */
    suspend fun flushPendingUploads(): Int {
        val pending = db.pendingUploads().oldest(50)
        for (p in pending) {
            try {
                when (p.endpoint) {
                    "/v1/ingest/health-connect" -> api.ingestRaw(p.bodyJson)
                    "/v1/measurements/blood-pressure" -> api.manualBloodPressureRaw(p.bodyJson)
                }
                db.pendingUploads().delete(p.id)
            } catch (e: ApiException) {
                if (e.code in 400..499) db.pendingUploads().delete(p.id) else { db.pendingUploads().markFailed(p.id, e.message); return pending.size }
            } catch (e: IOException) {
                db.pendingUploads().markFailed(p.id, e.message)
                return pending.size
            }
        }
        return 0
    }

    private suspend fun cache(batch: List<HcRecordDto>) {
        val entities = batch.mapNotNull { r ->
            val (metric, field, unit) = when (r.recordType) {
                "RestingHeartRate" -> Triple("resting_heart_rate", "bpm", "bpm")
                "HeartRateVariabilityRmssd" -> Triple("hrv_rmssd", "rmssdMs", "ms")
                "Weight" -> Triple("weight", "kg", "kg")
                "BodyFat" -> Triple("body_fat_pct", "percentage", "%")
                "BloodPressure" -> Triple("blood_pressure_systolic", "systolicMmHg", "mmHg")
                "BloodGlucose" -> Triple("blood_glucose", "mgPerDl", "mg/dL")
                "RespiratoryRate" -> Triple("respiratory_rate", "rate", "breaths/min")
                "OxygenSaturation" -> Triple("spo2", "percentage", "%")
                "Vo2Max" -> Triple("vo2_max", "mlPerKgPerMin", "mL/kg/min")
                else -> return@mapNotNull null
            }
            val value = r.payload[field]?.jsonPrimitive?.doubleOrNull ?: return@mapNotNull null
            val measuredAt = r.time ?: r.startTime ?: return@mapNotNull null
            val offset = r.zoneOffset ?: r.startZoneOffset
            val localDate = runCatching { Instant.parse(measuredAt).atOffset(offset?.let { ZoneOffset.of(it) } ?: ZoneOffset.UTC).toLocalDate().toString() }.getOrDefault(measuredAt.take(10))
            CachedObservationEntity(key = "${r.hcId}#$metric", hcId = r.hcId, recordType = r.recordType, metricId = metric, value = value, unit = unit, measuredAt = measuredAt, localDate = localDate, dataOrigin = r.dataOrigin, cachedAt = now())
        }
        if (entities.isNotEmpty()) db.cachedObservations().upsertAll(entities)
    }

    private fun permissionStates(granted: Set<String>, requested: Set<String>): List<PermissionStateDto> = requested.sorted().map { PermissionStateDto(it, it in granted) }

    private suspend fun report(deviceInstanceId: String, attemptedAt: Instant, outcome: SyncOutcome, sdkStatus: String, granted: Set<String>) {
        val requested = runCatching { hc.requestablePermissions() }.getOrDefault(emptySet())
        val report = SyncReportDto(
            deviceInstanceId = deviceInstanceId,
            deviceLabel = deviceLabel,
            appVersion = appVersion,
            attemptedAt = DateTimeFormatter.ISO_INSTANT.format(attemptedAt),
            status = outcome.status,
            sdkStatus = sdkStatus,
            grantedPermissions = granted.sorted(),
            requestedPermissions = requested.sorted(),
            backgroundReadGranted = if (hc.isBackgroundReadSupported()) hc.backgroundPermission in granted else null,
            historyReadGranted = if (hc.isHistoryReadSupported()) hc.historyPermission in granted else null,
            error = outcome.error,
            recordsRead = outcome.recordsRead,
        )
        runCatching { api.syncReport(report) }
    }

    private suspend fun log(trigger: SyncTrigger, outcome: SyncOutcome) {
        db.syncLog().insert(SyncLogEntity(at = now(), trigger = trigger.name, status = outcome.status, recordsRead = outcome.recordsRead, uploaded = outcome.uploaded, deletions = outcome.deletions, error = outcome.error))
        db.syncLog().trim()
    }

    suspend fun resetLocalState() {
        db.clearAll()
    }

    private fun now(): String = Instant.now().toString()

    @Suppress("unused")
    private suspend fun onboardingDone(): Boolean = settings.onboardingDone.first()
}
