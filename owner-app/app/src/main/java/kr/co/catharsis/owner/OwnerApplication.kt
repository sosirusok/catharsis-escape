package kr.co.catharsis.owner

import android.app.Application
import kr.co.catharsis.owner.data.AlertRepository
import kr.co.catharsis.owner.notifications.AppNotificationManager
import kr.co.catharsis.owner.push.FirebaseBootstrap
import kr.co.catharsis.owner.sync.SyncScheduler

class OwnerApplication : Application() {
    val repository: AlertRepository by lazy { AlertRepository(this) }

    override fun onCreate() {
        super.onCreate()
        FirebaseBootstrap.initialize(this)
        AppNotificationManager(this).createChannels()
        repository.loadLocalHistory()
        if (repository.hasDeviceToken()) {
            SyncScheduler.schedule(this)
            SyncScheduler.registerPush(this)
        }
    }
}
