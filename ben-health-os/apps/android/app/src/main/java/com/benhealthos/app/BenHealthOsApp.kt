package com.benhealthos.app

import android.app.Application
import android.util.Log
import androidx.work.Configuration
import com.benhealthos.app.data.sync.SyncScheduler
import com.benhealthos.app.di.AppContainer
import com.benhealthos.app.notifications.NotificationChannels

class BenHealthOsApp : Application(), Configuration.Provider {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        NotificationChannels.ensure(this)
        SyncScheduler.ensurePeriodic(this)
    }

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().setMinimumLoggingLevel(Log.INFO).build()
}
