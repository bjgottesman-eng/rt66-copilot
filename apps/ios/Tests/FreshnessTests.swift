import XCTest
@testable import BenHealthOS

/// Table-driven mirror of the shared freshness tests (contracts §3; the
/// TypeScript implementation in packages/shared runs the same table). The
/// clock is injected — no wall time in these tests.
final class FreshnessTests: XCTestCase {
    /// Fixed reference instant; the algorithm only uses differences.
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    private struct Case {
        let name: String
        let connectionStatus: ConnectionStatus
        /// Seconds before `now`, nil = missing.
        let lastSuccessAgo: TimeInterval?
        let latestMeasuredAgo: TimeInterval?
        let expectedLatencySeconds: TimeInterval
        let expected: FreshnessStatus
    }

    private var cases: [Case] {
        [
            // Connection-status short circuits
            Case(name: "not_connected wins over everything",
                 connectionStatus: .notConnected, lastSuccessAgo: 60,
                 latestMeasuredAgo: 60, expectedLatencySeconds: 300,
                 expected: .notConnected),
            Case(name: "error wins even with fresh data",
                 connectionStatus: .error, lastSuccessAgo: 60,
                 latestMeasuredAgo: 60, expectedLatencySeconds: 300,
                 expected: .syncError),
            Case(name: "error wins over missing data",
                 connectionStatus: .error, lastSuccessAgo: nil,
                 latestMeasuredAgo: nil, expectedLatencySeconds: 300,
                 expected: .syncError),

            // No data
            Case(name: "connected but no measurement ever",
                 connectionStatus: .connected, lastSuccessAgo: 60,
                 latestMeasuredAgo: nil, expectedLatencySeconds: 300,
                 expected: .insufficientData),
            Case(name: "revoked falls through to the age logic (no data)",
                 connectionStatus: .revoked, lastSuccessAgo: nil,
                 latestMeasuredAgo: nil, expectedLatencySeconds: 300,
                 expected: .insufficientData),

            // CURRENT bound = max(2 * latency, 15 min)
            Case(name: "10 min old, small latency -> CURRENT (15 min floor)",
                 connectionStatus: .connected, lastSuccessAgo: 60,
                 latestMeasuredAgo: 10 * 60, expectedLatencySeconds: 300,
                 expected: .current),
            Case(name: "exactly 15 min with small latency -> CURRENT (inclusive)",
                 connectionStatus: .connected, lastSuccessAgo: 60,
                 latestMeasuredAgo: 15 * 60, expectedLatencySeconds: 300,
                 expected: .current),
            Case(name: "15 min + 1 s with small latency -> RECENT",
                 connectionStatus: .connected, lastSuccessAgo: 60,
                 latestMeasuredAgo: 15 * 60 + 1, expectedLatencySeconds: 300,
                 expected: .recent),
            Case(name: "large latency stretches CURRENT to 2x latency",
                 connectionStatus: .connected, lastSuccessAgo: 60,
                 latestMeasuredAgo: 7000, expectedLatencySeconds: 3600,
                 expected: .current),
            Case(name: "just past 2x large latency -> RECENT",
                 connectionStatus: .connected, lastSuccessAgo: 60,
                 latestMeasuredAgo: 7201, expectedLatencySeconds: 3600,
                 expected: .recent),

            // RECENT bound = 24 h (inclusive)
            Case(name: "exactly 24 h -> RECENT",
                 connectionStatus: .connected, lastSuccessAgo: 60,
                 latestMeasuredAgo: 24 * 3600, expectedLatencySeconds: 300,
                 expected: .recent),

            // DELAYED_BY_SOURCE: 24 h < age <= 72 h AND last success <= 6 h
            Case(name: "25 h old, synced 1 h ago -> DELAYED_BY_SOURCE",
                 connectionStatus: .connected, lastSuccessAgo: 3600,
                 latestMeasuredAgo: 25 * 3600, expectedLatencySeconds: 300,
                 expected: .delayedBySource),
            Case(name: "boundary: exactly 72 h old and success exactly 6 h ago",
                 connectionStatus: .connected, lastSuccessAgo: 6 * 3600,
                 latestMeasuredAgo: 72 * 3600, expectedLatencySeconds: 300,
                 expected: .delayedBySource),
            Case(name: "25 h old but success 6 h + 1 s ago -> STALE",
                 connectionStatus: .connected, lastSuccessAgo: 6 * 3600 + 1,
                 latestMeasuredAgo: 25 * 3600, expectedLatencySeconds: 300,
                 expected: .stale),
            Case(name: "25 h old, no recorded success -> STALE",
                 connectionStatus: .connected, lastSuccessAgo: nil,
                 latestMeasuredAgo: 25 * 3600, expectedLatencySeconds: 300,
                 expected: .stale),
            Case(name: "72 h + 1 s old despite fresh sync -> STALE",
                 connectionStatus: .connected, lastSuccessAgo: 60,
                 latestMeasuredAgo: 72 * 3600 + 1, expectedLatencySeconds: 300,
                 expected: .stale),

            // revoked with data falls through (only not_connected/error branch)
            Case(name: "revoked with fresh data falls through to CURRENT",
                 connectionStatus: .revoked, lastSuccessAgo: 60,
                 latestMeasuredAgo: 60, expectedLatencySeconds: 300,
                 expected: .current)
        ]
    }

