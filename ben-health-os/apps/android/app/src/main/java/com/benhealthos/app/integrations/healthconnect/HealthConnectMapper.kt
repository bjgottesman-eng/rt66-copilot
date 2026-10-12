package com.benhealthos.app.integrations.healthconnect

import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.BloodGlucoseRecord
import androidx.health.connect.client.records.BloodPressureRecord
import androidx.health.connect.client.records.BodyFatRecord
import androidx.health.connect.client.records.BodyTemperatureRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.HeightRecord
import androidx.health.connect.client.records.HydrationRecord
import androidx.health.connect.client.records.LeanBodyMassRecord
import androidx.health.connect.client.records.NutritionRecord
import androidx.health.connect.client.records.OxygenSaturationRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.RespiratoryRateRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.records.Vo2MaxRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.records.metadata.Device
import androidx.health.connect.client.records.metadata.Metadata
import com.benhealthos.app.data.remote.HcDeviceDto
import com.benhealthos.app.data.remote.HcRecordDto
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.lang.reflect.Modifier
import java.time.Instant
import java.time.ZoneOffset

/**
 * Converts Health Connect records into the wire DTO used by the ingest endpoint. Values are sent in
 * the canonical units of the data model (kg, mmHg, mg/dL, meters, kcal, °C, minutes are computed
 * server-side). Metadata (origin app, device, recording method, modification time) is preserved.
 */
object HealthConnectMapper {
    private fun constantNames(cls: Class<*>, prefix: String): Map<Int, String> =
        cls.declaredFields
            .filter { Modifier.isStatic(it.modifiers) && it.type == Int::class.javaPrimitiveType && it.name.startsWith(prefix) }
            .associate { f -> f.getInt(null) to f.name.removePrefix(prefix) }

    val exerciseTypeNames: Map<Int, String> by lazy { constantNames(ExerciseSessionRecord::class.java, "EXERCISE_TYPE_") }
    private val deviceTypeNames: Map<Int, String> by lazy { constantNames(Device::class.java, "TYPE_") }
    private val recordingMethodNames: Map<Int, String> by lazy { constantNames(Metadata::class.java, "RECORDING_METHOD_") }

    private fun ZoneOffset?.iso(): String? = this?.id
    private fun Instant.iso(): String = toString()

    private fun device(d: Device?): HcDeviceDto? = d?.let { HcDeviceDto(type = deviceTypeNames[it.type] ?: it.type.toString(), manufacturer = it.manufacturer, model = it.model) }

    private fun base(record: Record, recordType: String, payload: JsonObject, times: Map<String, String?>): HcRecordDto {
        val m = record.metadata
        return HcRecordDto(
            recordType = recordType,
            hcId = m.id,
            dataOrigin = m.dataOrigin.packageName,
            lastModifiedTime = m.lastModifiedTime.iso(),
            clientRecordId = m.clientRecordId,
            clientRecordVersion = m.clientRecordVersion,
            device = device(m.device),
            recordingMethod = recordingMethodNames[m.recordingMethod] ?: "UNKNOWN",
            startTime = times["startTime"],
            startZoneOffset = times["startZoneOffset"],
            endTime = times["endTime"],
            endZoneOffset = times["endZoneOffset"],
            time = times["time"],
            zoneOffset = times["zoneOffset"],
            payload = payload,
        )
    }

    private fun interval(start: Instant, startOffset: ZoneOffset?, end: Instant, endOffset: ZoneOffset?): Map<String, String?> =
        mapOf("startTime" to start.iso(), "startZoneOffset" to startOffset.iso(), "endTime" to end.iso(), "endZoneOffset" to endOffset.iso())

    private fun instant(time: Instant, offset: ZoneOffset?): Map<String, String?> = mapOf("time" to time.iso(), "zoneOffset" to offset.iso())

    private fun num(v: Double?): JsonPrimitive = if (v == null) JsonPrimitive(null as String?) else JsonPrimitive(v)

