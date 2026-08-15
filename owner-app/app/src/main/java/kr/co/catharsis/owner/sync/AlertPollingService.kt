package kr.co.catharsis.owner.sync

import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.annotation.RequiresApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kr.co.catharsis.owner.OwnerApplication
import kr.co.catharsis.owner.data.SyncOutcome
import kr.co.catharsis.owner.notifications.AppNotificationManager

class AlertPollingService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var pollingJob: Job? = null

    override fun onCreate() {
        super.onCreate()
        val notificationManager = AppNotificationManager(this)
        notificationManager.createChannels()
        startForeground(
            AppNotificationManager.SERVICE_NOTIFICATION_ID,
            notificationManager.serviceNotification(),
        )
    }

    override fun onStartCommand(
        intent: Intent?,
        flags: Int,
        startId: Int,
    ): Int {
        if (pollingJob?.isActive != true) {
            pollingJob =
                scope.launch {
                    val repository = (application as OwnerApplication).repository
                    while (isActive) {
                        if (repository.sync(notifyNew = true) == SyncOutcome.UNPAIRED) {
                            stopSelf()
                            break
                        }
                        delay(POLL_INTERVAL_MILLIS)
                    }
                }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        pollingJob?.cancel()
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    @RequiresApi(Build.VERSION_CODES.VANILLA_ICE_CREAM)
    override fun onTimeout(
        startId: Int,
        fgsType: Int,
    ) {
        stopSelf(startId)
    }

    companion object {
        private const val POLL_INTERVAL_MILLIS = 30_000L
    }
}
