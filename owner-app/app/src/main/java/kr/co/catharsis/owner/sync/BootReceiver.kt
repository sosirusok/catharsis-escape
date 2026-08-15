package kr.co.catharsis.owner.sync

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.content.ContextCompat
import kr.co.catharsis.owner.OwnerApplication

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(
        context: Context,
        intent: Intent?,
    ) {
        val application = context.applicationContext as OwnerApplication
        if (!application.repository.hasDeviceToken()) return

        SyncScheduler.schedule(context)
        SyncScheduler.runNow(context)

        // Android 15 blocks a data-sync foreground service launched directly from boot.
        // WorkManager restores background checking there; opening the app resumes 30-second polling.
        if (!application.repository.hasPushRegistration() && Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            ContextCompat.startForegroundService(
                context,
                Intent(context, AlertPollingService::class.java),
            )
        }
    }
}
