package com.benhealthos.app.data.sync

import java.time.Duration
import java.time.Instant

/**
 * Pure planning helpers for historical backfill and batching (unit tested).
 * Health Connect limits reads to 30 days before the first permission grant unless the history
 * permission is granted; the planner never asks for more than the platform can return.
 */
object BackfillPlanner {
    data class Window(val start: Instant, val end: Instant)

    fun backfillStart(now: Instant, historyGranted: Boolean, maxHistoryDays: Long = 365, defaultDays: Long = 30): Instant =
        now.minus(Duration.ofDays(if (historyGranted) maxHistoryDays else defaultDays))

    /** Contiguous, non-overlapping windows covering [start, end), newest first so recent data lands first. */
    fun windows(start: Instant, end: Instant, chunk: Duration = Duration.ofDays(7)): List<Window> {
        require(!chunk.isZero && !chunk.isNegative) { "chunk must be positive" }
        if (!end.isAfter(start)) return emptyList()
        val out = ArrayList<Window>()
        var cursorEnd = end
        while (cursorEnd.isAfter(start)) {
            val cursorStart = maxOf(start, cursorEnd.minus(chunk))
            out += Window(cursorStart, cursorEnd)
            cursorEnd = cursorStart
        }
        return out
    }

    fun <T> batches(items: List<T>, size: Int = 1000): List<List<T>> {
        require(size > 0)
        if (items.isEmpty()) return emptyList()
        return items.chunked(size)
    }
}
