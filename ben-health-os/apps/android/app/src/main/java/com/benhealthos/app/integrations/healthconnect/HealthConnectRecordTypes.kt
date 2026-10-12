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
import kotlin.reflect.KClass

/**
 * Record types Ben Health OS reads, keyed by the contract's recordType name. The list is driven by
 * the data the product needs (spec §7); each maps 1:1 to a read permission that the user can grant
 * or deny individually. SkinTemperatureRecord is feature-gated and added in a later phase.
 */
object HealthConnectRecordTypes {
    val ALL: Map<String, KClass<out Record>> = linkedMapOf(
        "Steps" to StepsRecord::class,
        "Distance" to DistanceRecord::class,
        "HeartRate" to HeartRateRecord::class,
        "RestingHeartRate" to RestingHeartRateRecord::class,
        "HeartRateVariabilityRmssd" to HeartRateVariabilityRmssdRecord::class,
        "SleepSession" to SleepSessionRecord::class,
        "BloodPressure" to BloodPressureRecord::class,
        "Weight" to WeightRecord::class,
        "BodyFat" to BodyFatRecord::class,
        "LeanBodyMass" to LeanBodyMassRecord::class,
        "Height" to HeightRecord::class,
        "BloodGlucose" to BloodGlucoseRecord::class,
        "Nutrition" to NutritionRecord::class,
        "Hydration" to HydrationRecord::class,
        "ExerciseSession" to ExerciseSessionRecord::class,
        "RespiratoryRate" to RespiratoryRateRecord::class,
        "OxygenSaturation" to OxygenSaturationRecord::class,
        "Vo2Max" to Vo2MaxRecord::class,
        "ActiveCaloriesBurned" to ActiveCaloriesBurnedRecord::class,
        "TotalCaloriesBurned" to TotalCaloriesBurnedRecord::class,
        "BodyTemperature" to BodyTemperatureRecord::class,
    )

    fun nameOf(type: KClass<out Record>): String = ALL.entries.first { it.value == type }.key
}
