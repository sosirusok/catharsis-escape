package kr.co.catharsis.owner.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kr.co.catharsis.owner.OwnerApplication
import kr.co.catharsis.owner.data.SyncOutcome

class AlertSyncWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val repository = (applicationContext as OwnerApplication).repository
        return when (repository.sync(notifyNew = true)) {
            SyncOutcome.SUCCESS -> Result.success()
            SyncOutcome.UNPAIRED -> Result.failure()
            SyncOutcome.RETRY -> Result.retry()
        }
    }
}