    fun toDto(record: Record): HcRecordDto? = when (record) {
        is StepsRecord -> base(record, "Steps", buildJsonObject { put("count", record.count) }, interval(record.startTime, record.startZoneOffset, record.endTime, record.endZoneOffset))
        is DistanceRecord -> base(record, "Distance", buildJsonObject { put("meters", record.distance.inMeters) }, interval(record.startTime, record.startZoneOffset, record.endTime, record.endZoneOffset))
        is HeartRateRecord -> base(
            record,
            "HeartRate",
            buildJsonObject {
                put("samples", buildJsonArray { record.samples.forEach { s -> add(buildJsonObject { put("time", s.time.iso()); put("bpm", s.beatsPerMinute) }) } })
            },
            interval(record.startTime, record.startZoneOffset, record.endTime, record.endZoneOffset),
        )
        is RestingHeartRateRecord -> base(record, "RestingHeartRate", buildJsonObject { put("bpm", record.beatsPerMinute) }, instant(record.time, record.zoneOffset))
        is HeartRateVariabilityRmssdRecord -> base(record, "HeartRateVariabilityRmssd", buildJsonObject { put("rmssdMs", record.heartRateVariabilityMillis) }, instant(record.time, record.zoneOffset))
        is SleepSessionRecord -> base(
            record,
            "SleepSession",
            buildJsonObject {
                record.title?.let { put("title", it) }
                record.notes?.let { put("notes", it) }
                put("stages", buildJsonArray { record.stages.forEach { st -> add(buildJsonObject { put("startTime", st.startTime.iso()); put("endTime", st.endTime.iso()); put("stage", st.stage) }) } })
            },
            interval(record.startTime, record.startZoneOffset, record.endTime, record.endZoneOffset),
        )
        is BloodPressureRecord -> base(
            record,
            "BloodPressure",
            buildJsonObject {
                put("systolicMmHg", record.systolic.inMillimetersOfMercury)
                put("diastolicMmHg", record.diastolic.inMillimetersOfMercury)
                put("bodyPosition", record.bodyPosition)
                put("measurementLocation", record.measurementLocation)
            },
            instant(record.time, record.zoneOffset),
        )
        is WeightRecord -> base(record, "Weight", buildJsonObject { put("kg", record.weight.inKilograms) }, instant(record.time, record.zoneOffset))
        is BodyFatRecord -> base(record, "BodyFat", buildJsonObject { put("percentage", record.percentage.value) }, instant(record.time, record.zoneOffset))
        is LeanBodyMassRecord -> base(record, "LeanBodyMass", buildJsonObject { put("kg", record.mass.inKilograms) }, instant(record.time, record.zoneOffset))
        is HeightRecord -> base(record, "Height", buildJsonObject { put("meters", record.height.inMeters) }, instant(record.time, record.zoneOffset))
        is BloodGlucoseRecord -> base(
            record,
            "BloodGlucose",
            buildJsonObject {
                put("mgPerDl", record.level.inMilligramsPerDeciliter)
                put("mmolPerL", record.level.inMillimolesPerLiter)
                put("specimenSource", record.specimenSource)
                put("mealType", record.mealType)
                put("relationToMeal", record.relationToMeal)
            },
            instant(record.time, record.zoneOffset),
        )
        is NutritionRecord -> base(
            record,
            "Nutrition",
            buildJsonObject {
                record.name?.let { put("name", it) }
                put("mealType", record.mealType)
                put("energyKcal", num(record.energy?.inKilocalories))
                put("proteinG", num(record.protein?.inGrams))
                put("carbsG", num(record.totalCarbohydrate?.inGrams))
                put("totalFatG", num(record.totalFat?.inGrams))
                put("saturatedFatG", num(record.saturatedFat?.inGrams))
                put("fiberG", num(record.dietaryFiber?.inGrams))
                put("sodiumMg", num(record.sodium?.inMilligrams))
                put("potassiumMg", num(record.potassium?.inMilligrams))
                put("sugarG", num(record.sugar?.inGrams))
            },
            interval(record.startTime, record.startZoneOffset, record.endTime, record.endZoneOffset),
        )
        is HydrationRecord -> base(record, "Hydration", buildJsonObject { put("liters", record.volume.inLiters) }, interval(record.startTime, record.startZoneOffset, record.endTime, record.endZoneOffset))
        is ExerciseSessionRecord -> base(
            record,
            "ExerciseSession",
            buildJsonObject {
                put("exerciseType", record.exerciseType)
                put("exerciseTypeName", exerciseTypeNames[record.exerciseType] ?: JsonNull.toString().let { "UNKNOWN" })
                record.title?.let { put("title", it) }
                record.notes?.let { put("notes", it) }
                put("segments", buildJsonArray { record.segments.forEach { s -> add(buildJsonObject { put("startTime", s.startTime.iso()); put("endTime", s.endTime.iso()); put("segmentType", s.segmentType); put("repetitions", s.repetitions) }) } })
            },
            interval(record.startTime, record.startZoneOffset, record.endTime, record.endZoneOffset),
        )
        is RespiratoryRateRecord -> base(record, "RespiratoryRate", buildJsonObject { put("rate", record.rate) }, instant(record.time, record.zoneOffset))
        is OxygenSaturationRecord -> base(record, "OxygenSaturation", buildJsonObject { put("percentage", record.percentage.value) }, instant(record.time, record.zoneOffset))
        is Vo2MaxRecord -> base(record, "Vo2Max", buildJsonObject { put("mlPerKgPerMin", record.vo2MillilitersPerMinuteKilogram); put("measurementMethod", record.measurementMethod) }, instant(record.time, record.zoneOffset))
        is ActiveCaloriesBurnedRecord -> base(record, "ActiveCaloriesBurned", buildJsonObject { put("kcal", record.energy.inKilocalories) }, interval(record.startTime, record.startZoneOffset, record.endTime, record.endZoneOffset))
        is TotalCaloriesBurnedRecord -> base(record, "TotalCaloriesBurned", buildJsonObject { put("kcal", record.energy.inKilocalories) }, interval(record.startTime, record.startZoneOffset, record.endTime, record.endZoneOffset))
        is BodyTemperatureRecord -> base(record, "BodyTemperature", buildJsonObject { put("celsius", record.temperature.inCelsius); put("measurementLocation", record.measurementLocation) }, instant(record.time, record.zoneOffset))
        else -> null
    }

    @Suppress("unused")
    private val keepArrayImport: JsonArray? = null
}
