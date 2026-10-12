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

    @Test
    fun glucoseDayDtoDecodesContractShapeWithNullStats() {
        val body = """{"date":"2026-10-11","timeZone":"America/New_York","range":{"lowMgDl":70,"highMgDl":140,"source":"test"},
          "samples":[{"t":"2026-10-11T12:00:00Z","mgDl":95,"source":"health_connect:com.dexcom.stelo"}],
          "stats":{"n":1,"mean":95,"sd":null,"cvPct":null,"min":95,"max":95,"timeInRangePct":100,"timeBelowPct":0,"timeAbovePct":0,"overnightMean":null,"coverageHours":0,"intervalMinutes":null},
          "meals":[{"at":"2026-10-11T12:30:00Z","label":"Lunch","source":"cronometer"}],"workouts":[],"annotations":[],
          "excursions":[{"mealAt":"2026-10-11T12:30:00Z","label":"Lunch","baselineMgDl":95,"peakMgDl":null,"peakDeltaMgDl":null,"minutesToPeak":null,"iAuc2h":null,"samplesIn2h":1,"confidence":"LOW"}],
          "freshness":{"latestSampleAt":"2026-10-11T12:00:00Z","expectedSourceLatencyHours":3,"note":"n"},"datesWithData":["2026-10-11"],"disclaimer":"d","unknownField":true}"""
        val g = json.decodeFromString(GlucoseDayDto.serializer(), body)
        assertEquals(1, g.samples.size)
        assertEquals(null, g.stats.sd)
        assertEquals("LOW", g.excursions[0].confidence)
        assertEquals(12 * 60 + 30 - 4 * 60, minutesOfDayForTest(g.meals[0].at, "America/New_York"))
        val days = json.decodeFromString(NutritionDaysDto.serializer(), """{"from":"2026-10-01","to":"2026-10-11","days":[],"mean7d":{"calories":null},"daysWithData7d":0,"targets":{"protein_g":150,"source":"me"},"notes":[]}""")
        assertEquals(150.0, days.targets.protein_g)
        assertEquals(null, days.mean7d.calories)
    }

    private fun minutesOfDayForTest(iso: String, zone: String): Int = com.benhealthos.app.presentation.screens.minutesOfDay(iso, java.time.ZoneId.of(zone))

    @Test
    fun reportDtoDecodesContractShapeWithRulesOnlyNarrative() {
        val body = """{"id":"7a4e2d2e-0c3b-4c6c-9a1d-1f2e3d4c5b6a","kind":"weekly","periodFrom":"2026-10-05","periodTo":"2026-10-11","baselineFrom":"2026-09-07","baselineTo":"2026-10-04","generatedAt":"2026-10-12T06:00:00Z","generator":{"ai":{"status":"DISABLED"}},"status":"READY",
          "content":{"algorithm":"weekly_health_ceo","version":1,"dataThrough":"2026-10-11","executiveSummary":["x"],"sections":[{"key":"kpi_scorecard","title":"KPI","claimType":"DERIVED_TREND","lines":["a"],"items":[],"insufficient":false}],
          "priorities":[{"rank":1,"title":"t","text":"x","recommendationId":null,"insufficient":false},{"rank":2,"title":"No further priority this period","text":"n","recommendationId":null,"insufficient":true},{"rank":3,"title":"n","text":"n","recommendationId":null,"insufficient":true}],
          "physicianFollowUp":[],"aiNarrative":{"status":"DISABLED","provider":null,"model":null,"summary":null,"findings":[],"physicianQuestions":[],"rejected":[],"packetHash":null,"note":"off"},"packetHash":"abc"}}"""
        val r = json.decodeFromString(ReportDto.serializer(), body)
        assertEquals(3, r.content.priorities.size)
        assertEquals("DISABLED", r.content.aiNarrative.status)
        assertEquals(null, r.content.priorities[0].recommendationId)
        val rec = json.decodeFromString(RecommendationDto.serializer(), """{"id":"1","title":"T","status":"NEW","evidence":[{"id":"e","evidenceType":"GUIDELINE","citation":"c","lastVerifiedAt":null}],"outcome":null,"unknown":true}""")
        assertEquals(1, rec.evidence.size)
        assertEquals(null, rec.outcome)
    }

    @Test
    fun experimentAndTrainingDtosDecodeContractShapes() {
        val exp = json.decodeFromString(ExperimentDto.serializer(), """{"id":"e1","title":"Walk","design":"BEFORE_AFTER","status":"ANALYSIS","decision":null,"phases":[{"id":"p1","phase":"BASELINE","sequence":1,"startDate":"2026-09-01","endDate":"2026-09-14","adherence":[],"notes":null}],
          "evaluation":{"algorithm":"experiment_evaluation","version":1,"verdict":"RETEST","confidence":"LOW","changeClass":"DIRECTIONAL","delta":-2.1,"preliminary":false,"complete":true,"unit":"bpm","phases":[],"reasons":["r"],"limitations":["l"],"summary":"s","evaluatedAt":"2026-10-12T00:00:00Z","unknown":1},"daily":[]}""")
        assertEquals("RETEST", exp.evaluation?.verdict)
        assertEquals(1, exp.phases.size)
        val training = json.decodeFromString(TrainingOverviewDto.serializer(), """{"from":"2026-08-18","to":"2026-10-12","summary":{"algorithm":"training_summary","version":1,"weeks":[{"weekStart":"2026-10-06","weekEnd":"2026-10-12","sessions":2,"loggedSets":9,"volumeKg":4500,"minutes":90}],"sessionsPerWeek":2.5,"weeksWithoutSession":0,"progression":[{"exercise":"Back squat","sessions":[],"bestEstimatedOneRepMaxKg":137.1,"status":"PROGRESSING","note":"n"}],"notes":[]},"sessions":[],"recentSets":[],"zone2":{"minutes7d":null,"note":"x"},"recovery":{},"notes":[]}""")
        assertEquals(null, training.zone2.minutes7d)
        assertEquals("PROGRESSING", training.summary.progression[0].status)
        val checkIn = json.decodeFromString(CheckInsDto.serializer(), """{"checkIns":[{"id":"c","at":"2026-10-12T07:30:00Z","localDate":"2026-10-12","energy":7}],"summary":{"algorithm":"checkin_summary","version":1,"asOfDate":"2026-10-12","daysLogged7d":1,"dimensions":[],"notes":[]},"notes":[]}""")
        assertEquals(7, checkIn.checkIns[0].energy)
        assertEquals(null, checkIn.checkIns[0].mood)
    }
}
