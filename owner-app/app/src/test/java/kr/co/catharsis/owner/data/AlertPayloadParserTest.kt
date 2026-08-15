package kr.co.catharsis.owner.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AlertPayloadParserTest {
    @Test
    fun `parses and sorts booking alerts by id`() {
        val payload =
            """
            {
              "ok": true,
              "alerts": [
                {
                  "id": 42,
                  "type": "BOOKING_CONFIRMED",
                  "createdAt": "2026-08-15T03:20:00.000Z",
                  "reservation": {
                    "bookingCode": "CAT-260815-0042",
                    "themeName": "검은 사제들",
                    "serviceDate": "2026-08-17",
                    "time": "18:30",
                    "partySize": 4,
                    "name": "김의현",
                    "phone": "010-1234-4321",
                    "amount": 88000,
                    "paymentStatus": "PAID"
                  }
                },
                {
                  "id": 40,
                  "type": "BOOKING_CONFIRMED",
                  "createdAt": "2026-08-15T03:10:00.000Z",
                  "reservation": {
                    "bookingCode": "CAT-260815-0040",
                    "themeName": "기억의 방",
                    "serviceDate": "2026-08-17",
                    "time": "16:00",
                    "partySize": 2,
                    "name": "예약자",
                    "phone": "010-5678-1234",
                    "amount": 44000,
                    "paymentStatus": "PAID"
                  }
                }
              ]
            }
            """.trimIndent()

        val alerts = AlertPayloadParser.parseAlerts(payload)

        assertEquals(listOf(40L, 42L), alerts.map { it.id })
        assertEquals("CAT-260815-0042", alerts.last().reservation.bookingCode)
        assertEquals(88_000L, alerts.last().reservation.amount)
        assertEquals("010-1234-4321", alerts.last().reservation.phone)
    }

    @Test
    fun `returns an empty list for an empty successful response`() {
        assertTrue(AlertPayloadParser.parseAlerts("""{"ok":true,"alerts":[]}""").isEmpty())
    }

    @Test
    fun `honors the server cursor flag`() {
        val page = AlertPayloadParser.parsePage("""{"ok":true,"alerts":[],"hasMore":true}""")
        assertTrue(page.hasMore)
    }

    @Test(expected = ApiException::class)
    fun `rejects an unsuccessful response`() {
        AlertPayloadParser.parseAlerts("""{"ok":false,"message":"unauthorized"}""")
    }
}
