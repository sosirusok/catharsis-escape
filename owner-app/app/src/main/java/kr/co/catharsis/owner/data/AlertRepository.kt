package kr.co.catharsis.owner.data

import android.content.Context
import android.content.Intent
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.tasks.await
import kr.co.catharsis.owner.notifications.AppNotificationManager
import kr.co.catharsis.owner.push.FirebaseBootstrap
import kr.co.catharsis.owner.security.KeystoreTokenStore
import kr.co.catharsis.owner.sync.AlertPollingService
import kr.co.catharsis.owner.sync.SyncScheduler
import java.time.Instant

class AlertRepository(
    context: Context,
) {
    private val appContext = context.applicationContext
    private val api = OwnerApi()
    private val database = AlertDatabaseHelper(appContext)
    private val tokenStore = KeystoreTokenStore(appContext)
    private val notifier = AppNotificationManager(appContext)
    private val preferences = appContext.getSharedPreferences(SYNC_PREFERENCES, Context.MODE_PRIVATE)
    private val syncMutex = Mutex()

    private val _alerts = MutableStateFlow<List<BookingAlert>>(emptyList())
    val alerts: StateFlow<List<BookingAlert>> = _alerts.asStateFlow()

    private val _isPaired = MutableStateFlow(tokenStore.get() != null)
    val isPaired: StateFlow<Boolean> = _isPaired.asStateFlow()

    private val _connection =
        MutableStateFlow<ConnectionState>(
            if (_isPaired.value) ConnectionState.Idle else ConnectionState.PairingRequired,
        )
    val connection: StateFlow<ConnectionState> = _connection.asStateFlow()

    fun hasDeviceToken(): Boolean = tokenStore.get() != null

    fun hasPushRegistration(): Boolean =
        FirebaseBootstrap.isConfigured && preferences.getBoolean(KEY_PUSH_REGISTERED, false)

    fun loadLocalHistory() {
        database.pruneExpired()
        _alerts.value = database.all()
    }

    suspend fun pair(
        accessKey: String,
        deviceName: String,
    ) = withContext(Dispatchers.IO) {
        require(accessKey.isNotBlank()) { "운영 키를 입력해 주세요." }
        require(deviceName.isNotBlank()) { "장치 이름을 입력해 주세요." }
        _connection.value = ConnectionState.Syncing
        try {
            val token = api.pair(accessKey.trim(), deviceName.trim())
            tokenStore.save(token)
            preferences.edit().putBoolean(KEY_INITIAL_SYNC, false).putBoolean(KEY_PUSH_REGISTERED, false).apply()
            _isPaired.value = true
            _connection.value = ConnectionState.Idle
            SyncScheduler.schedule(appContext)
            SyncScheduler.registerPush(appContext)
            sync(notifyNew = false)
        } catch (error: Throwable) {
            _connection.value = ConnectionState.Error(error.userMessage())
            throw error
        }
    }

    suspend fun registerPushInstallation(installationId: String): SyncOutcome =
        withContext(Dispatchers.IO) {
            val token = tokenStore.get() ?: return@withContext SyncOutcome.UNPAIRED
            try {
                api.registerPushInstallation(token, installationId)
                preferences.edit().putBoolean(KEY_PUSH_REGISTERED, true).apply()
                appContext.stopService(Intent(appContext, AlertPollingService::class.java))
                SyncOutcome.SUCCESS
            } catch (error: ApiException) {
                if (error.statusCode == 401 || error.statusCode == 403) {
                    invalidatePairing()
                    SyncOutcome.UNPAIRED
                } else {
                    SyncOutcome.RETRY
                }
            } catch (_: Throwable) {
                SyncOutcome.RETRY
            }
        }

    suspend fun sync(notifyNew: Boolean = true): SyncOutcome =
        withContext(Dispatchers.IO) {
            syncMutex.withLock {
                val token = tokenStore.get()
                if (token == null) {
                    _isPaired.value = false
                    _connection.value = ConnectionState.PairingRequired
                    return@withLock SyncOutcome.UNPAIRED
                }

                _connection.value = ConnectionState.Syncing
                try {
                    var cursor = database.maxId()
                    val firstSync = !preferences.getBoolean(KEY_INITIAL_SYNC, false)
                    val newlyInserted = mutableListOf<BookingAlert>()
                    var reachedNewestAlert = false

                    var pagesRemaining = MAX_PAGES_PER_SYNC
                    while (pagesRemaining-- > 0) {
                        val page = api.fetchAlerts(token, after = cursor, limit = PAGE_SIZE)
                        if (page.alerts.isEmpty()) {
                            reachedNewestAlert = true
                            break
                        }

                        newlyInserted += database.upsert(page.alerts)
                        val nextCursor = page.alerts.maxOf { it.id }
                        if (nextCursor <= cursor) {
                            break
                        }
                        cursor = nextCursor
                        if (!page.hasMore) {
                            reachedNewestAlert = true
                            break
                        }
                    }

                    database.pruneExpired()
                    _alerts.value = database.all()
                    if (reachedNewestAlert) {
                        preferences.edit().putBoolean(KEY_INITIAL_SYNC, true).apply()
                    }
                    if (notifyNew && !firstSync) {
                        newlyInserted.takeLast(MAX_NOTIFICATIONS_PER_SYNC).forEach(notifier::show)
                    }
                    _connection.value = ConnectionState.Connected(Instant.now())
                    SyncOutcome.SUCCESS
                } catch (error: ApiException) {
                    if (error.statusCode == 401 || error.statusCode == 403) {
                        invalidatePairing()
                        SyncOutcome.UNPAIRED
                    } else {
                        _connection.value = ConnectionState.Error(error.userMessage())
                        SyncOutcome.RETRY
                    }
                } catch (error: Throwable) {
                    _connection.value = ConnectionState.Error(error.userMessage())
                    SyncOutcome.RETRY
                }
            }
        }

    suspend fun markRead(id: Long) =
        withContext(Dispatchers.IO) {
            database.markRead(id)
            _alerts.value = database.all()
        }

    suspend fun disconnect() =
        withContext(Dispatchers.IO) {
            tokenStore.get()?.let { token -> runCatching { api.unpair(token) } }
            if (FirebaseBootstrap.isConfigured) {
                try {
                    FirebaseMessaging.getInstance().unregister().await()
                } catch (_: Throwable) {
                    // The server-side device revocation above is authoritative.
                }
            }
            tokenStore.clear()
            preferences.edit().clear().apply()
            database.clear()
            _alerts.value = emptyList()
            _isPaired.value = false
            _connection.value = ConnectionState.PairingRequired
            SyncScheduler.cancel(appContext)
            appContext.stopService(Intent(appContext, AlertPollingService::class.java))
        }

    private fun invalidatePairing() {
        tokenStore.clear()
        preferences.edit().clear().apply()
        _isPaired.value = false
        _connection.value = ConnectionState.PairingRequired
        SyncScheduler.cancel(appContext)
        appContext.stopService(Intent(appContext, AlertPollingService::class.java))
    }

    private fun Throwable.userMessage(): String =
        when (this) {
            is ApiException -> message ?: "서버 연결을 확인해 주세요."
            is IllegalArgumentException -> message ?: "입력 내용을 확인해 주세요."
            else -> "네트워크 연결을 확인해 주세요."
        }

    companion object {
        private const val SYNC_PREFERENCES = "owner_sync_state"
        private const val KEY_INITIAL_SYNC = "initial_sync_complete"
        private const val KEY_PUSH_REGISTERED = "push_registration_complete"
        private const val PAGE_SIZE = 100
        private const val MAX_PAGES_PER_SYNC = 5
        private const val MAX_NOTIFICATIONS_PER_SYNC = 8
    }
}

enum class SyncOutcome {
    SUCCESS,
    UNPAIRED,
    RETRY,
}

sealed interface ConnectionState {
    data object PairingRequired : ConnectionState

    data object Idle : ConnectionState

    data object Syncing : ConnectionState

    data class Connected(
        val at: Instant,
    ) : ConnectionState

    data class Error(
        val message: String,
    ) : ConnectionState
}
