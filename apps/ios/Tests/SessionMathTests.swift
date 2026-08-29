import XCTest
@testable import BenHealthOS

/// Client-side display math (Features/BloodPressure/BPDisplayMath.swift):
/// morning/evening classification in the measurement's own time zone, daily
/// chart aggregation across UTC midnight, session averaging (mean_all vs
/// mean_excluding_first), the never-zero rule, and 15-minute session grouping.
final class SessionMathTests: XCTestCase {
    private func date(_ iso: String) throws -> Date {
        try XCTUnwrap(JSONCoding.parseDate(iso), "bad ISO date in test: \(iso)")
    }

    private func reading(_ id: String, _ measuredAt: Date, tz: String? = "America/New_York",
                         systolic: Double, diastolic: Double, pulse: Double?,
                         canonical: Bool = true) -> BpReadingDto {
        BpReadingDto(
            id: id, measuredAt: measuredAt, measuredTz: tz,
            systolic: systolic, diastolic: diastolic, pulse: pulse,
            source: .withingsApi, canonical: canonical, ingestedAt: measuredAt
        )
    }

    // MARK: Dayparts (morning 04:00–11:59, evening 17:00–23:59, local time)

    func testDaypartUsesMeasurementTimeZone() throws {
        // 07:31 in New York (11:31 UTC) — morning locally.
        let morning = try date("2026-08-21T11:31:12Z")
        XCTAssertEqual(BPDisplayMath.daypart(of: morning, timeZoneIdentifier: "America/New_York"),
                       .morning)

        // 21:14 in New York is 01:14 UTC the NEXT day — evening locally,
        // but "other" under the UTC fallback. The tz must decide.
        let evening = try date("2026-08-22T01:14:40Z")
        XCTAssertEqual(BPDisplayMath.daypart(of: evening, timeZoneIdentifier: "America/New_York"),
                       .evening)
        XCTAssertEqual(BPDisplayMath.daypart(of: evening, timeZoneIdentifier: nil),
                       .other, "missing tz falls back to UTC, not to a guess")

        // 12:45 local — neither morning nor evening.
        let midday = try date("2026-08-26T16:45:09Z")
        XCTAssertEqual(BPDisplayMath.daypart(of: midday, timeZoneIdentifier: "America/New_York"),
                       .other)
    }

    func testDaypartAfterDSTFallBack() throws {
        // 2026-11-02T01:30Z = Nov 1, 20:30 in New York (EST, after the
        // fall-back) — evening locally, "other" in UTC.
        let instant = try date("2026-11-02T01:30:00Z")
        XCTAssertEqual(BPDisplayMath.daypart(of: instant, timeZoneIdentifier: "America/New_York"),
                       .evening)
        XCTAssertEqual(BPDisplayMath.daypart(of: instant, timeZoneIdentifier: nil), .other)
    }

    func testDaypartBoundaries() throws {
        // 04:00 and 11:59 UTC are morning; 12:00 is not. 17:00 opens evening.
        XCTAssertEqual(BPDisplayMath.daypart(of: try date("2026-08-21T04:00:00Z"),
                                             timeZoneIdentifier: nil), .morning)
        XCTAssertEqual(BPDisplayMath.daypart(of: try date("2026-08-21T11:59:59Z"),
                                             timeZoneIdentifier: nil), .morning)
        XCTAssertEqual(BPDisplayMath.daypart(of: try date("2026-08-21T12:00:00Z"),
                                             timeZoneIdentifier: nil), .other)
        XCTAssertEqual(BPDisplayMath.daypart(of: try date("2026-08-21T16:59:59Z"),
                                             timeZoneIdentifier: nil), .other)
        XCTAssertEqual(BPDisplayMath.daypart(of: try date("2026-08-21T17:00:00Z"),
                                             timeZoneIdentifier: nil), .evening)
        XCTAssertEqual(BPDisplayMath.daypart(of: try date("2026-08-21T23:59:59Z"),
                                             timeZoneIdentifier: nil), .evening)
    }

    // MARK: Daily aggregation

