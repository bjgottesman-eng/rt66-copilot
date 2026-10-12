package com.benhealthos.app.integrations.healthconnect

import androidx.health.connect.client.records.BloodPressureRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.metadata.Device
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.units.Pressure
import com.benhealthos.app.data.remote.HcRecordDto
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneOffset

class HealthConnectMapperTest {
    private val json = Json { encodeDefaults = true; explicitNulls = false }
    private val offset = ZoneOffset.ofHours(-4)
    private val ring = Device(type = Device.TYPE_RING, manufacturer = "Oura", model = "Gen3")

    @Test
    fun mapsStepsIntervalWithMetadataAndZoneOffsets() {
        val start = Instant.parse("2026-10-11T12:00:00Z")
        val rec = StepsRecord(startTime = start, startZoneOffset = offset, endTime = start.plusSeconds(3600), endZoneOffset = offset, count = 1200, metadata = Metadata.autoRecorded(ring))
        val dto = HealthConnectMapper.toDto(rec)!!
        assertEquals("Steps", dto.recordType)
        assertEquals("2026-10-11T12:00:00Z", dto.startTime)
        assertEquals("-04:00", dto.startZoneOffset)
        assertEquals(1200, dto.payload["count"]!!.jsonPrimitive.content.toInt())
        assertEquals("AUTOMATICALLY_RECORDED", dto.recordingMethod)
        assertEquals("RING", dto.device?.type)
        assertEquals("Oura", dto.device?.manufacturer)
        assertNull(dto.time)
    }

    @Test
    fun mapsBloodPressureInstantInMmHg() {
        val t = Instant.parse("2026-10-11T11:05:00Z")
        val rec = BloodPressureRecord(time = t, zoneOffset = offset, systolic = Pressure.millimetersOfMercury(121.0), diastolic = Pressure.millimetersOfMercury(78.0), metadata = Metadata.manualEntry())
        val dto = HealthConnectMapper.toDto(rec)!!
        assertEquals("BloodPressure", dto.recordType)
        assertEquals("2026-10-11T11:05:00Z", dto.time)
        assertEquals(121.0, dto.payload["systolicMmHg"]!!.jsonPrimitive.content.toDouble(), 0.0)
        assertEquals(78.0, dto.payload["diastolicMmHg"]!!.jsonPrimitive.content.toDouble(), 0.0)
        assertEquals("MANUAL_ENTRY", dto.recordingMethod)
    }

    @Test
    fun mapsSleepSessionStagesAndHeartRateSamples() {
        val start = Instant.parse("2026-10-11T03:00:00Z")
        val end = start.plusSeconds(8 * 3600)
        val sleep = SleepSessionRecord(startTime = start, startZoneOffset = offset, endTime = end, endZoneOffset = offset, stages = listOf(SleepSessionRecord.Stage(start, start.plusSeconds(1800), SleepSessionRecord.STAGE_TYPE_LIGHT), SleepSessionRecord.Stage(start.plusSeconds(1800), end, SleepSessionRecord.STAGE_TYPE_DEEP)), metadata = Metadata.autoRecorded(ring))
        val dto = HealthConnectMapper.toDto(sleep)!!
        assertEquals("SleepSession", dto.recordType)
        assertEquals(2, dto.payload["stages"]!!.jsonArray.size)
        val hr = HeartRateRecord(startTime = start, startZoneOffset = offset, endTime = end, endZoneOffset = offset, samples = listOf(HeartRateRecord.Sample(start, 52), HeartRateRecord.Sample(start.plusSeconds(60), 55)), metadata = Metadata.autoRecorded(ring))
        val hrDto = HealthConnectMapper.toDto(hr)!!
        assertEquals(2, hrDto.payload["samples"]!!.jsonArray.size)
    }

    @Test
    fun dtoRoundTripsThroughJsonAndOmitsNulls() {
        val t = Instant.parse("2026-10-11T11:05:00Z")
        val rec = BloodPressureRecord(time = t, zoneOffset = null, systolic = Pressure.millimetersOfMercury(120.0), diastolic = Pressure.millimetersOfMercury(80.0), metadata = Metadata.unknownRecordingMethod())
        val dto = HealthConnectMapper.toDto(rec)!!
        val encoded = json.encodeToString(HcRecordDto.serializer(), dto)
        assertTrue(encoded.contains("\"recordType\":\"BloodPressure\""))
        assertTrue("null fields omitted", !encoded.contains("\"zoneOffset\""))
        val decoded = json.decodeFromString(HcRecordDto.serializer(), encoded)
        assertEquals(dto, decoded)
    }

    @Test
    fun exerciseTypeNamesAreResolvedFromSdkConstants() {
        val names = HealthConnectMapper.exerciseTypeNames
        assertNotNull(names)
        assertTrue(names.values.contains("RUNNING"))
        assertTrue(names.values.contains("STRENGTH_TRAINING"))
    }
}
