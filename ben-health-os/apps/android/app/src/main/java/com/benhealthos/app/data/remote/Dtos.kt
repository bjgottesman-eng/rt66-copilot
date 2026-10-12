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

// ---- Phase 4: nutrition days and glucose day (rendered only; all math is server-side) ----
@Serializable data class NutritionTotalsDto(val calories: Double? = null, val protein_g: Double? = null, val carbs_g: Double? = null, val fat_g: Double? = null, val saturated_fat_g: Double? = null, val fiber_g: Double? = null, val sodium_mg: Double? = null, val potassium_mg: Double? = null)
@Serializable data class NutritionMealDto(val id: String, val eatenAt: String, val name: String? = null, val mealType: String? = null, val calories: Double? = null, val protein_g: Double? = null, val source: String, val canonical: Boolean)
@Serializable data class NutritionDayDto(val date: String, val totals: NutritionTotalsDto, val mealsCount: Int, val sources: List<String> = emptyList(), val meals: List<NutritionMealDto> = emptyList())
@Serializable data class NutritionTargetsDto(val calories: Double? = null, val protein_g: Double? = null, val carbs_g: Double? = null, val fat_g: Double? = null, val saturated_fat_g_max: Double? = null, val fiber_g: Double? = null, val sodium_mg_max: Double? = null, val potassium_mg: Double? = null, val source: String? = null)
@Serializable data class NutritionDaysDto(val from: String, val to: String, val days: List<NutritionDayDto> = emptyList(), val mean7d: NutritionTotalsDto = NutritionTotalsDto(), val daysWithData7d: Int = 0, val targets: NutritionTargetsDto = NutritionTargetsDto(), val notes: List<String> = emptyList())
@Serializable data class GlucoseSampleDto(val t: String, val mgDl: Double, val source: String)
@Serializable data class GlucoseRangeDto(val lowMgDl: Double, val highMgDl: Double, val source: String? = null)
@Serializable data class GlucoseStatsDto(val n: Int, val mean: Double? = null, val sd: Double? = null, val cvPct: Double? = null, val min: Double? = null, val max: Double? = null, val timeInRangePct: Double? = null, val timeBelowPct: Double? = null, val timeAbovePct: Double? = null, val overnightMean: Double? = null, val coverageHours: Double = 0.0, val intervalMinutes: Double? = null)
@Serializable data class GlucoseMealDto(val at: String, val label: String, val source: String)
@Serializable data class GlucoseWorkoutDto(val startAt: String, val endAt: String, val label: String)
@Serializable data class GlucoseAnnotationDto(val id: String, val kind: String, val at: String, val label: String)
@Serializable data class GlucoseExcursionDto(val mealAt: String, val label: String, val baselineMgDl: Double? = null, val peakMgDl: Double? = null, val peakDeltaMgDl: Double? = null, val minutesToPeak: Double? = null, val iAuc2h: Double? = null, val samplesIn2h: Int = 0, val confidence: String = "LOW")
@Serializable data class GlucoseFreshnessDto(val latestSampleAt: String? = null, val expectedSourceLatencyHours: Double = 3.0, val note: String = "")
@Serializable
data class GlucoseDayDto(
    val date: String,
    val timeZone: String,
    val range: GlucoseRangeDto,
    val samples: List<GlucoseSampleDto> = emptyList(),
    val stats: GlucoseStatsDto,
    val meals: List<GlucoseMealDto> = emptyList(),
    val workouts: List<GlucoseWorkoutDto> = emptyList(),
    val annotations: List<GlucoseAnnotationDto> = emptyList(),
    val excursions: List<GlucoseExcursionDto> = emptyList(),
    val freshness: GlucoseFreshnessDto = GlucoseFreshnessDto(),
    val datesWithData: List<String> = emptyList(),
    val disclaimer: String = "",
)

// ---- Phase 5: labs, medications, preventive care (rendered only) ----
@Serializable data class LabPointDto(val id: String, val collectedAt: String? = null, val value: Double? = null, val valueText: String? = null, val unit: String? = null, val canonicalValue: Double? = null, val canonicalUnit: String? = null, val abnormalFlag: String? = null, val referenceText: String? = null, val source: String, val laboratory: String? = null, val canonical: Boolean = true, val verificationStatus: String = "CONFIRMED", val qualityFlags: List<String> = emptyList())
@Serializable data class LabAnalyteDto(val analyteKey: String, val analyteId: String? = null, val label: String, val canonicalUnit: String? = null, val mapped: Boolean = false, val latest: LabPointDto? = null, val previous: LabPointDto? = null, val direction: String? = null, val deltaPct: Double? = null, val count: Int = 0, val flaggedLatest: Boolean = false)
@Serializable data class LabsOverviewDto(val generatedAt: String, val analytes: List<LabAnalyteDto> = emptyList(), val pendingReview: Int = 0, val latestCollectedAt: String? = null, val sources: List<String> = emptyList(), val notes: List<String> = emptyList())
@Serializable data class MedicationDto(val id: String, val name: String, val dosage: String? = null, val frequency: String? = null, val route: String? = null, val status: String = "UNCERTAIN", val prescribingClinician: String? = null, val indication: String? = null, val refillDate: String? = null, val source: String = "USER")
@Serializable data class SupplementDto(val id: String, val name: String, val dose: String? = null, val frequency: String? = null, val purpose: String? = null, val status: String = "CURRENT")
@Serializable data class AllergyDto(val id: String, val substance: String, val reaction: String? = null, val severity: String = "UNKNOWN", val source: String = "USER")
@Serializable data class MedicationSourceRecordDto(val id: String, val source: String, val name: String? = null, val status: String = "UNRECONCILED", val recordedAt: String? = null)
@Serializable data class InteractionsCheckDto(val status: String = "NOT_IMPLEMENTED", val note: String = "")
@Serializable data class MedicationsDto(val medications: List<MedicationDto> = emptyList(), val supplements: List<SupplementDto> = emptyList(), val allergies: List<AllergyDto> = emptyList(), val unreconciled: List<MedicationSourceRecordDto> = emptyList(), val interactionsCheck: InteractionsCheckDto = InteractionsCheckDto(), val notes: List<String> = emptyList())
@Serializable data class PreventiveItemDto(val id: String, val title: String, val category: String, val guidelineSource: String = "", val guidelineReviewedAt: String? = null, val intervalMonths: Int? = null, val lastCompletedAt: String? = null, val status: String = "DISCUSS_WITH_CLINICIAN", val computedStatus: String = "DISCUSS_WITH_CLINICIAN", val computedDueAt: String? = null, val daysUntilDue: Int? = null, val notes: String? = null)
@Serializable data class PreventiveCountsDto(val due: Int = 0, val dueSoon: Int = 0, val completed: Int = 0, val discuss: Int = 0, val notApplicable: Int = 0)
@Serializable data class PreventiveDto(val today: String, val items: List<PreventiveItemDto> = emptyList(), val counts: PreventiveCountsDto = PreventiveCountsDto(), val notes: List<String> = emptyList())

