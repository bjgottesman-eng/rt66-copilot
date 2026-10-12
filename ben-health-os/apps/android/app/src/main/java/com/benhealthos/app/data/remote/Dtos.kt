package com.benhealthos.app.data.remote

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

// Mirrors packages/contracts. Unknown keys are ignored so the app tolerates additive server changes.

@Serializable data class HcDeviceDto(val type: String? = null, val manufacturer: String? = null, val model: String? = null)

@Serializable
data class HcRecordDto(
    val recordType: String,
    val hcId: String,
    val dataOrigin: String,
    val lastModifiedTime: String,
    val clientRecordId: String? = null,
    val clientRecordVersion: Long? = null,
    val device: HcDeviceDto? = null,
    val recordingMethod: String = "UNKNOWN",
    val startTime: String? = null,
    val startZoneOffset: String? = null,
    val endTime: String? = null,
    val endZoneOffset: String? = null,
    val time: String? = null,
    val zoneOffset: String? = null,
    val payload: JsonObject,
)

@Serializable data class HcDeletionDto(val hcId: String, val recordType: String? = null)
@Serializable data class PermissionStateDto(val permission: String, val granted: Boolean)

@Serializable
data class IngestBatchDto(
    val source: String = "health_connect",
    val deviceInstanceId: String,
    val deviceLabel: String? = null,
    val appVersion: String,
    val timeZone: String,
    val clientTime: String,
    val mode: String,
    val changeTokens: Map<String, String>? = null,
    val permissions: List<PermissionStateDto>? = null,
    val records: List<HcRecordDto>,
    val deletions: List<HcDeletionDto> = emptyList(),
)

@Serializable data class RejectedDto(val index: Int, val hcId: String? = null, val reason: String)

@Serializable
data class IngestResultDto(
    val batchId: String,
    val serverTime: String,
    val received: Int,
    val inserted: Int,
    val updated: Int,
    val unchangedDuplicates: Int,
    val crossSourceDuplicates: Int,
    val deleted: Int,
    val rejected: List<RejectedDto> = emptyList(),
    val observationCounts: Map<String, Int> = emptyMap(),
)

@Serializable
data class SyncReportDto(
    val deviceInstanceId: String,
    val deviceLabel: String? = null,
    val appVersion: String,
    val attemptedAt: String,
    val status: String,
    val sdkStatus: String,
    val grantedPermissions: List<String>,
    val requestedPermissions: List<String>,
    val backgroundReadGranted: Boolean? = null,
    val historyReadGranted: Boolean? = null,
    val error: String? = null,
    val recordsRead: Int,
)

@Serializable data class DevLoginRequestDto(val email: String, val displayName: String? = null)
@Serializable data class DevLoginResponseDto(val accessToken: String, val expiresAt: String, val userId: String)

@Serializable
data class MeDto(val userId: String, val email: String? = null, val displayName: String, val timeZone: String, val demoMode: Boolean, val authMode: String, val birthDate: String? = null, val maxHeartRate: Int? = null)

@Serializable data class SparkDto(val date: String, val value: Double? = null)
@Serializable data class FreshnessDto(val status: String, val reason: String, val measuredAt: String? = null, val sourceUpdatedAt: String? = null, val ingestedAt: String? = null, val expectedLatencyHours: Double, val ageHours: Double? = null)
@Serializable data class LatestDto(val value: Double, val unit: String, val measuredAt: String, val connector: String, val dataOrigin: String? = null, val sourceLabel: String, val deviceLabel: String? = null, val companions: Map<String, Double>? = null)
@Serializable data class WindowDto(val from: String, val to: String, val daysWithData: Int, val days: Int, val coverage: Double, val n: Int, val mean: Double? = null, val median: Double? = null, val sd: Double? = null, val min: Double? = null, val max: Double? = null, val slopePerDay: Double? = null)
@Serializable data class ComparisonDto(val current7d: WindowDto, val baseline28d: WindowDto, val delta: Double? = null, val deltaPct: Double? = null, val effectSize: Double? = null, val changeClass: String, val explanation: String)
@Serializable data class MetricCardDto(val metricId: String, val label: String, val unit: String, val domain: String, val latest: LatestDto? = null, val freshness: FreshnessDto, val comparison: ComparisonDto? = null, val sparkline: List<SparkDto> = emptyList(), val qualityFlags: List<String> = emptyList())
@Serializable data class DomainDto(val domain: String, val label: String, val status: String, val summary: String, val evidence: List<String> = emptyList(), val metrics: List<MetricCardDto> = emptyList())
@Serializable data class DataQualityDto(val connectedSources: Int, val staleSources: Int, val observations30d: Int, val crossSourceDuplicates30d: Int, val implausibleValues30d: Int, val notes: List<String> = emptyList())
@Serializable
data class TodayDto(
    val generatedAt: String,
    val timeZone: String,
    val localDate: String,
    val demoMode: Boolean,
    val headline: String,
    val whatChanged: List<String> = emptyList(),
    val whatMatters: List<String> = emptyList(),
    val doToday: List<String> = emptyList(),
    val domains: List<DomainDto> = emptyList(),
    val dataQuality: DataQualityDto,
    val disclaimer: String,
)

