package kr.co.catharsis.owner.data

import org.junit.Assert.assertEquals
import org.junit.Test

class AlertTimeFormatterTest {
    @Test
    fun `converts sqlite utc timestamps to korea time`() {
        assertEquals("8월 15일 오후 12:20", formatCreatedAt("2026-08-15 03:20:00"))
    }

    @Test
    fun `converts iso instants to korea time`() {
        assertEquals("8월 15일 오후 12:20", formatCreatedAt("2026-08-15T03:20:00Z"))
    }

    @Test
    fun `falls back safely for an unknown format`() {
        assertEquals("unknown", formatCreatedAt("unknown"))
    }
}
