package com.benhealthos.app.data.local

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
    entities = [CachedObservationEntity::class, SyncStateEntity::class, PendingUploadEntity::class, RemoteCacheEntity::class, SyncLogEntity::class],
    version = 1,
    exportSchema = true,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun cachedObservations(): CachedObservationDao
    abstract fun syncState(): SyncStateDao
    abstract fun pendingUploads(): PendingUploadDao
    abstract fun remoteCache(): RemoteCacheDao
    abstract fun syncLog(): SyncLogDao

    suspend fun clearAll() {
        cachedObservations().clear()
        syncState().clear()
        pendingUploads().clear()
        remoteCache().clear()
        syncLog().clear()
    }
}
