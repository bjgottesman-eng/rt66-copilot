package com.benhealthos.app.data.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Duration
import java.time.Instant

class BackfillPlannerTest {
    private val now = Instant.parse("2026-10-12T12:00:00Z")

    @Test
    fun backfillStartRespectsHistoryPermission() {
        assertEquals(now.minus(Duration.ofDays(30)), BackfillPlanner.backfillStart(now, historyGranted = false))
        assertEquals(now.minus(Duration.ofDays(365)), BackfillPlanner.backfillStart(now, historyGranted = true))
    }

    @Test
    fun windowsAreContiguousNonOverlappingAndNewestFirst() {
        val start = now.minus(Duration.ofDays(30))
        val windows = BackfillPlanner.windows(start, now, Duration.ofDays(7))
        assertEquals(5, windows.size) // 4 full weeks + 2 days
        assertEquals(now, windows.first().end)
        assertEquals(start, windows.last().start)
        for (i in 1 until windows.size) assertEquals(windows[i - 1].start, windows[i].end)
        assertEquals(Duration.ofDays(2), Duration.between(windows.last().start, windows.last().end))
    }

    @Test
    fun emptyRangeProducesNoWindows() {
        assertTrue(BackfillPlanner.windows(now, now).isEmpty())
        assertTrue(BackfillPlanner.windows(now, now.minusSeconds(1)).isEmpty())
    }

    @Test
    fun batchesSplitAtTheContractLimit() {
        val items = (1..2500).toList()
        val batches = BackfillPlanner.batches(items, 1000)
        assertEquals(listOf(1000, 1000, 500), batches.map { it.size })
        assertTrue(BackfillPlanner.batches(emptyList<Int>()).isEmpty())
    }
}
