package com.benhealthos.app.data.remote

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DtoSerializationTest {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = false }

    @Test
    fun ingestBatchMatchesContractShape() {
        val batch = IngestBatchDto(
            deviceInstanceId = "android-1234567890", appVersion = "0.1.0", timeZone = "America/New_York", clientTime = "2026-10-12T12:00:00Z", mode = "CHANGES",
            changeTokens = mapOf("Steps" to "tok"), permissions = listOf(PermissionStateDto("android.permission.health.READ_STEPS", true)),
            records = listOf(HcRecordDto(recordType = "Weight", hcId = "id1", dataOrigin = "com.withings.wiscale2", lastModifiedTime = "2026-10-12T11:00:00Z", time = "2026-10-12T10:00:00Z", zoneOffset = "-04:00", payload = buildJsonObject { put("kg", 80.4) })),
        )
        val encoded = json.encodeToString(IngestBatchDto.serializer(), batch)
        assertTrue(encoded.contains("\"source\":\"health_connect\""))
        assertTrue(encoded.contains("\"deletions\":[]"))
        val decoded = json.decodeFromString(IngestBatchDto.serializer(), encoded)
        assertEquals(batch, decoded)
    }

    @Test
    fun todayDtoToleratesUnknownKeysAndMissingOptionals() {
        val body = """{"generatedAt":"2026-10-12T12:00:00Z","timeZone":"UTC","localDate":"2026-10-12","demoMode":false,"headline":"ok","extraField":1,
          "domains":[{"domain":"recovery","label":"Recovery","status":"STEADY","summary":"s","metrics":[{"metricId":"hrv_rmssd","label":"HRV","unit":"ms","domain":"recovery","freshness":{"status":"CURRENT","reason":"r","expectedLatencyHours":12},"sparkline":[{"date":"2026-10-11","value":null}]}]}],
          "dataQuality":{"connectedSources":1,"staleSources":0,"observations30d":10,"crossSourceDuplicates30d":0,"implausibleValues30d":0},"disclaimer":"d"}"""
        val t = json.decodeFromString(TodayDto.serializer(), body)
        assertEquals(1, t.domains.size)
        assertEquals(null, t.domains[0].metrics[0].latest)
        assertEquals(null, t.domains[0].metrics[0].sparkline[0].value)
    }
}
