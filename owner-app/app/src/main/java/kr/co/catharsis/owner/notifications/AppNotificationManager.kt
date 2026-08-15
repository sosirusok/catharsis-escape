package kr.co.catharsis.owner.notifications

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import kr.co.catharsis.owner.MainActivity
import kr.co.catharsis.owner.R
import kr.co.catharsis.owner.data.BookingAlert

class AppNotificationManager(
    private val context: Context,
) {
    fun createChannels() {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannels(
            listOf(
                NotificationChannel(
                    BOOKINGS_CHANNEL,
                    context.getString(R.string.booking_channel_name),
                    NotificationManager.IMPORTANCE_HIGH,
                ).apply {
                    description = "결제가 완료되어 확정된 새 예약을 알려드립니다."
                    enableVibration(true)
                },
                NotificationChannel(
                    SERVICE_CHANNEL,
                    context.getString(R.string.service_channel_name),
                    NotificationManager.IMPORTANCE_LOW,
                ).apply {
                    description = "새 예약을 빠르게 확인하기 위한 연결 상태입니다."
                    setShowBadge(false)
                },
            ),
        )
    }

    fun serviceNotification(): Notification =
        NotificationCompat
            .Builder(context, SERVICE_CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("카타르시스 예약 알림")
            .setContentText("새 예약을 확인하고 있습니다")
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(mainPendingIntent(0L))
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()

    fun show(alert: BookingAlert) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS,
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }

        val reservation = alert.reservation
        val eventTitle =
            when {
                alert.type.contains("CANCEL", ignoreCase = true) -> "예약 취소"
                alert.type.contains("REFUND", ignoreCase = true) -> "환불 완료"
                else -> "새 예약"
            }
        val notification =
            NotificationCompat
                .Builder(context, BOOKINGS_CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("$eventTitle · ${reservation.themeName}")
                .setContentText(
                    "${reservation.serviceDate} ${reservation.time} · ${reservation.partySize}명 · ${reservation.bookingCode}",
                ).setStyle(
                    NotificationCompat.BigTextStyle().bigText(
                        "${reservation.serviceDate} ${reservation.time} · ${reservation.partySize}명\n" +
                            "${reservation.name} · ${reservation.phone}\n" +
                            "예약번호 ${reservation.bookingCode}",
                    ),
                ).setContentIntent(mainPendingIntent(alert.id))
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .build()

        NotificationManagerCompat.from(context).notify(notificationId(alert.id), notification)
    }

    fun showPushSignal(
        alertId: Long,
        kind: String,
    ) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS,
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        val changed = kind.contains("cancel", ignoreCase = true) || kind.contains("refund", ignoreCase = true)
        val notification =
            NotificationCompat
                .Builder(context, BOOKINGS_CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(if (changed) "예약 상태가 변경되었습니다" else "새 예약이 들어왔습니다")
                .setContentText("앱에서 예약 내용을 확인해 주세요.")
                .setContentIntent(mainPendingIntent(alertId))
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .build()
        NotificationManagerCompat.from(context).notify(notificationId(alertId), notification)
    }

    private fun mainPendingIntent(alertId: Long): PendingIntent {
        val intent =
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
                if (alertId > 0) putExtra(MainActivity.EXTRA_ALERT_ID, alertId)
            }
        return PendingIntent.getActivity(
            context,
            alertId.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun notificationId(alertId: Long): Int = 100_000 + ((alertId xor (alertId ushr 32)).toInt() and 0x0FFFFFFF)

    companion object {
        const val BOOKINGS_CHANNEL = "confirmed_bookings"
        const val SERVICE_CHANNEL = "booking_connection"
        const val SERVICE_NOTIFICATION_ID = 2101
    }
}
