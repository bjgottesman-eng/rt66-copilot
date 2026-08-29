import XCTest
@testable import BenHealthOS

/// Decoding/encoding tests for the contract §5 DTO mirrors: exact field
/// names, exact enum raw values, ISO-8601 dates (with or without fractional
/// seconds), and the never-zero rule for absent values.
final class ModelsDecodingTests: XCTestCase {
    private let decoder = JSONCoding.makeDecoder()
    private let encoder = JSONCoding.makeEncoder()

    private func date(_ iso: String) throws -> Date {
        try XCTUnwrap(JSONCoding.parseDate(iso), "bad ISO date in test: \(iso)")
    }

    // MARK: BpReadingDto

    func testDecodeFullReading() throws {
        let json = """
        {
          "id": "bbbb0000-0000-4000-8000-000000000001",
          "measuredAt": "2026-08-21T11:31:12Z",
          "measuredTz": "America/New_York",
          "systolic": 118.0,
          "diastolic": 76.0,
          "pulse": 62.0,
          "source": "withings_api",
          "sourceApp": null,
          "sourceDevice": "Withings BPM Connect",
          "sessionId": "aaaa0000-0000-4000-8000-000000000001",
          "arm": "unknown",
          "bodyPosition": "unknown",
          "note": null,
          "canonical": true,
          "duplicateOf": null,
          "ingestedAt": "2026-08-21T11:39:00Z"
        }
        """
        let reading = try decoder.decode(BpReadingDto.self, from: Data(json.utf8))
        XCTAssertEqual(reading.id, "bbbb0000-0000-4000-8000-000000000001")
        XCTAssertEqual(reading.measuredAt, try date("2026-08-21T11:31:12Z"))
        XCTAssertEqual(reading.measuredTz, "America/New_York")
        XCTAssertEqual(reading.systolic, 118.0, accuracy: 0.0001)
        XCTAssertEqual(reading.diastolic, 76.0, accuracy: 0.0001)
        XCTAssertEqual(reading.pulse ?? -1, 62.0, accuracy: 0.0001)
        XCTAssertEqual(reading.source, .withingsApi)
        XCTAssertNil(reading.sourceApp)
        XCTAssertEqual(reading.sourceDevice, "Withings BPM Connect")
        XCTAssertEqual(reading.arm, .unknown)
        XCTAssertEqual(reading.bodyPosition, .unknown)
        XCTAssertTrue(reading.canonical)
        XCTAssertNil(reading.duplicateOf)
        XCTAssertEqual(reading.ingestedAt, try date("2026-08-21T11:39:00Z"))
    }

    func testAbsentPulseStaysNilNeverZero() throws {
        let json = """
        {
          "id": "r1", "measuredAt": "2026-08-23T11:42:18Z", "measuredTz": null,
          "systolic": 118, "diastolic": 77, "pulse": null,
          "source": "apple_health", "sourceApp": "Health Mate",
          "sourceDevice": "BPM Connect", "sessionId": null,
          "arm": "unknown", "bodyPosition": "unknown", "note": null,
          "canonical": true, "duplicateOf": null,
          "ingestedAt": "2026-08-23T11:48:00Z"
        }
        """
        let reading = try decoder.decode(BpReadingDto.self, from: Data(json.utf8))
        XCTAssertNil(reading.pulse, "absent pulse must stay nil, never 0")
        XCTAssertNotEqual(reading.pulse ?? -1, 0)
    }

    func testDecodeToleratesFractionalSeconds() throws {
        let json = """
        {
          "id": "r2", "measuredAt": "2026-08-29T01:19:18.123Z",
          "systolic": 124, "diastolic": 80,
          "source": "manual", "canonical": true,
          "ingestedAt": "2026-08-29T01:23:00.500Z"
        }
        """
        let reading = try decoder.decode(BpReadingDto.self, from: Data(json.utf8))
        XCTAssertEqual(reading.measuredAt.timeIntervalSince1970,
                       try date("2026-08-29T01:19:18Z").timeIntervalSince1970,
                       accuracy: 0.5)
        // Optional keys may be omitted entirely.
        XCTAssertNil(reading.pulse)
        XCTAssertNil(reading.measuredTz)
    }

    func testUnknownEnumStringFailsLoudly() {
        let json = """
        {
          "id": "r3", "measuredAt": "2026-08-29T01:19:18Z",
          "systolic": 124, "diastolic": 80,
          "source": "telepathy", "canonical": true,
          "ingestedAt": "2026-08-29T01:23:00Z"
        }
        """
        XCTAssertThrowsError(try decoder.decode(BpReadingDto.self, from: Data(json.utf8)),
                             "unexpected bp_source strings must not decode silently")
    }

    // MARK: Latest envelope

    func testDecodeLatestWithNullReading() throws {
        let json = """
        {
          "reading": null,
          "freshness": {
            "status": "NOT_CONNECTED",
            "latestMeasuredAt": null,
            "lastSuccessAt": null,
            "expectedLatencySeconds": null,
            "ageSeconds": null
          }
        }
        """
        let latest = try decoder.decode(LatestBpResponse.self, from: Data(json.utf8))
        XCTAssertNil(latest.reading)
        XCTAssertEqual(latest.freshness.status, .notConnected)
    }