    func testDailyPointsGroupByMeasurementLocalDayAcrossUTCMidnight() throws {
        // Evening session in New York: 21:14 and 21:16 on Aug 21 local,
        // which is 01:14/01:16 UTC on Aug 22. Must land on 2026-08-21.
        let readings = [
            reading("r1", try date("2026-08-22T01:14:40Z"), systolic: 124, diastolic: 80, pulse: 58),
            reading("r2", try date("2026-08-22T01:16:52Z"), systolic: 126, diastolic: 82, pulse: 57)
        ]
        let points = BPDisplayMath.dailyPoints(readings: readings)
        XCTAssertEqual(points.count, 1)
        XCTAssertEqual(points[0].date, "2026-08-21")
        XCTAssertEqual(points[0].readingCount, 2)
        XCTAssertEqual(try XCTUnwrap(points[0].meanSystolic), 125.0, accuracy: 0.0001)
        XCTAssertEqual(try XCTUnwrap(points[0].meanDiastolic), 81.0, accuracy: 0.0001)
        XCTAssertEqual(try XCTUnwrap(points[0].meanPulse), 57.5, accuracy: 0.0001)
    }

    func testDailyPointsSortedAndSkipNonCanonical() throws {
        let readings = [
            reading("r3", try date("2026-08-25T11:33:22Z"), systolic: 120, diastolic: 77, pulse: 61),
            reading("dup", try date("2026-08-25T11:33:22Z"), systolic: 120, diastolic: 77, pulse: 61,
                    canonical: false),
            reading("r1", try date("2026-08-21T11:31:12Z"), systolic: 118, diastolic: 76, pulse: 62)
        ]
        let points = BPDisplayMath.dailyPoints(readings: readings)
        XCTAssertEqual(points.map(\.date), ["2026-08-21", "2026-08-25"])
        XCTAssertEqual(points[1].readingCount, 1, "non-canonical duplicates never count")
    }

    func testDailyPointsNullPulsesAreExcludedNotZeroed() throws {
        let readings = [
            reading("r1", try date("2026-08-23T11:40:10Z"), systolic: 122, diastolic: 79, pulse: 60),
            reading("r2", try date("2026-08-23T11:42:18Z"), systolic: 118, diastolic: 77, pulse: nil)
        ]
        let points = BPDisplayMath.dailyPoints(readings: readings)
        XCTAssertEqual(points.count, 1)
        // Mean over PRESENT pulses only: 60.0 — not (60+0)/2 = 30.
        XCTAssertEqual(try XCTUnwrap(points[0].meanPulse), 60.0, accuracy: 0.0001)
    }

    func testMeanOfNoValuesIsNilNeverZero() {
        XCTAssertNil(BPDisplayMath.mean([]))
        XCTAssertNil(BPDisplayMath.meanOfPresent([nil, nil]))
    }

    // MARK: Session averaging (contract §4: ≥3 readings exclude the first)

    func testTwoReadingSessionUsesMeanAll() throws {
        let readings = [
            reading("r1", try date("2026-08-22T01:14:40Z"), systolic: 124, diastolic: 80, pulse: 58),
            reading("r2", try date("2026-08-22T01:16:52Z"), systolic: 126, diastolic: 82, pulse: 57)
        ]
        let average = BPDisplayMath.sessionAverage(of: readings)
        XCTAssertEqual(average.averagingMethod, .meanAll)
        XCTAssertFalse(average.firstReadingExcluded)
        XCTAssertEqual(try XCTUnwrap(average.avgSystolic), 125.0, accuracy: 0.0001)
        XCTAssertEqual(try XCTUnwrap(average.avgDiastolic), 81.0, accuracy: 0.0001)
        XCTAssertEqual(try XCTUnwrap(average.avgPulse), 57.5, accuracy: 0.0001)
    }

    func testThreeReadingSessionExcludesFirst() throws {
        // Same numbers as fixture session 1: (118/76/62), (121/78/61), (117/75/63).
        let readings = [
            reading("r2", try date("2026-08-21T11:33:20Z"), systolic: 121, diastolic: 78, pulse: 61),
            reading("r1", try date("2026-08-21T11:31:12Z"), systolic: 118, diastolic: 76, pulse: 62),
            reading("r3", try date("2026-08-21T11:35:05Z"), systolic: 117, diastolic: 75, pulse: 63)
        ]
        // Deliberately unordered input: ordering is by measuredAt, not array order.
        let average = BPDisplayMath.sessionAverage(of: readings)
        XCTAssertEqual(average.averagingMethod, .meanExcludingFirst)
        XCTAssertTrue(average.firstReadingExcluded)
        XCTAssertEqual(try XCTUnwrap(average.avgSystolic), 119.0, accuracy: 0.0001)
        XCTAssertEqual(try XCTUnwrap(average.avgDiastolic), 76.5, accuracy: 0.0001)
        XCTAssertEqual(try XCTUnwrap(average.avgPulse), 62.0, accuracy: 0.0001)
    }

