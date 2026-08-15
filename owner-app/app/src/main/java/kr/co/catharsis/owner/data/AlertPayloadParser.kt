package kr.co.catharsis.owner.data

import org.json.JSONObject

object AlertPayloadParser {
    fun parsePage(
        payload: String,
        pageSize: Int = 100,
    ): AlertPage {
        val root = JSONObject(payload)
        if (!root.optBoolean("ok", false)) {
            throw ApiException(root.optString("message", "예약 알림을 불러오지 못했습니다."))
        }

        val result = mutableListOf<BookingAlert>()
        val alerts =
            root.optJSONArray("alerts")
                ?: return AlertPage(emptyList(), hasMore = false)
        for (index in 0 until alerts.length()) {
            val alert = alerts.getJSONObject(index)
            val reservation = alert.getJSONObject("reservation")
            result +=
                BookingAlert(
                    id = alert.getLong("id"),
                    type = alert.optString("type", "BOOKING_CONFIRMED"),
                    createdAt = alert.optString("createdAt"),
                    reservation =
                        ReservationSummary(
                            bookingCode = reservation.optString("bookingCode"),
                            themeName = reservation.optString("themeName"),
                            serviceDate = reservation.optString("serviceDate"),
                            time = reservation.optString("time"),
                            partySize = reservation.optInt("partySize"),
                            name = reservation.optString("name"),
                            phone =
                                reservation.optString("phone").ifBlank {
                                    reservation.optString("phoneLast4").let { last4 ->
                                        if (last4.isBlank()) "" else "****-$last4"
                                    }
                                },
                            amount = reservation.optLong("amount"),
                            paymentStatus = reservation.optString("paymentStatus"),
                        ),
                )
        }
        return AlertPage(
            alerts = result.sortedBy { it.id },
            hasMore =
                if (root.has("hasMore")) {
                    root.optBoolean("hasMore")
                } else {
                    alerts.length() >= pageSize
                },
        )
    }

    fun parseAlerts(payload: String): List<BookingAlert> = parsePage(payload).alerts
}

data class AlertPage(
    val alerts: List<BookingAlert>,
    val hasMore: Boolean,
)

class ApiException(
    message: String,
    val statusCode: Int? = null,
) : Exception(message)
