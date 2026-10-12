package com.benhealthos.app.notifications

import com.benhealthos.app.data.remote.NotificationPrefsDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalTime

class AlertPolicyTest {
    private val prefs = NotificationPrefsDto(pushEnabled = true, quietHoursStart = "22:00", quietHoursEnd = "07:00", enabledKinds = listOf("REPORT_READY", "LABS_IMPORTED"))

    @Test
    fun quietHoursCrossMidnight() {
        assertTrue(AlertPolicy.inQuietHours("22:00", "07:00", LocalTime.of(23, 30)))
        assertTrue(AlertPolicy.inQuietHours("22:00", "07:00", LocalTime.of(3, 0)))
        assertFalse(AlertPolicy.inQuietHours("22:00", "07:00", LocalTime.of(7, 0)))
        assertFalse(AlertPolicy.inQuietHours("22:00", "07:00", LocalTime.of(12, 0)))
        assertTrue(AlertPolicy.inQuietHours("12:00", "14:00", LocalTime.of(13, 0)))
        assertFalse(AlertPolicy.inQuietHours("12:00", "12:00", LocalTime.of(12, 0)))
        assertFalse(AlertPolicy.inQuietHours(null, "07:00", LocalTime.of(3, 0)))
        assertFalse(AlertPolicy.inQuietHours("bad", "07:00", LocalTime.of(3, 0)))
    }

    @Test
    fun decisionsFollowPreferences() {
        assertEquals(AlertPolicy.Decision.SHOW, AlertPolicy.decide(prefs, "REPORT_READY", LocalTime.of(9, 0)))
        assertEquals(AlertPolicy.Decision.HOLD, AlertPolicy.decide(prefs, "REPORT_READY", LocalTime.of(23, 0)))
        assertEquals(AlertPolicy.Decision.SILENT, AlertPolicy.decide(prefs, "SYNC_STALE", LocalTime.of(9, 0)))
        assertEquals(AlertPolicy.Decision.SILENT, AlertPolicy.decide(prefs.copy(pushEnabled = false), "REPORT_READY", LocalTime.of(9, 0)))
    }
}