    func testExcludedFirstWithNullPulseInIncludedSlice() throws {
        // (122/79/60), (118/77/nil), (120/78/61): excluded slice is #2 and #3;
        // pulse mean must be 61.0 (only the present value), never 30.5.
        let readings = [
            reading("r1", try date("2026-08-23T11:40:10Z"), systolic: 122, diastolic: 79, pulse: 60),
            reading("r2", try date("2026-08-23T11:42:18Z"), systolic: 118, diastolic: 77, pulse: nil),
            reading("r3", try date("2026-08-23T11:44:27Z"), systolic: 120, diastolic: 78, pulse: 61)
        ]
        let average = BPDisplayMath.sessionAverage(of: readings)
        XCTAssertEqual(try XCTUnwrap(average.avgSystolic), 119.0, accuracy: 0.0001)
        XCTAssertEqual(try XCTUnwrap(average.avgDiastolic), 77.5, accuracy: 0.0001)
        XCTAssertEqual(try XCTUnwrap(average.avgPulse), 61.0, accuracy: 0.0001)
    }

    func testSingleReadingSession() throws {
        let readings = [
            reading("r1", try date("2026-08-26T16:45:09Z"), systolic: 121, diastolic: 78, pulse: 63)
        ]
        let average = BPDisplayMath.sessionAverage(of: readings)
        XCTAssertEqual(average.averagingMethod, .meanAll)
        XCTAssertFalse(average.firstReadingExcluded)
        XCTAssertEqual(try XCTUnwrap(average.avgSystolic), 121.0, accuracy: 0.0001)
    }

    // MARK: Session grouping (gap ≤ 15 min, contract §4)

    func testGroupingSplitsOnGapsOverFifteenMinutes() throws {
        let base = try date("2026-08-21T11:00:00Z")
        let readings = [
            reading("a", base, systolic: 118, diastolic: 76, pulse: 62),
            reading("b", base.addingTimeInterval(120), systolic: 120, diastolic: 77, pulse: 61),
            // Exactly 15:00 after "b" — still the same session (inclusive).
            reading("c", base.addingTimeInterval(120 + 900), systolic: 119, diastolic: 76, pulse: 60),
            // 15:01 after "c" — new session.
            reading("d", base.addingTimeInterval(120 + 900 + 901), systolic: 125, diastolic: 82, pulse: 58)
        ]
        let groups = BPDisplayMath.groupIntoSessions(readings: readings)
        XCTAssertEqual(groups.map { $0.map(\.id) }, [["a", "b", "c"], ["d"]])
    }

    func testGroupingOrdersByMeasurementTime() throws {
        let base = try date("2026-08-21T11:00:00Z")
        let readings = [
            reading("late", base.addingTimeInterval(3600), systolic: 125, diastolic: 82, pulse: 58),
            reading("early", base, systolic: 118, diastolic: 76, pulse: 62)
        ]
        let groups = BPDisplayMath.groupIntoSessions(readings: readings)
        XCTAssertEqual(groups.count, 2)
        XCTAssertEqual(groups[0].first?.id, "early")
    }

    func testGroupingEmptyInput() {
        XCTAssertTrue(BPDisplayMath.groupIntoSessions(readings: []).isEmpty)
    }

    // MARK: Formatting guards

    func testValueFormattingNeverShowsZeroForMissingPulse() {
        XCTAssertEqual(BPFormat.pulse(nil), "—")
        XCTAssertEqual(BPFormat.averagePulse(nil), "—")
        XCTAssertEqual(BPFormat.average(systolic: nil, diastolic: nil), "—")
        XCTAssertEqual(BPFormat.value(systolic: 119.4, diastolic: 76.5), "119/77")
        XCTAssertEqual(BPFormat.average(systolic: 119.0, diastolic: 76.5), "119.0/76.5")
    }

    func testMeasuredTimeRendersInMeasurementTimeZone() throws {
        // 2026-08-22T01:14:40Z is 21:14 on Aug 21 in New York; the rendered
        // string must reflect the measurement-local day and hour regardless
        // of the machine's zone.
        let instant = try date("2026-08-22T01:14:40Z")
        let rendered = BPFormat.measuredTime(instant, tz: "America/New_York")
        XCTAssertTrue(rendered.contains("21"), "expected local day 21 in '\(rendered)'")
        XCTAssertFalse(rendered.contains("22"), "must not show the UTC day in '\(rendered)'")
    }
}