    func testFreshnessTable() {
        for testCase in cases {
            let inputs = FreshnessInputs(
                connectionStatus: testCase.connectionStatus,
                lastSuccessAt: testCase.lastSuccessAgo.map { now.addingTimeInterval(-$0) },
                latestMeasuredAt: testCase.latestMeasuredAgo.map { now.addingTimeInterval(-$0) },
                expectedLatencySeconds: testCase.expectedLatencySeconds,
                now: now
            )
            XCTAssertEqual(Freshness.compute(inputs), testCase.expected,
                           "case failed: \(testCase.name)")
        }
    }

    func testDtoCarriesInputsAndAge() {
        let inputs = FreshnessInputs(
            connectionStatus: .connected,
            lastSuccessAt: now.addingTimeInterval(-120),
            latestMeasuredAt: now.addingTimeInterval(-600),
            expectedLatencySeconds: 300,
            now: now
        )
        let dto = Freshness.dto(inputs)
        XCTAssertEqual(dto.status, .current)
        XCTAssertEqual(dto.ageSeconds, 600)
        XCTAssertEqual(dto.expectedLatencySeconds, 300)
        XCTAssertEqual(dto.latestMeasuredAt, inputs.latestMeasuredAt)
        XCTAssertEqual(dto.lastSuccessAt, inputs.lastSuccessAt)
    }

    func testDtoWithNoMeasurementHasNilAge() {
        let dto = Freshness.dto(FreshnessInputs(
            connectionStatus: .connected,
            lastSuccessAt: nil,
            latestMeasuredAt: nil,
            expectedLatencySeconds: 300,
            now: now
        ))
        XCTAssertEqual(dto.status, .insufficientData)
        XCTAssertNil(dto.ageSeconds)
        XCTAssertNil(dto.latestMeasuredAt)
    }

    /// The pill styling must have copy for every status, and none of it may
    /// contain the forbidden word.
    func testEveryStatusHasCalmExplainableCopyAndNoLiveWord() {
        for status in FreshnessStatus.allCases {
            let style = FreshnessStyle.style(for: status)
            XCTAssertFalse(style.label.isEmpty)
            XCTAssertFalse(style.explanation.isEmpty)
            XCTAssertFalse(style.label.uppercased().contains("LIVE"),
                           "'LIVE' is forbidden in UI copy (contracts §3)")
            XCTAssertFalse(style.explanation.uppercased().contains("LIVE"),
                           "'LIVE' is forbidden in UI copy (contracts §3)")
        }
    }
}
