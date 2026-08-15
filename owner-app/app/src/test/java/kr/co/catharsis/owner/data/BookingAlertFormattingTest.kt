package kr.co.catharsis.owner.data

import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Locale

class BookingAlertFormattingTest {
    @Test
    fun `formats payment states for the owner`() {
        assertEquals("결제 완료", "PAID".paymentStatusLabel())
        assertEquals("결제 취소", "CANCELED".paymentStatusLabel())
        assertEquals("환불 완료", "REFUNDED".paymentStatusLabel())
    }

    @Test
    fun `formats won amounts with thousands separators`() {
        val previous = Locale.getDefault()
        try {
            Locale.setDefault(Locale.KOREA)
            assertEquals("88,000원", 88_000L.toWon())
        } finally {
            Locale.setDefault(previous)
        }
    }
}
