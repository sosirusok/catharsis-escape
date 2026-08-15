package kr.co.catharsis.owner

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kr.co.catharsis.owner.sync.AlertPollingService
import kr.co.catharsis.owner.sync.SyncScheduler
import kr.co.catharsis.owner.ui.OwnerApp
import kr.co.catharsis.owner.ui.theme.CatharsisOwnerTheme

class MainActivity : ComponentActivity() {
    private val viewModel: MainViewModel by viewModels {
        MainViewModel.Factory((application as OwnerApplication).repository)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        intent.getLongExtra(EXTRA_ALERT_ID, 0L).takeIf { it > 0 }?.let(viewModel::selectAlert)

        setContent {
            CatharsisOwnerTheme {
                val context = LocalContext.current
                val isPaired by viewModel.isPaired.collectAsStateWithLifecycle()
                val permissionLauncher =
                    rememberLauncherForActivityResult(
                        ActivityResultContracts.RequestPermission(),
                    ) { startFastPollingIfPaired() }

                LaunchedEffect(isPaired) {
                    if (isPaired) {
                        SyncScheduler.schedule(context)
                        SyncScheduler.registerPush(context)
                        viewModel.refresh()
                        if (
                            Build.VERSION.SDK_INT >= 33 &&
                            ContextCompat.checkSelfPermission(
                                context,
                                Manifest.permission.POST_NOTIFICATIONS,
                            ) != PackageManager.PERMISSION_GRANTED
                        ) {
                            permissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                        } else {
                            startFastPollingIfPaired()
                        }
                    }
                }

                OwnerApp(
                    viewModel = viewModel,
                    defaultDeviceName = deviceName(),
                    onPaired = ::startFastPollingIfPaired,
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent.getLongExtra(EXTRA_ALERT_ID, 0L).takeIf { it > 0 }?.let(viewModel::selectAlert)
    }

    private fun startFastPollingIfPaired() {
        val repository = (application as OwnerApplication).repository
        if (!repository.hasDeviceToken()) return
        if (repository.hasPushRegistration()) {
            stopService(Intent(this, AlertPollingService::class.java))
            return
        }
        ContextCompat.startForegroundService(this, Intent(this, AlertPollingService::class.java))
    }

    private fun deviceName(): String =
        listOf(Build.MANUFACTURER, Build.MODEL)
            .filter { it.isNotBlank() }
            .joinToString(" ")
            .replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }

    companion object {
        const val EXTRA_ALERT_ID = "booking_alert_id"
    }
}
