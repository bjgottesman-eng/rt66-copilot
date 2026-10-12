package com.benhealthos.app.data.remote

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
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
