package com.benhealthos.app.domain

import com.benhealthos.app.data.local.AppDatabase
import com.benhealthos.app.data.local.RemoteCacheEntity
import com.benhealthos.app.data.remote.ApiClient
import com.benhealthos.app.data.remote.SeriesDto
import com.benhealthos.app.data.remote.SourcesDto
import com.benhealthos.app.data.remote.TodayDto
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import java.io.IOException
import java.time.Instant

/** Loaded data plus whether it came from the network or the offline cache (and when it was fetched). */
data class Cached<T>(val value: T, val fetchedAt: String, val fromCache: Boolean, val error: String? = null)

/** Network-first repository with an offline cache of the last good response. No health math here. */
class DashboardRepository(private val api: ApiClient, private val db: AppDatabase, private val json: Json) {
    suspend fun today(): Cached<TodayDto> = load("today", TodayDto.serializer()) { api.today() }
    suspend fun sources(): Cached<SourcesDto> = load("sources", SourcesDto.serializer()) { api.sources() }
    suspend fun series(metricId: String, days: Int): Cached<SeriesDto> {
        val to = Instant.now()
        val from = to.minusSeconds(days.toLong() * 86_400)
        return load("series:$metricId:$days", SeriesDto.serializer()) { api.series(metricId, from.toString(), to.toString()) }
    }

    private suspend fun <T> load(key: String, serializer: KSerializer<T>, fetch: suspend () -> T): Cached<T> {
        return try {
            val value = fetch()
            val now = Instant.now().toString()
            db.remoteCache().put(RemoteCacheEntity(key, json.encodeToString(serializer, value), now))
            Cached(value, now, fromCache = false)
        } catch (e: Exception) {
            val cached = db.remoteCache().get(key) ?: throw e
            val value = json.decodeFromString(serializer, cached.json)
            Cached(value, cached.fetchedAt, fromCache = true, error = (e as? IOException)?.message ?: e.message)
        }
    }
}
