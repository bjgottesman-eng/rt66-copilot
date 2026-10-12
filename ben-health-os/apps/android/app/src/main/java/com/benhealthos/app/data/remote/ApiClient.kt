package com.benhealthos.app.data.remote

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

class ApiException(val code: Int, message: String) : IOException(message)

/** Thin, serializer-driven HTTP client for the Ben Health OS API. Never logs request bodies. */
class ApiClient(
    private val json: Json,
    private val baseUrl: () -> String,
    private val token: () -> String?,
    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(90, TimeUnit.SECONDS)
        .writeTimeout(90, TimeUnit.SECONDS)
        .build(),
) {
    private val jsonMedia = "application/json; charset=utf-8".toMediaType()

    suspend fun devLogin(email: String): DevLoginResponseDto =
        post("/v1/auth/dev-login", DevLoginRequestDto(email), DevLoginRequestDto.serializer(), DevLoginResponseDto.serializer(), auth = false)

    suspend fun me(): MeDto = get("/v1/me", MeDto.serializer())
    suspend fun today(): TodayDto = get("/v1/dashboard/today", TodayDto.serializer())
    suspend fun sources(): SourcesDto = get("/v1/sources", SourcesDto.serializer())
    suspend fun series(metricId: String, fromIso: String, toIso: String): SeriesDto =
        get("/v1/metrics/$metricId/series?from=$fromIso&to=$toIso&bucket=raw", SeriesDto.serializer())

    suspend fun ingest(batch: IngestBatchDto): IngestResultDto =
        post("/v1/ingest/health-connect", batch, IngestBatchDto.serializer(), IngestResultDto.serializer())

    suspend fun ingestRaw(bodyJson: String): IngestResultDto = postRaw("/v1/ingest/health-connect", bodyJson, IngestResultDto.serializer())

    suspend fun syncReport(report: SyncReportDto) {
        postNoContent("/v1/sources/health-connect/sync-report", json.encodeToString(SyncReportDto.serializer(), report))
    }

    suspend fun manualBloodPressure(input: ManualBpDto): BpReadingDto =
        post("/v1/measurements/blood-pressure", input, ManualBpDto.serializer(), BpReadingDto.serializer())

    suspend fun manualBloodPressureRaw(bodyJson: String): BpReadingDto = postRaw("/v1/measurements/blood-pressure", bodyJson, BpReadingDto.serializer())

    suspend fun trends(metricId: String): TrendsDto = get("/v1/analytics/trends/$metricId", TrendsDto.serializer())
    suspend fun updateProfile(update: ProfileUpdateDto) = patchNoContent("/v1/me", json.encodeToString(ProfileUpdateDto.serializer(), update))

    suspend fun oauthStart(connector: String): OAuthStartDto = get("/v1/oauth/$connector/start?client=android", OAuthStartDto.serializer())
    suspend fun refreshSource(connector: String): IngestResultDto = postRaw("/v1/sources/$connector/refresh", "{}", IngestResultDto.serializer())
    suspend fun disconnectSource(connector: String) = postNoContent("/v1/sources/$connector/disconnect", "{}")
    suspend fun bloodPressureSummary(days: Int = 30): BpSummaryDto = get("/v1/blood-pressure/summary?days=$days", BpSummaryDto.serializer())
    suspend fun nutritionDays(fromDate: String, toDate: String): NutritionDaysDto = get("/v1/nutrition/days?from=$fromDate&to=$toDate", NutritionDaysDto.serializer())
    suspend fun glucoseDay(date: String?): GlucoseDayDto = get("/v1/glucose/day" + (date?.let { "?date=$it" } ?: ""), GlucoseDayDto.serializer())
    suspend fun labs(): LabsOverviewDto = get("/v1/labs", LabsOverviewDto.serializer())
    suspend fun medications(): MedicationsDto = get("/v1/medications", MedicationsDto.serializer())
    suspend fun preventive(): PreventiveDto = get("/v1/preventive", PreventiveDto.serializer())
    suspend fun completePreventive(id: String, completedAt: String) = postNoContent("/v1/preventive/$id/complete", """{"completedAt":"$completedAt"}""")

    // Phase 6
    suspend fun reports(): ReportListDto = get("/v1/reports", ReportListDto.serializer())
    suspend fun report(kind: String, id: String): ReportDto = get("/v1/reports/$kind/$id", ReportDto.serializer())
    suspend fun generateReport(kind: String): ReportDto = postRaw("/v1/reports/$kind", "{\"force\":true}", ReportDto.serializer())
    suspend fun recommendations(): RecommendationsDto = get("/v1/recommendations", RecommendationsDto.serializer())
    suspend fun updateRecommendation(id: String, status: String, snoozedUntil: String? = null, dismissReason: String? = null): RecommendationDto {
        val body = buildJsonObject {
            put("status", status)
            if (snoozedUntil != null) put("snoozedUntil", snoozedUntil)
            if (dismissReason != null) put("dismissReason", dismissReason)
        }
        return patchRaw("/v1/recommendations/$id", json.encodeToString(JsonObject.serializer(), body), RecommendationDto.serializer())
    }
    suspend fun alerts(unreadOnly: Boolean, refresh: Boolean = false): AlertsDto = get("/v1/alerts?unread=${if (unreadOnly) 1 else 0}&refresh=${if (refresh) 1 else 0}", AlertsDto.serializer())
    suspend fun alertAction(id: String, action: String) = patchNoContent("/v1/alerts/$id", "{\"action\":\"$action\"}")
    suspend fun notificationPrefs(): NotificationPrefsDto = get("/v1/notifications/prefs", NotificationPrefsDto.serializer())
    suspend fun updateNotificationPrefs(prefs: NotificationPrefsDto): NotificationPrefsDto = patchRaw("/v1/notifications/prefs", json.encodeToString(NotificationPrefsDto.serializer(), prefs), NotificationPrefsDto.serializer())
    suspend fun aiStatus(): AiStatusDto = get("/v1/ai/status", AiStatusDto.serializer())

    suspend fun seedDemo(days: Int): JsonObject = postRaw("/v1/demo/seed", """{"days":$days,"replace":true}""", JsonObject.serializer())
    suspend fun clearDemo() = deleteNoContent("/v1/demo")
    suspend fun deleteAllData() = postOrDelete("DELETE", "/v1/me/data", """{"confirmation":"DELETE ALL MY HEALTH DATA"}""")

    fun exportUrl(): String = baseUrl() + "/v1/me/export"

    private suspend fun <T> get(path: String, serializer: KSerializer<T>): T = withContext(Dispatchers.IO) {
        execute(request(path).get().build(), serializer)
    }

    private suspend fun <B, T> post(path: String, body: B, bodySerializer: KSerializer<B>, serializer: KSerializer<T>, auth: Boolean = true): T =
        postRaw(path, json.encodeToString(bodySerializer, body), serializer, auth)

    private suspend fun <T> postRaw(path: String, bodyJson: String, serializer: KSerializer<T>, auth: Boolean = true): T = withContext(Dispatchers.IO) {
        execute(request(path, auth).post(bodyJson.toRequestBody(jsonMedia)).build(), serializer)
    }

    private suspend fun postNoContent(path: String, bodyJson: String) = withContext(Dispatchers.IO) {
        http.newCall(request(path).post(bodyJson.toRequestBody(jsonMedia)).build()).execute().use { res ->
            if (!res.isSuccessful) throw ApiException(res.code, errorMessage(res.body?.string()))
        }
    }

    private suspend fun <T> patchRaw(path: String, bodyJson: String, serializer: KSerializer<T>): T = withContext(Dispatchers.IO) {
        execute(request(path).patch(bodyJson.toRequestBody(jsonMedia)).build(), serializer)
    }

    private suspend fun patchNoContent(path: String, bodyJson: String) = withContext(Dispatchers.IO) {
        http.newCall(request(path).patch(bodyJson.toRequestBody(jsonMedia)).build()).execute().use { res ->
            if (!res.isSuccessful) throw ApiException(res.code, errorMessage(res.body?.string()))
        }
    }

    private suspend fun deleteNoContent(path: String) = withContext(Dispatchers.IO) {
        http.newCall(request(path).delete().build()).execute().use { res ->
            if (!res.isSuccessful) throw ApiException(res.code, errorMessage(res.body?.string()))
        }
    }

    private suspend fun postOrDelete(method: String, path: String, bodyJson: String) = withContext(Dispatchers.IO) {
        http.newCall(request(path).method(method, bodyJson.toRequestBody(jsonMedia)).build()).execute().use { res ->
            if (!res.isSuccessful) throw ApiException(res.code, errorMessage(res.body?.string()))
        }
    }

    private fun request(path: String, auth: Boolean = true): Request.Builder {
        val b = Request.Builder().url(baseUrl().trimEnd('/') + path).header("accept", "application/json")
        if (auth) {
            val t = token() ?: throw ApiException(401, "not signed in")
            b.header("authorization", "Bearer $t")
        }
        return b
    }

    private fun <T> execute(req: Request, serializer: KSerializer<T>): T {
        http.newCall(req).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (!res.isSuccessful) throw ApiException(res.code, errorMessage(body))
            return json.decodeFromString(serializer, body)
        }
    }

    private fun errorMessage(body: String?): String {
        if (body.isNullOrBlank()) return "request failed"
        return runCatching { json.decodeFromString(ApiErrorDto.serializer(), body).message }.getOrDefault(body.take(200))
    }

    @Suppress("unused")
    private val stringSerializer = String.serializer()
}
