package kr.co.catharsis.owner.data

data class ReservationSummary(
    val bookingCode: String,
    val themeName: String,
    val serviceDate: String,
    val time: String,
    val partySize: Int,
    val name: String,
    val phone: String,
    val amount: Long,
    val paymentStatus: String,
)

data class BookingAlert(
    val id: Long,
    val type: String,
    val createdAt: String,
    val reservation: ReservationSummary,
    val isRead: Boolean = false,
)

fun Long.toWon(): String = "%,d원".format(this)

fun String.paymentStatusLabel(): String =
    when (uppercase()) {
        "PAID", "DONE", "CONFIRMED" -> "결제 완료"
        "CANCELED", "CANCELLED" -> "결제 취소"
        "REFUNDED", "PARTIAL_REFUNDED" -> "환불 완료"
        "PENDING" -> "결제 확인 중"
        "FAILED" -> "결제 실패"
        else -> this
    }
