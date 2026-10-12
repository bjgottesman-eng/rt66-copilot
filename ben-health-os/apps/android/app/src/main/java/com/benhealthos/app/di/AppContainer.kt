package com.benhealthos.app.di

import android.content.Context
import androidx.room.Room
import com.benhealthos.app.data.local.AppDatabase
import com.benhealthos.app.data.local.SettingsStore
import com.benhealthos.app.data.remote.ApiClient
import com.benhealthos.app.data.sync.HealthConnectSyncer
import com.benhealthos.app.domain.DashboardRepository
import com.benhealthos.app.domain.SharedConfig
import com.benhealthos.app.integrations.healthconnect.HealthConnectManager
import com.benhealthos.app.security.SecureStore
import kotlinx.serialization.json.Json

/** Manual dependency container (no DI framework): one instance per process, created in Application. */
class AppContainer(private val context: Context) {
    val json: Json = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = false; isLenient = true }

    val database: AppDatabase by lazy {
        Room.databaseBuilder(context, AppDatabase::class.java, "ben-health-os.db")
            .fallbackToDestructiveMigration(true)
            .build()
    }
    val secureStore: SecureStore by lazy { SecureStore(context) }
    val settings: SettingsStore by lazy { SettingsStore(context) }
    val sharedConfig: SharedConfig by lazy { SharedConfig.load(context, json) }
    val api: ApiClient by lazy { ApiClient(json = json, baseUrl = { settings.apiBaseUrlBlocking() }, token = { secureStore.token }) }
    val healthConnect: HealthConnectManager by lazy { HealthConnectManager(context) }
    val syncer: HealthConnectSyncer by lazy { HealthConnectSyncer(context, healthConnect, api, database, settings, json) }
    val dashboard: DashboardRepository by lazy { DashboardRepository(api, database, json) }
}

val Context.appContainer: AppContainer
    get() = (applicationContext as com.benhealthos.app.BenHealthOsApp).container
