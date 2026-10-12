package com.benhealthos.app.data.local

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.benhealthos.app.BuildConfig
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.runBlocking
import java.util.UUID

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "bho_settings")

/** Non-secret app settings (DataStore). Secrets live in SecureStore. */
class SettingsStore(private val context: Context) {
    private object Keys {
        val apiBaseUrl = stringPreferencesKey("api_base_url")
        val deviceInstanceId = stringPreferencesKey("device_instance_id")
        val biometricLock = booleanPreferencesKey("biometric_lock")
        val onboardingDone = booleanPreferencesKey("onboarding_done")
        val lastSyncReportAt = stringPreferencesKey("last_sync_report_at")
    }

    val apiBaseUrl: Flow<String> = context.dataStore.data.map { it[Keys.apiBaseUrl] ?: BuildConfig.API_BASE_URL }
    val biometricLock: Flow<Boolean> = context.dataStore.data.map { it[Keys.biometricLock] ?: true }
    val onboardingDone: Flow<Boolean> = context.dataStore.data.map { it[Keys.onboardingDone] ?: false }

    fun apiBaseUrlBlocking(): String = runBlocking { apiBaseUrl.first() }

    suspend fun setApiBaseUrl(url: String) = context.dataStore.edit { it[Keys.apiBaseUrl] = url.trimEnd('/') }
    suspend fun setBiometricLock(enabled: Boolean) = context.dataStore.edit { it[Keys.biometricLock] = enabled }
    suspend fun setOnboardingDone(done: Boolean) = context.dataStore.edit { it[Keys.onboardingDone] = done }

    /** Stable per-install id (random UUID, not a hardware identifier). */
    suspend fun deviceInstanceId(): String {
        val existing = context.dataStore.data.map { it[Keys.deviceInstanceId] }.first()
        if (existing != null) return existing
        val id = "android-" + UUID.randomUUID().toString()
        context.dataStore.edit { it[Keys.deviceInstanceId] = id }
        return id
    }
}
