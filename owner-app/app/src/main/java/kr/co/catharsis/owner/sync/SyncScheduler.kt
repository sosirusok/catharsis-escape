package kr.co.catharsis.owner.sync

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

object SyncScheduler {
    private const val PERIODIC_WORK = "owner_alert_periodic_sync"
    private const val IMMEDIATE_WORK = "owner_alert_immediate_sync"
    private const val PUSH_REGISTRATION_WORK = "owner_push_registration"

    fun schedule(context: Context) {
        val constraints =
            Constraints
                .Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
        val periodic =
            PeriodicWorkRequestBuilder<AlertSyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            PERIODIC_WORK,
            ExistingPeriodicWorkPolicy.UPDATE,
            periodic,
        )
    }

    fun runNow(context: Context) {
        val request =
            OneTimeWorkRequestBuilder<AlertSyncWorker>()
                .setConstraints(
                    Constraints
                        .Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build(),
                ).setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            IMMEDIATE_WORK,
            androidx.work.ExistingWorkPolicy.REPLACE,
            request,
        )
    }

    fun registerPush(context: Context) {
        val request =
            OneTimeWorkRequestBuilder<PushRegistrationWorker>()
                .setConstraints(
                    Constraints
                        .Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build(),
                ).build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            PUSH_REGISTRATION_WORK,
            androidx.work.ExistingWorkPolicy.REPLACE,
            request,
        )
    }

    fun cancel(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(PERIODIC_WORK)
        WorkManager.getInstance(context).cancelUniqueWork(IMMEDIATE_WORK)
        WorkManager.getInstance(context).cancelUniqueWork(PUSH_REGISTRATION_WORK)
    }
}
