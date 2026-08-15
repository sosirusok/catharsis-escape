package kr.co.catharsis.owner.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.google.firebase.installations.FirebaseInstallations
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.tasks.await
import kr.co.catharsis.owner.OwnerApplication
import kr.co.catharsis.owner.data.SyncOutcome
import kr.co.catharsis.owner.push.FirebaseBootstrap

class PushRegistrationWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        if (!FirebaseBootstrap.isConfigured) return Result.success()
        val repository = (applicationContext as OwnerApplication).repository
        if (!repository.hasDeviceToken()) return Result.success()
        return try {
            FirebaseMessaging.getInstance().register().await()
            val installationId = FirebaseInstallations.getInstance().id.await()
            when (repository.registerPushInstallation(installationId)) {
                SyncOutcome.SUCCESS -> Result.success()
                SyncOutcome.UNPAIRED -> Result.failure()
                SyncOutcome.RETRY -> Result.retry()
            }
        } catch (_: Throwable) {
            Result.retry()
        }
    }
}