@Serializable data class SourceDeviceDto(val id: String, val label: String, val manufacturer: String? = null, val model: String? = null, val lastSeenAt: String? = null)
@Serializable
data class SourceDto(
    val connectorId: String,
    val displayName: String,
    val integrationClass: String,
    val implementationStatus: String,
    val connectionStatus: String,
    val lastSuccessfulSyncAt: String? = null,
    val lastSyncAttemptAt: String? = null,
    val lastSyncStatus: String,
    val lastError: String? = null,
    val expectedSyncIntervalHours: Double,
    val actualLatencyHours: Double? = null,
    val latestObservationAt: String? = null,
    val observationCount: Int,
    val coverageDays30: Int,
    val availableMetrics: List<String> = emptyList(),
    val missingPermissions: List<String> = emptyList(),
    val grantedPermissions: List<String> = emptyList(),
    val devices: List<SourceDeviceDto> = emptyList(),
    val actions: List<String> = emptyList(),
    val notes: List<String> = emptyList(),
)
@Serializable data class SourcesDto(val generatedAt: String, val sources: List<SourceDto>)

@Serializable data class SeriesPointDto(val t: String, val localDate: String, val value: Double, val connector: String, val dataOrigin: String? = null, val canonical: Boolean)
@Serializable data class SeriesDailyDto(val date: String, val value: Double? = null, val n: Int)
@Serializable data class SeriesDto(val metricId: String, val unit: String, val from: String, val to: String, val bucket: String, val points: List<SeriesPointDto> = emptyList(), val daily: List<SeriesDailyDto> = emptyList())

@Serializable
data class ManualBpDto(
    val systolic: Int,
    val diastolic: Int,
    val pulse: Int? = null,
    val measuredAt: String,
    val arm: String = "UNKNOWN",
    val posture: String = "SEATED",
    val seatedRestMinutes: Int? = null,
    val notes: String? = null,
    val sessionId: String? = null,
    val clientEntryId: String,
)
@Serializable data class BpReadingDto(val id: String, val sessionId: String? = null, val measuredAt: String, val systolic: Double, val diastolic: Double, val pulse: Double? = null, val connector: String, val canonical: Boolean)
@Serializable data class ApiErrorDto(val error: String, val message: String)

@Serializable data class OAuthStartDto(val url: String)
@Serializable data class BpAverageDto(val systolic: Double, val diastolic: Double, val pulse: Double? = null, val n: Int)
@Serializable data class BpSessionDto(val sessionId: String? = null, val startedAt: String, val n: Int, val systolic: Double, val diastolic: Double, val pulse: Double? = null, val rule: String)
@Serializable data class BpTargetsDto(val systolicMax: Double, val diastolicMax: Double, val source: String, val clinicianConfigured: Boolean)
@Serializable data class BpFullReadingDto(val id: String, val measuredAt: String, val systolic: Double, val diastolic: Double, val pulse: Double? = null, val connector: String, val deviceLabel: String? = null, val canonical: Boolean)
@Serializable
data class BpSummaryDto(
    val latest: BpFullReadingDto? = null,
    val lastSyncAt: String? = null,
    val avg7d: BpAverageDto? = null,
    val avg30d: BpAverageDto? = null,
    val sessions: List<BpSessionDto> = emptyList(),
    val readings: List<BpFullReadingDto> = emptyList(),
    val targets: BpTargetsDto,
    val notes: List<String> = emptyList(),
)

@Serializable data class TrendWindowDto(val days: Int, val stats: WindowDto, val confidence: String, val algorithmVersion: Int, val computedAt: String)
@Serializable data class SignalDto(val metricId: String, val domain: String, val kind: String, val direction: String? = null, val priority: Int, val delta: Double? = null, val deltaPct: Double? = null, val effectSize: Double? = null, val explanation: String, val asOfDate: String, val algorithmVersion: Int)
@Serializable data class ZoneInfoDto(val maxHeartRate: Int? = null, val source: String? = null, val zone2: List<Int>? = null)
@Serializable data class TrendsDto(val metricId: String, val label: String, val unit: String, val asOfDate: String, val windows: List<TrendWindowDto> = emptyList(), val comparison: ComparisonDto? = null, val percentile365: Double? = null, val daily: List<SparkDto> = emptyList(), val signals: List<SignalDto> = emptyList(), val zone: ZoneInfoDto? = null)
@Serializable data class ProfileUpdateDto(val displayName: String? = null, val timeZone: String? = null, val birthDate: String? = null, val maxHeartRate: Int? = null)
