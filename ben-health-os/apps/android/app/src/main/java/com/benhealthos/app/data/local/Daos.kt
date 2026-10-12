package com.benhealthos.app.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface CachedObservationDao {
    @Upsert suspend fun upsertAll(items: List<CachedObservationEntity>)

    @Query("select * from cached_observations where metricId = :metricId order by measuredAt desc limit :limit")
    suspend fun latest(metricId: String, limit: Int = 30): List<CachedObservationEntity>

    @Query("select count(*) from cached_observations") fun count(): Flow<Int>

    @Query("delete from cached_observations where hcId = :hcId") suspend fun deleteByHcId(hcId: String)

    @Query("delete from cached_observations") suspend fun clear()
}

@Dao
interface SyncStateDao {
    @Query("select * from sync_state") fun observeAll(): Flow<List<SyncStateEntity>>

    @Query("select * from sync_state") suspend fun all(): List<SyncStateEntity>

    @Query("select * from sync_state where recordType = :recordType") suspend fun get(recordType: String): SyncStateEntity?

    @Upsert suspend fun upsert(state: SyncStateEntity)

    @Query("delete from sync_state") suspend fun clear()
}

@Dao
interface PendingUploadDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun insert(item: PendingUploadEntity): Long

    @Query("select * from pending_uploads order by id asc limit :limit") suspend fun oldest(limit: Int = 20): List<PendingUploadEntity>

    @Query("select count(*) from pending_uploads") fun count(): Flow<Int>

    @Query("update pending_uploads set attempts = attempts + 1, lastError = :error where id = :id") suspend fun markFailed(id: Long, error: String?)

    @Query("delete from pending_uploads where id = :id") suspend fun delete(id: Long)

    @Query("delete from pending_uploads") suspend fun clear()
}

@Dao
interface RemoteCacheDao {
    @Query("select * from remote_cache where `key` = :key") suspend fun get(key: String): RemoteCacheEntity?

    @Query("select * from remote_cache where `key` = :key") fun observe(key: String): Flow<RemoteCacheEntity?>

    @Upsert suspend fun put(entity: RemoteCacheEntity)

    @Query("delete from remote_cache") suspend fun clear()
}

@Dao
interface SyncLogDao {
    @Insert suspend fun insert(entry: SyncLogEntity)

    @Query("select * from sync_log order by id desc limit :limit") fun recent(limit: Int = 20): Flow<List<SyncLogEntity>>

    @Query("delete from sync_log where id not in (select id from sync_log order by id desc limit 200)") suspend fun trim()

    @Query("delete from sync_log") suspend fun clear()
}
