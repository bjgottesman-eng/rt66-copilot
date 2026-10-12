package com.benhealthos.app.domain

import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable data class MetricDef(val id: String, val label: String, val domain: String, val unit: String, val precision: Int, val direction: String, val dailyAggregation: String, val metricClass: String)
@Serializable data class ConnectorDef(val id: String, val displayName: String, val integrationClass: String, val expectedSyncIntervalHours: Double, val metrics: List<String>, val phase: Int, val implementationStatus: String, val notes: String)
@Serializable private data class MetricCatalogFile(val version: Int, val domains: List<String>, val domainLabels: Map<String, String>, val metrics: List<MetricDef>)
@Serializable private data class ConnectorsFile(val version: Int, val connectors: List<ConnectorDef>)

/**
 * Display configuration generated from packages/shared-config at build time (assets/shared-config).
 * The app never recomputes health analytics from it; calculations live in the backend.
 */
class SharedConfig(val version: Int, val domains: List<String>, val domainLabels: Map<String, String>, val metrics: List<MetricDef>, val connectors: List<ConnectorDef>) {
    fun metric(id: String): MetricDef? = metrics.firstOrNull { it.id == id }

    companion object {
        fun load(context: Context, json: Json): SharedConfig {
            val catalog = json.decodeFromString(MetricCatalogFile.serializer(), context.assets.open("shared-config/metric-catalog.json").bufferedReader().readText())
            val connectors = json.decodeFromString(ConnectorsFile.serializer(), context.assets.open("shared-config/connectors.json").bufferedReader().readText())
            return SharedConfig(catalog.version, catalog.domains, catalog.domainLabels, catalog.metrics, connectors.connectors)
        }
    }
}