    // MARK: Summary

    func testDecodeSummary() throws {
        let json = """
        {
          "window": "7d",
          "from": "2026-08-22T00:00:00Z",
          "to": "2026-08-29T00:00:00Z",
          "readingCount": 17,
          "sessionCount": 8,
          "meanSystolic": 121.4,
          "meanDiastolic": 78.2,
          "meanPulse": 60.1,
          "morning": { "readingCount": 9, "meanSystolic": 118.0, "meanDiastolic": 75.9, "meanPulse": 62.0 },
          "evening": { "readingCount": 7, "meanSystolic": 125.6, "meanDiastolic": 81.8, "meanPulse": 57.6 },
          "daily": [
            { "date": "2026-08-22", "meanSystolic": 120.2, "meanDiastolic": 77.8, "sessionCount": 2 },
            { "date": "2026-08-23", "meanSystolic": null, "meanDiastolic": null, "sessionCount": 0 }
          ]
        }
        """
        let summary = try decoder.decode(BpSummaryDto.self, from: Data(json.utf8))
        XCTAssertEqual(summary.window, .sevenDays)
        XCTAssertEqual(summary.readingCount, 17)
        XCTAssertEqual(summary.morning.meanSystolic ?? -1, 118.0, accuracy: 0.0001)
        XCTAssertEqual(summary.evening.readingCount, 7)
        XCTAssertEqual(summary.daily.count, 2)
        XCTAssertEqual(summary.daily[0].date, "2026-08-22")
        XCTAssertNil(summary.daily[1].meanSystolic, "empty day must not become 0")
    }

    // MARK: Sources

    func testDecodeSourceStatus() throws {
        let json = """
        {
          "provider": "withings",
          "displayName": "Withings",
          "connectionStatus": "error",
          "freshness": {
            "status": "SYNC_ERROR",
            "latestMeasuredAt": "2026-08-28T11:34:23Z",
            "lastSuccessAt": "2026-08-28T11:38:00Z",
            "expectedLatencySeconds": 300,
            "ageSeconds": 49537
          },
          "latestMeasuredAt": "2026-08-28T11:34:23Z",
          "lastSyncAt": "2026-08-28T11:38:00Z",
          "coverageNote": "Blood pressure only.",
          "problems": ["Token refresh failed; reconnect required."]
        }
        """
        let source = try decoder.decode(SourceStatusDto.self, from: Data(json.utf8))
        XCTAssertEqual(source.provider, .withings)
        XCTAssertEqual(source.connectionStatus, .error)
        XCTAssertEqual(source.freshness.status, .syncError)
        XCTAssertEqual(source.problems.count, 1)
    }

    // MARK: Manual entry encoding (exact wire keys)