// ---- Phase 6: reports, recommendations, alerts, notification preferences (rendered only; all math is server-side) ----
@Serializable data class ReportSummaryDto(val id: String, val kind: String, val periodFrom: String, val periodTo: String, val generatedAt: String, val status: String = "READY")
@Serializable data class ReportListDto(val reports: List<ReportSummaryDto> = emptyList())
@Serializable data class ReportSectionDto(val key: String, val title: String, val claimType: String? = null, val lines: List<String> = emptyList(), val insufficient: Boolean = false)
@Serializable data class ReportPriorityDto(val rank: Int, val title: String, val text: String, val recommendationId: String? = null, val insufficient: Boolean = false)
@Serializable data class AiFindingDto(val claimType: String, val title: String, val text: String, val citations: List<String> = emptyList(), val confidence: String = "LOW", val category: String = "", val proposedAction: String? = null, val limitations: String? = null, val clinicianReview: Boolean = false)
@Serializable data class AiRejectedDto(val title: String, val reason: String)
@Serializable data class AiNarrativeDto(val status: String = "DISABLED", val provider: String? = null, val model: String? = null, val summary: String? = null, val findings: List<AiFindingDto> = emptyList(), val physicianQuestions: List<String> = emptyList(), val rejected: List<AiRejectedDto> = emptyList(), val note: String = "")
@Serializable data class ReportContentDto(val algorithm: String, val version: Int = 1, val dataThrough: String = "", val executiveSummary: List<String> = emptyList(), val sections: List<ReportSectionDto> = emptyList(), val priorities: List<ReportPriorityDto> = emptyList(), val physicianFollowUp: List<String> = emptyList(), val aiNarrative: AiNarrativeDto = AiNarrativeDto(), val packetHash: String = "")
@Serializable data class ReportDto(val id: String, val kind: String, val periodFrom: String, val periodTo: String, val baselineFrom: String? = null, val baselineTo: String? = null, val generatedAt: String, val status: String = "READY", val content: ReportContentDto)
@Serializable data class EvidenceDto(val id: String, val evidenceType: String, val citation: String? = null, val strength: String? = null, val applicability: String? = null, val limitations: String? = null, val lastVerifiedAt: String? = null)
@Serializable data class RecommendationDto(val id: String, val ruleKey: String? = null, val title: String, val category: String = "", val observation: String = "", val interpretation: String? = null, val reason: String = "", val proposedAction: String = "", val expectedBenefit: String? = null, val requiredEffort: String? = null, val estimatedCost: String? = null, val confidence: String = "LOW", val claimType: String = "RECOMMENDATION", val limitations: String? = null, val clinicianReviewStatus: String = "NOT_REQUIRED", val status: String = "NEW", val priority: Int? = null, val generatedBy: String = "", val expiresAt: String? = null, val outcome: JsonObject? = null, val packetItemIds: List<String> = emptyList(), val evidence: List<EvidenceDto> = emptyList())
@Serializable data class RecommendationsDto(val recommendations: List<RecommendationDto> = emptyList(), val counts: Map<String, Int> = emptyMap(), val notes: List<String> = emptyList())
@Serializable data class AlertDto(val id: String, val kind: String, val severity: String = "INFO", val title: String, val body: String? = null, val createdAt: String, val deliveredAt: String? = null, val readAt: String? = null, val dismissedAt: String? = null)
@Serializable data class AlertsDto(val alerts: List<AlertDto> = emptyList(), val unread: Int = 0)
@Serializable data class NotificationPrefsDto(val pushEnabled: Boolean = true, val quietHoursStart: String? = "22:00", val quietHoursEnd: String? = "07:00", val enabledKinds: List<String> = listOf("REPORT_READY", "LABS_IMPORTED", "CONNECTION_EXPIRED", "SYNC_STALE", "PERMISSIONS_REVOKED", "EXPERIMENT_COMPLETED", "FOLLOW_UP_DUE", "MEDICATION_REVIEW_DUE"))
@Serializable data class AiStatusDto(val provider: String = "none", val model: String? = null, val status: String = "DISABLED", val sharingEnabled: Boolean = false, val excludedConnectors: List<String> = emptyList(), val note: String = "")
