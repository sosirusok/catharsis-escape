package kr.co.catharsis.owner.push

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kr.co.catharsis.owner.notifications.AppNotificationManager
import kr.co.catharsis.owner.sync.SyncScheduler

class OwnerFirebaseMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        val alertId = PushSignal.alertId(message.data) ?: return
        AppNotificationManager(this).showPushSignal(alertId, message.data["kind"].orEmpty())
        SyncScheduler.runNow(applicationContext)
    }

    override fun onDeletedMessages() {
        SyncScheduler.runNow(applicationContext)
    }

    override fun onRegistered(installationId: String) {
        if (installationId.isNotBlank()) SyncScheduler.registerPush(applicationContext)
    }
}
