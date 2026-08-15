package kr.co.catharsis.owner.push

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PushSignalTest {
    @Test
    fun parsesPositiveAlertId() {
        assertEquals(42L, PushSignal.alertId(mapOf("alertId" to "42")))
    }

    @Test
    fun rejectsInvalidAlertIds() {
        listOf("", "0", "-1", "1.2", "abc", "99999999999999999999").forEach { value ->
            assertNull(PushSignal.alertId(mapOf("alertId" to value)))
        }
        assertNull(PushSignal.alertId(emptyMap()))
    }
}
