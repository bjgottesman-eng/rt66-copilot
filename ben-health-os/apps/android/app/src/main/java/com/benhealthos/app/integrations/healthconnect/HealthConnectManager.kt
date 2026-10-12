package com.benhealthos.app.integrations.healthconnect

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.result.contract.ActivityResultContract
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.request.ChangesTokenRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.response.ChangesResponse
import androidx.health.connect.client.time.TimeRangeFilter
import java.time.Instant
import kotlin.reflect.KClass

enum class SdkAvailability { AVAILABLE, UNAVAILABLE, PROVIDER_UPDATE_REQUIRED }

/** Wraps HealthConnectClient: availability, permissions, paged reads and the changes API. */
class HealthConnectManager(private val context: Context) {
    val providerPackage: String = "com.google.android.apps.healthdata"

    val client: HealthConnectClient by lazy { HealthConnectClient.getOrCreate(context) }

    fun availability(): SdkAvailability = when (HealthConnectClient.getSdkStatus(context, providerPackage)) {
        HealthConnectClient.SDK_AVAILABLE -> SdkAvailability.AVAILABLE
        HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> SdkAvailability.PROVIDER_UPDATE_REQUIRED
        else -> SdkAvailability.UNAVAILABLE
    }

    /** Read permission per record type, keyed by contract record type name. */
    val readPermissions: Map<String, String> = HealthConnectRecordTypes.ALL.mapValues { (_, cls) -> HealthPermission.getReadPermission(cls) }

    val backgroundPermission: String = HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND
    val historyPermission: String = HealthPermission.PERMISSION_READ_HEALTH_DATA_HISTORY

    fun isBackgroundReadSupported(): Boolean = featureAvailable(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND)
    fun isHistoryReadSupported(): Boolean = featureAvailable(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_HISTORY)

    private fun featureAvailable(feature: Int): Boolean = runCatching {
        client.features.getFeatureStatus(feature) == HealthConnectFeatures.FEATURE_STATUS_AVAILABLE
    }.getOrDefault(false)

    /** Everything we ask for: per-type read permissions plus background/history reads where the platform supports them. */
    fun requestablePermissions(): Set<String> {
        val set = readPermissions.values.toMutableSet()
        if (isBackgroundReadSupported()) set += backgroundPermission
        if (isHistoryReadSupported()) set += historyPermission
        return set
    }

    suspend fun grantedPermissions(): Set<String> = client.permissionController.getGrantedPermissions()

    fun permissionContract(): ActivityResultContract<Set<String>, Set<String>> = PermissionController.createRequestPermissionResultContract()

    suspend fun revokeAllPermissions() = client.permissionController.revokeAllPermissions()

    /** Reads every record of a type in a time range, following page tokens. */
    @Suppress("UNCHECKED_CAST")
    suspend fun readAll(type: KClass<out Record>, start: Instant, end: Instant, pageSize: Int = 1000): List<Record> {
        val out = ArrayList<Record>()
        var pageToken: String? = null
        do {
            val request = ReadRecordsRequest(
                recordType = type as KClass<Record>,
                timeRangeFilter = TimeRangeFilter.between(start, end),
                pageSize = pageSize,
                pageToken = pageToken,
            )
            val response = client.readRecords(request)
            out += response.records
            pageToken = response.pageToken
        } while (pageToken != null)
        return out
    }

    /** One token per record type, as recommended, so a single revoked permission does not break the others. */
    suspend fun changesToken(type: KClass<out Record>): String = client.getChangesToken(ChangesTokenRequest(recordTypes = setOf(type)))

    suspend fun changes(token: String): ChangesResponse = client.getChanges(token)

    /** Play Store deep link that opens Health Connect onboarding (from the official docs). */
    fun installIntent(): Intent = Intent(Intent.ACTION_VIEW).apply {
        setPackage("com.android.vending")
        data = Uri.parse("market://details?id=$providerPackage&url=healthconnect%3A%2F%2Fonboarding")
        putExtra("overlay", true)
        putExtra("callerId", context.packageName)
    }

    fun settingsIntent(): Intent = Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS)
}