    func testManualEntryEncodesExactContractKeys() throws {
        let entry = ManualBpEntry(
            systolic: 132, diastolic: 79, pulse: 64,
            measuredAt: try date("2026-07-20T01:30:47Z"),
            measuredTz: "America/New_York",
            arm: .left, bodyPosition: .seated,
            seatedRestMinutes: 5, readingNumberInSession: 1,
            note: "test", saveToAppleHealth: true
        )
        let data = try encoder.encode(entry)
        let object = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: data) as? [String: Any]
        )
        XCTAssertEqual(Set(object.keys), [
            "systolic", "diastolic", "pulse", "measuredAt", "measuredTz",
            "arm", "bodyPosition", "seatedRestMinutes",
            "readingNumberInSession", "note", "saveToAppleHealth"
        ])
        XCTAssertEqual(object["arm"] as? String, "left")
        XCTAssertEqual(object["bodyPosition"] as? String, "seated")
        XCTAssertEqual(object["measuredAt"] as? String, "2026-07-20T01:30:47Z")
        XCTAssertEqual(object["saveToAppleHealth"] as? Bool, true)
    }

    func testManualEntryRoundTrips() throws {
        let entry = ManualBpEntry(
            systolic: 120, diastolic: 77,
            measuredAt: try date("2026-06-22T16:45:09Z")
        )
        let decoded = try decoder.decode(ManualBpEntry.self, from: try encoder.encode(entry))
        XCTAssertEqual(decoded, entry)
        XCTAssertNil(decoded.pulse)
    }

    // MARK: HealthKit batch encoding

    func testHealthKitBatchEncodesExactContractKeys() throws {
        let batch = HealthKitBpBatch(
            deviceAnchor: "anchor-1",
            samples: [
                HealthKitBpSample(
                    hkUuid: "8B0C6C4F-0000-4000-8000-000000000001",
                    measuredAt: try date("2026-08-25T11:33:22Z"),
                    measuredTz: "America/New_York",
                    systolic: 120, diastolic: 77, pulse: nil,
                    sourceApp: "Health Mate",
                    sourceDevice: "BPM Connect",
                    sourceBundleId: "com.withings.wiScaleNG"
                )
            ]
        )
        let data = try encoder.encode(batch)
        let object = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: data) as? [String: Any]
        )
        XCTAssertEqual(Set(object.keys), ["deviceAnchor", "samples"])
        let samples = try XCTUnwrap(object["samples"] as? [[String: Any]])
        XCTAssertEqual(samples.count, 1)
        // pulse is nil -> key omitted, and it must NOT appear as 0.
        XCTAssertEqual(Set(samples[0].keys), [
            "hkUuid", "measuredAt", "measuredTz", "systolic", "diastolic",
            "sourceApp", "sourceDevice", "sourceBundleId"
        ])
        XCTAssertEqual(samples[0]["sourceBundleId"] as? String, "com.withings.wiScaleNG")
    }

    // MARK: Enum raw values (exact contract strings)

    func testEnumRawValuesMatchContract() {
        XCTAssertEqual(BpSource.withingsApi.rawValue, "withings_api")
        XCTAssertEqual(BpSource.appleHealth.rawValue, "apple_health")
        XCTAssertEqual(BpSource.manual.rawValue, "manual")
        XCTAssertEqual(Provider.clinicalRecords.rawValue, "clinical_records")
        XCTAssertEqual(ConnectionStatus.notConnected.rawValue, "not_connected")
        XCTAssertEqual(FreshnessStatus.delayedBySource.rawValue, "DELAYED_BY_SOURCE")
        XCTAssertEqual(FreshnessStatus.insufficientData.rawValue, "INSUFFICIENT_DATA")
        XCTAssertEqual(AveragingMethod.meanExcludingFirst.rawValue, "mean_excluding_first")
        XCTAssertEqual(SummaryWindow.sevenDays.rawValue, "7d")
        XCTAssertEqual(SummaryWindow.thirtyDays.rawValue, "30d")
        XCTAssertEqual(Arm.allCases.map(\.rawValue), ["left", "right", "unknown"])
        XCTAssertEqual(BodyPosition.allCases.map(\.rawValue),
                       ["seated", "standing", "lying", "unknown"])
    }

    // MARK: Bundled demo fixture

    func testDemoFixtureDecodesAndHoldsInvariants() throws {
        let fixture = try DemoData.loadFixture()
        XCTAssertFalse(fixture.sessions.isEmpty)
        XCTAssertEqual(fixture.sources.count, 8, "one row per Phase 1 provider")

        let readings = fixture.sessions.flatMap(\.readings)
        XCTAssertTrue(readings.allSatisfy(\.canonical))
        XCTAssertEqual(readings.filter { $0.pulse == nil }.count, 1,
                       "fixture carries exactly one null-pulse reading")

        // The cross-source duplicate mirrors a canonical Withings reading.
        let duplicate = try XCTUnwrap(fixture.duplicateReadings.first)
        XCTAssertFalse(duplicate.canonical)
        XCTAssertEqual(duplicate.source, .appleHealth)
        let target = try XCTUnwrap(readings.first { $0.id == duplicate.duplicateOf })
        XCTAssertEqual(target.systolic, duplicate.systolic)
        XCTAssertEqual(target.diastolic, duplicate.diastolic)
        XCTAssertEqual(target.measuredAt, duplicate.measuredAt)

        // Session bookkeeping matches its readings.
        for session in fixture.sessions {
            XCTAssertEqual(session.readingCount, session.readings.count)
            XCTAssertEqual(session.firstReadingExcluded, session.readings.count >= 3)
        }
    }

    func testDemoRebasePutsLatestWithin24hAndKeepsDayparts() throws {
        let fixture = try DemoData.loadFixture()
        let now = Date()
        let rebased = DemoData.rebased(fixture, to: now)

        let latest = try XCTUnwrap(
            rebased.sessions.flatMap(\.readings).map(\.measuredAt).max()
        )
        let age = now.timeIntervalSince(latest)
        XCTAssertGreaterThanOrEqual(age, 0, "rebased data must never be in the future")
        XCTAssertLessThan(age, 24 * 3600, "latest rebased reading lands within 24 h")

        // Whole-day shifting preserves morning/evening classification for the
        // fixture's morning and evening readings. (A shift across a DST
        // boundary moves local clock time by up to an hour, so only readings
        // comfortably inside their daypart are asserted — which morning and
        // evening fixture readings are by construction.)
        let original = fixture.sessions.flatMap(\.readings)
        let shifted = rebased.sessions.flatMap(\.readings)
        XCTAssertEqual(original.count, shifted.count)
        for (o, s) in zip(original, shifted) {
            let originalPart = BPDisplayMath.daypart(of: o.measuredAt,
                                                     timeZoneIdentifier: o.measuredTz)
            guard originalPart != .other else { continue }
            XCTAssertEqual(
                originalPart,
                BPDisplayMath.daypart(of: s.measuredAt, timeZoneIdentifier: s.measuredTz),
                "day shift must not move a morning/evening reading across dayparts"
            )
        }
    }
}
