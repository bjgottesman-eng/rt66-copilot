import Foundation

// Demo mode fixtures + provider.
//
// ALL DATA HERE IS SYNTHETIC AND FICTIONAL — a small, hand-derived slice of
// the demo persona in fixtures/demo-persona/ (same shapes, same
// America/New_York timezone, same conventions: ~2 sessions/day of 2–3
// readings, one cross-source Apple Health duplicate, one null pulse, one
// manual entry). It exists so the app runs in the Simulator with zero
// backend. Never replace with real measurements.
//
// Timestamps are fixed in the JSON (late Aug 2026). At load time they are
// shifted by a WHOLE number of days so the newest reading lands within the
// last 24 h of "now" — freshness pills stay meaningful and morning/evening
// semantics are preserved. The shift is deterministic and visible here;
// nothing pretends to be a live stream.

public struct DemoFixture: Codable, Sendable {
    public var sessions: [BpSessionDto]
    /// Non-canonical cross-source duplicates, returned only for
    /// `includeDuplicates=true` (contract §4).
    public var duplicateReadings: [BpReadingDto]
    public var sources: [SourceStatusDto]
}

public enum DemoDataError: Error, LocalizedError {
    case corruptFixture

    public var errorDescription: String? {
        "The bundled demo fixture could not be decoded."
    }
}

public enum DemoData {
    public static func loadFixture() throws -> DemoFixture {
        let data = Data(fixtureJSON.utf8)
        do {
            return try JSONCoding.makeDecoder().decode(DemoFixture.self, from: data)
        } catch {
            throw DemoDataError.corruptFixture
        }
    }

    /// Shift every timestamp by whole days so the newest canonical reading
    /// falls within (now − 24 h, now]. Whole days keep 07:30 readings in the
    /// morning and 21:15 readings in the evening.
    public static func rebased(_ fixture: DemoFixture, to now: Date) -> DemoFixture {
        let latest = fixture.sessions
            .flatMap(\.readings)
            .filter(\.canonical)
            .map(\.measuredAt)
            .max()
        guard let latest else { return fixture }

        let dayShift = (now.timeIntervalSince(latest) / 86_400).rounded(.down)
        let shift = dayShift * 86_400
        guard shift != 0 else { return fixture }

        func move(_ date: Date) -> Date { date.addingTimeInterval(shift) }
        func move(_ date: Date?) -> Date? { date.map(move) }

        var result = fixture
        result.sessions = fixture.sessions.map { session in
            var s = session
            s.startedAt = move(s.startedAt)
            s.endedAt = move(s.endedAt)
            s.readings = s.readings.map { reading in
                var r = reading
                r.measuredAt = move(r.measuredAt)
                r.ingestedAt = move(r.ingestedAt)
                return r
            }
            return s
        }
        result.duplicateReadings = fixture.duplicateReadings.map { reading in
            var r = reading
            r.measuredAt = move(r.measuredAt)
            r.ingestedAt = move(r.ingestedAt)
            return r
        }
        result.sources = fixture.sources.map { source in
            var s = source
            s.latestMeasuredAt = move(s.latestMeasuredAt)
            s.lastSyncAt = move(s.lastSyncAt)
            s.freshness.latestMeasuredAt = move(s.freshness.latestMeasuredAt)
            s.freshness.lastSuccessAt = move(s.freshness.lastSuccessAt)
            return s
        }
        return result
    }

    // MARK: - Embedded fixture (synthetic; see header comment)

    // swiftlint:disable line_length
    static let fixtureJSON = """
    {
      "sessions": [
        {
          "id": "aaaa0000-0000-4000-8000-000000000001",
          "startedAt": "2026-08-21T11:31:12Z",
          "endedAt": "2026-08-21T11:35:05Z",
          "readingCount": 3,
          "avgSystolic": 119.0,
          "avgDiastolic": 76.5,
          "avgPulse": 62.0,
          "averagingMethod": "mean_excluding_first",
          "firstReadingExcluded": true,
          "readings": [
            { "id": "bbbb0000-0000-4000-8000-000000000001", "measuredAt": "2026-08-21T11:31:12Z", "measuredTz": "America/New_York", "systolic": 118, "diastolic": 76, "pulse": 62, "source": "withings_api", "sourceApp": null, "sourceDevice": "Withings BPM Connect", "sessionId": "aaaa0000-0000-4000-8000-000000000001", "arm": "unknown", "bodyPosition": "unknown", "note": null, "canonical": true, "duplicateOf": null, "ingestedAt": "2026-08-21T11:39:00Z" },
            { "id": "bbbb0000-0000-4000-8000-000000000002", "measuredAt": "2026-08-21T11:33:20Z", "measuredTz": "America/New_York", "systolic": 121, "diastolic": 78, "pulse": 61, "source": "withings_api", "sourceApp": null, "sourceDevice": "Withings BPM Connect", "sessionId": "aaaa0000-0000-4000-8000-000000000001", "arm": "unknown", "bodyPosition": "unknown", "note": null, "canonical": true, "duplicateOf": null, "ingestedAt": "2026-08-21T11:39:00Z" },
            { "id": "bbbb0000-0000-4000-8000-000000000003", "measuredAt": "2026-08-21T11:35:05Z", "measuredTz": "America/New_York", "systolic": 117, "diastolic": 75, "pulse": 63, "source": "withings_api", "sourceApp": null, "sourceDevice": "Withings BPM Connect", "sessionId": "aaaa0000-0000-4000-8000-000000000001", "arm": "unknown", "bodyPosition": "unknown", "note": null, "canonical": true, "duplicateOf": null, "ingestedAt": "2026-08-21T11:39:00Z" }
          ]
        },
        {
          "id": "aaaa0000-0000-4000-8000-000000000002",
          "startedAt": "2026-08-22T01:14:40Z",
          "endedAt": "2026-08-22T01:16:52Z",
          "readingCount": 2,
          "avgSystolic": 125.0,
          "avgDiastolic": 81.0,
          "avgPulse": 57.5,
          "averagingMethod": "mean_all",
          "firstReadingExcluded": false,
          "readings": [
            { "id": "bbbb0000-0000-4000-8000-000000000004", "measuredAt": "2026-08-22T01:14:40Z", "measuredTz": "America/New_York", "systolic": 124, "diastolic": 80, "pulse": 58, "source": "withings_api", "sourceApp": null, "sourceDevice": "Withings BPM Connect", "sessionId": "aaaa0000-0000-4000-8000-000000000002", "arm": "unknown", "bodyPosition": "unknown", "note": null, "canonical": true, "duplicateOf": null, "ingestedAt": "2026-08-22T01:21:00Z" },
            { "id": "bbbb0000-0000-4000-8000-000000000005", "measuredAt": "2026-08-22T01:16:52Z", "measuredTz": "America/New_York", "systolic": 126, "diastolic": 82, "pulse": 57, "source": "withings_api", "sourceApp": null, "sourceDevice": "Withings BPM Connect", "sessionId": "aaaa0000-0000-4000-8000-000000000002", "arm": "unknown", "bodyPosition": "unknown", "note": null, "canonical": true, "duplicateOf": null, "ingestedAt": "2026-08-22T01:21:00Z" }
          ]
        },
        {
          "id": "aaaa0000-0000-4000-8000-000000000003",
          "startedAt": "2026-08-22T11:29:33Z",
          "endedAt": "2026-08-22T11:31:41Z",
          "readingCount": 2,
          "avgSystolic": 117.5,
          "avgDiastolic": 75.0,
          "avgPulse": 63.0,
          "averagingMethod": "mean_all",
          "firstReadingExcluded": false,
          "readings": [
            { "id": "bbbb0000-0000-4000-8000-000000000006", "measuredAt": "2026-08-22T11:29:33Z", "measuredTz": "America/New_York", "systolic": 116, "diastolic": 74, "pulse": 64, "source": "withings_api", "sourceApp": null, "sourceDevice": "Withings BPM Connect", "sessionId": "aaaa0000-0000-4000-8000-000000000003", "arm": "unknown", "bodyPosition": "unknown", "note": null, "canonical": true, "duplicateOf": null, "ingestedAt": "2026-08-22T11:35:00Z" },
            { "id": "bbbb0000-0000-4000-8000-000000000007", "measuredAt": "2026-08-22T11:31:41Z", "measuredTz": "America/New_York", "systolic": 119, "diastolic": 76, "pulse": 62, "source": "withings_api", "sourceApp": null, "sourceDevice": "Withings BPM Connect", "sessionId": "aaaa0000-0000-4000-8000-000000000003", "arm": "unknown", "bodyPosition": "unknown", "note": null, "canonical": true, "duplicateOf": null, "ingestedAt": "2026-08-22T11:35:00Z" }
          ]
        },
        {
          "id": "aaaa0000-0000-4000-8000-000000000004",
          "startedAt": "2026-08-23T11:40:10Z",
          "endedAt": "2026-08-23T11:44:27Z",
          "readingCount": 3,
          "avgSystolic": 119.0,
          "avgDiastolic": 77.5,
          "avgPulse": 61.0,
          "averagingMethod": "mean_excluding_first",
          "firstReadingExcluded": true,
          "readings": [
            { "id": "bbbb0000-0000-4000-8000-000000000008", "measuredAt": "2026-08-23T11:40:10Z", "measuredTz": "America/New_York", "systolic": 122, "diastolic": 79, "pulse": 60, "source": "withings_api", "sourceApp": null, "sourceDevice": "Withings BPM Connect", "sessionId": "aaaa0000-0000-4000-8000-000000000004", "arm": "unknown", "bodyPosition": "unknown", "note": null, "canonical": true, "duplicateOf": null, "ingestedAt": "2026-08-23T11:48:00Z" },
            { "id": "bbbb0000-0000-4000-8000-000000000009", "measuredAt": "2026-08-23T11:42:18Z", "measuredTz": "America/New_York", "systolic": 118, "diastolic": 77, "pulse": null, "source": "withings_api", "sourceApp": null, "sourceDevice": "Withings BPM Connect", "sessionId": "aaaa0000-0000-4000-8000-000000000004", "arm": "unknown", "bodyPosition": "unknown", "note": null, "canonical": true, "duplicateOf": null, "ingestedAt": "2026-08-23T11:48:00Z" },
            { "id": "bbbb0000-0000-4000-8000-000000000010", "measuredAt": "2026-08-23T11:44:27Z", "measuredTz": "America/New_York", "systolic": 120, "diastolic": 78, "pulse": 61, "source": "withings_api", "sourceApp": null, "sourceDevice": "Withings BPM Connect", "sessionId": "aaaa0000-0000-4000-8000-000000000004", "arm": "unknown", "bodyPosition": "unknown", "note": null, "canonical": true, "duplicateOf": null, "ingestedAt": "2026-08-23T11:48:00Z" }
          ]
        },
        {
          "id": "aaaa0000-0000-4000-8000-000000000005",
          "startedAt": "2026-08-24T01:20:05Z",
          "endedAt": "2026-08-24T01:22:14Z",
          "readingCount": 2,
          "avgSystolic": 126.5,
          "avgDiastolic": 82.5,
          "avgPulse": 56.5,
          "averagingMethod": "mean_all",
          "firstReadingExcluded": false,
          "readings": [
            { "id": "bbbb0000-0000-4000-8000-000000000011", "measuredAt": "2026-08-24T01:20:05Z", "measuredTz": "America/New_York", "systolic": 128, "diastolic": 84, "pulse": 56, "source": "withings_api", "sourceApp": null, "sourceDevice": "Withings BPM Connect", "sessionId": "aaaa0000-0000-4000-8000-000000000005", "arm": "unknown", "bodyPosition": "unknown", "note": null, "canonical": true, "duplicateOf": null, "ingestedAt": "2026-08-24T01:26:00Z" },
            { "id": "bbbb0000-0000-4000-8000-000000000012", "measuredAt": "2026-08-24T01:22:14Z", "measuredTz": "America/New_York", "systolic": 125, "diastolic": 81, "pulse": 57, "source": "withings_api", "sourceApp": null, "sourceDevice": "Withings BPM Connect", "sessionId": "aaaa0000-0000-4000-8000-000000000005", "arm": "unknown", "bodyPosition": "unknown", "note": null, "canonical": true, "duplicateOf": null, "ingestedAt": "2026-08-24T01:26:00Z" }
          ]
        },
        {
          "id": "aaaa0000-0000-4000-8000-000000000006",
          "startedAt": "2026-08-25T01:05:50Z",
          "endedAt": "2026-08-25T01:07:58Z",
          "readingCount": 2,
          "avgSystolic": 128.0,
          "avgDiastolic": 84.0,
          "avgPulse": 58.5,
          "averagingMethod": "mean_all",
          "firstReadingExcluded": false,
          "readings": [
            { "id": "bbbb0000-0000-4000-8000-000000000013", "measuredAt": "2026-08-25T01:05:50Z", "measuredTz": "America/New_York", "systolic": 127, "diastolic": 83, "pulse": 59, "source": "withings_api", "sourceApp": null, "sourceDevice": "Withings BPM Connect", "sessionId": "aaaa0000-0000-4000-8000-000000000006", "arm": "unknown", "bodyPosition": "unknown", "note": null, "canonical": true, "duplicateOf": null, "ingestedAt": "2026-08-25T01:12:00Z" },
            { "id": "bbbb0000-0000-4000-8000-000000000014", "measuredAt": "2026-08-25T01:07:58Z", "measuredTz": "America/New_York", "systolic": 129, "diastolic": 85, "pulse": 58, "source": "withings_api", "sourceApp": null, "sourceDevice": "Withings BPM Connect", "sessionId": "aaaa0000-0000-4000-8000-000000000006", "arm": "unknown", "bodyPosition": "unknown", "note": null, "canonical": true, "duplicateOf": null, "ingestedAt": "2026-08-25T01:12:00Z" }
          ]
        },
        {
          "id": "aaaa0000-0000-4000-8000-000000000007",
          "startedAt": "2026-08-25T11:33:22Z",
          "endedAt": "2026-08-25T11:35:31Z",
          "readingCount": 2,
          "avgSystolic": 119.0,
          "avgDiastolic": 76.5,
          "avgPulse": 61.5,
          "averagingMethod": "mean_all",
          "firstReadingExcluded": false,
          "readings": [
            { "id": "bbbb0000-0000-4000-8000-000000000015", "measuredAt": "2026-08-25T11:33:22Z", "measuredTz": "America/New_York", "systolic": 120, "diastolic": 77, "pulse": 61, "source": "withings_api", "sourceApp": null, "sourceDevice": "Withings BPM Connect", "sessionId": "aaaa0000-0000-4000-8000-000000000007", "arm": "unknown", "bodyPosition": "unknown", "note": null, "canonical": true, "duplicateOf": null, "ingestedAt": "2026-08-25T11:39:00Z" },
            { "id": "bbbb0000-0000-4000-8000-000000000016", "measuredAt": "2026-08-25T11:35:31Z", "measuredTz": "America/New_York", "systolic": 118, "diastolic": 76, "pulse": 62, "source": "withings_api", "sourceApp": null, "sourceDevice": "Withings BPM Connect", "sessionId": "aaaa0000-0000-4000-8000-000000000007", "arm": "unknown", "bodyPosition": "unknown", "note": null, "canonical": true, "duplicateOf": null, "ingestedAt": "2026-08-25T11:39:00Z" }
          ]
        },
        {
          "id": "aaaa0000-0000-4000-8000-000000000008",
          "startedAt": "2026-08-26T16:45:09Z",
          "endedAt": "2026-08-26T16:45:09Z",
          "readingCount": 1,
          "avgSystolic": 121.0,
          "avgDiastolic": 78.0,
          "avgPulse": 63.0,
          "averagingMethod": "mean_all",
          "firstReadingExcluded": false,
          "readings": [
            { "id": "bbbb0000-0000-4000-8000-000000000017", "measuredAt": "2026-08-26T16:45:09Z", "measuredTz": "America/New_York", "systolic": 121, "diastolic": 78, "pulse": 63, "source": "manual", "sourceApp": null, "sourceDevice": null, "sessionId": "aaaa0000-0000-4000-8000-000000000008", "arm": "left", "bodyPosition": "seated", "note": "Pharmacy machine reading, entered by hand", "canonical": true, "duplicateOf": null, "ingestedAt": "2026-08-26T16:46:00Z" }
          ]
        },
        {
          "id": "aaaa0000-0000-4000-8000-000000000009",
          "startedAt": "2026-08-27T11:36:44Z",
          "endedAt": "2026-08-27T11:40:59Z",
          "readingCount": 3,
          "avgSystolic": 115.5,
          "avgDiastolic": 73.5,
          "avgPulse": 63.0,
          "averagingMethod": "mean_excluding_first",
          "firstReadingExcluded": true,
          "readings": [
            { "id": "bbbb0000-0000-4000-8000-000000000018", "measuredAt": "2026-08-27T11:36:44Z", "measuredTz": "America/New_York", "systolic": 115, "diastolic": 73, "pulse": 63, "source": "withings_api", "sourceApp": null, "sourceDevice": "Withings BPM Connect", "sessionId": "aaaa0000-0000-4000-8000-000000000009", "arm": "unknown", "bodyPosition": "unknown", "note": null, "canonical": true, "duplicateOf": null, "ingestedAt": "2026-08-27T11:45:00Z" },
            { "id": "bbbb0000-0000-4000-8000-000000000019", "measuredAt": "2026-08-27T11:38:52Z", "measuredTz": "America/New_York", "systolic": 117, "diastolic": 75, "pulse": 62, "source": "withings_api", "sourceApp": null, "sourceDevice": "Withings BPM Connect", "sessionId": "aaaa0000-0000-4000-8000-000000000009", "arm": "unknown", "bodyPosition": "unknown", "note": null, "canonical": true, "duplicateOf": null, "ingestedAt": "2026-08-27T11:45:00Z" },
            { "id": "bbbb0000-0000-4000-8000-000000000020", "measuredAt": "2026-08-27T11:40:59Z", "measuredTz": "America/New_York", "systolic": 114, "diastolic": 72, "pulse": 64, "source": "withings_api", "sourceApp": null, "sourceDevice": "Withings BPM Connect", "sessionId": "aaaa0000-0000-4000-8000-000000000009", "arm": "unknown", "bodyPosition": "unknown", "note": null, "canonical": true, "duplicateOf": null, "ingestedAt": "2026-08-27T11:45:00Z" }
          ]
        },
        {
          "id": "aaaa0000-0000-4000-8000-000000000010",
          "startedAt": "2026-08-28T01:18:31Z",
          "endedAt": "2026-08-28T01:20:39Z",
          "readingCount": 2,
          "avgSystolic": 124.5,
          "avgDiastolic": 81.0,
          "avgPulse": 57.5,
          "averagingMethod": "mean_all",
          "firstReadingExcluded": false,
          "readings": [
            { "id": "bbbb0000-0000-4000-8000-000000000021", "measuredAt": "2026-08-28T01:18:31Z", "measuredTz": "America/New_York", "systolic": 126, "diastolic": 82, "pulse": 57, "source": "withings_api", "sourceApp": null, "sourceDevice": "Withings BPM Connect", "sessionId": "aaaa0000-0000-4000-8000-000000000010", "arm": "unknown", "bodyPosition": "unknown", "note": null, "canonical": true, "duplicateOf": null, "ingestedAt": "2026-08-28T01:25:00Z" },
            { "id": "bbbb0000-0000-4000-8000-000000000022", "measuredAt": "2026-08-28T01:20:39Z", "measuredTz": "America/New_York", "systolic": 123, "diastolic": 80, "pulse": 58, "source": "withings_api", "sourceApp": null, "sourceDevice": "Withings BPM Connect", "sessionId": "aaaa0000-0000-4000-8000-000000000010", "arm": "unknown", "bodyPosition": "unknown", "note": null, "canonical": true, "duplicateOf": null, "ingestedAt": "2026-08-28T01:25:00Z" }
          ]
        },
        {
          "id": "aaaa0000-0000-4000-8000-000000000011",
          "startedAt": "2026-08-28T11:32:15Z",
          "endedAt": "2026-08-28T11:34:23Z",
          "readingCount": 2,
          "avgSystolic": 120.0,
          "avgDiastolic": 77.0,
          "avgPulse": 60.5,
          "averagingMethod": "mean_all",
          "firstReadingExcluded": false,
          "readings": [
            { "id": "bbbb0000-0000-4000-8000-000000000023", "measuredAt": "2026-08-28T11:32:15Z", "measuredTz": "America/New_York", "systolic": 119, "diastolic": 76, "pulse": 61, "source": "withings_api", "sourceApp": null, "sourceDevice": "Withings BPM Connect", "sessionId": "aaaa0000-0000-4000-8000-000000000011", "arm": "unknown", "bodyPosition": "unknown", "note": null, "canonical": true, "duplicateOf": null, "ingestedAt": "2026-08-28T11:38:00Z" },
            { "id": "bbbb0000-0000-4000-8000-000000000024", "measuredAt": "2026-08-28T11:34:23Z", "measuredTz": "America/New_York", "systolic": 121, "diastolic": 78, "pulse": 60, "source": "withings_api", "sourceApp": null, "sourceDevice": "Withings BPM Connect", "sessionId": "aaaa0000-0000-4000-8000-000000000011", "arm": "unknown", "bodyPosition": "unknown", "note": null, "canonical": true, "duplicateOf": null, "ingestedAt": "2026-08-28T11:38:00Z" }
          ]
        },
        {
          "id": "aaaa0000-0000-4000-8000-000000000012",
          "startedAt": "2026-08-29T01:15:02Z",
          "endedAt": "2026-08-29T01:19:18Z",
          "readingCount": 3,
          "avgSystolic": 126.0,
          "avgDiastolic": 81.5,
          "avgPulse": 58.0,
          "averagingMethod": "mean_excluding_first",
          "firstReadingExcluded": true,
          "readings": [
            { "id": "bbbb0000-0000-4000-8000-000000000025", "measuredAt": "2026-08-29T01:15:02Z", "measuredTz": "America/New_York", "systolic": 125, "diastolic": 81, "pulse": 58, "source": "withings_api", "sourceApp": null, "sourceDevice": "Withings BPM Connect", "sessionId": "aaaa0000-0000-4000-8000-000000000012", "arm": "unknown", "bodyPosition": "unknown", "note": null, "canonical": true, "duplicateOf": null, "ingestedAt": "2026-08-29T01:23:00Z" },
            { "id": "bbbb0000-0000-4000-8000-000000000026", "measuredAt": "2026-08-29T01:17:10Z", "measuredTz": "America/New_York", "systolic": 128, "diastolic": 83, "pulse": 57, "source": "withings_api", "sourceApp": null, "sourceDevice": "Withings BPM Connect", "sessionId": "aaaa0000-0000-4000-8000-000000000012", "arm": "unknown", "bodyPosition": "unknown", "note": null, "canonical": true, "duplicateOf": null, "ingestedAt": "2026-08-29T01:23:00Z" },
            { "id": "bbbb0000-0000-4000-8000-000000000027", "measuredAt": "2026-08-29T01:19:18Z", "measuredTz": "America/New_York", "systolic": 124, "diastolic": 80, "pulse": 59, "source": "withings_api", "sourceApp": null, "sourceDevice": "Withings BPM Connect", "sessionId": "aaaa0000-0000-4000-8000-000000000012", "arm": "unknown", "bodyPosition": "unknown", "note": null, "canonical": true, "duplicateOf": null, "ingestedAt": "2026-08-29T01:23:00Z" }
          ]
        }
      ],
      "duplicateReadings": [
        { "id": "cccc0000-0000-4000-8000-000000000001", "measuredAt": "2026-08-25T11:33:22Z", "measuredTz": "America/New_York", "systolic": 120, "diastolic": 77, "pulse": 61, "source": "apple_health", "sourceApp": "Health Mate", "sourceDevice": "BPM Connect", "sessionId": null, "arm": "unknown", "bodyPosition": "unknown", "note": null, "canonical": false, "duplicateOf": "bbbb0000-0000-4000-8000-000000000015", "ingestedAt": "2026-08-25T14:33:00Z" }
      ],
      "sources": [
        {
          "provider": "withings",
          "displayName": "Withings",
          "connectionStatus": "connected",
          "freshness": { "status": "RECENT", "latestMeasuredAt": "2026-08-29T01:19:18Z", "lastSuccessAt": "2026-08-29T01:23:00Z", "expectedLatencySeconds": 300, "ageSeconds": 0 },
          "latestMeasuredAt": "2026-08-29T01:19:18Z",
          "lastSyncAt": "2026-08-29T01:23:00Z",
          "coverageNote": "Blood pressure via the Withings API (webhook + on-demand refresh). Demo fixtures stand in for the real connector.",
          "problems": []
        },
        {
          "provider": "apple_health",
          "displayName": "Apple Health",
          "connectionStatus": "connected",
          "freshness": { "status": "RECENT", "latestMeasuredAt": "2026-08-25T11:33:22Z", "lastSuccessAt": "2026-08-29T01:30:00Z", "expectedLatencySeconds": 3600, "ageSeconds": 0 },
          "latestMeasuredAt": "2026-08-25T11:33:22Z",
          "lastSyncAt": "2026-08-29T01:30:00Z",
          "coverageNote": "Blood pressure correlations read on this device. Duplicates of Withings API readings are suppressed from analytics, never deleted.",
          "problems": []
        },
        {
          "provider": "manual",
          "displayName": "Manual entry",
          "connectionStatus": "connected",
          "freshness": { "status": "RECENT", "latestMeasuredAt": "2026-08-26T16:45:09Z", "lastSuccessAt": "2026-08-26T16:46:00Z", "expectedLatencySeconds": 300, "ageSeconds": 0 },
          "latestMeasuredAt": "2026-08-26T16:45:09Z",
          "lastSyncAt": "2026-08-26T16:46:00Z",
          "coverageNote": "Readings entered by hand in Ben Health OS.",
          "problems": []
        },
        {
          "provider": "oura",
          "displayName": "Oura",
          "connectionStatus": "not_connected",
          "freshness": { "status": "NOT_CONNECTED", "latestMeasuredAt": null, "lastSuccessAt": null, "expectedLatencySeconds": null, "ageSeconds": null },
          "latestMeasuredAt": null,
          "lastSyncAt": null,
          "coverageNote": "Direct Oura integration arrives in Phase 3.",
          "problems": []
        },
        {
          "provider": "stelo",
          "displayName": "Dexcom Stelo",
          "connectionStatus": "not_connected",
          "freshness": { "status": "NOT_CONNECTED", "latestMeasuredAt": null, "lastSuccessAt": null, "expectedLatencySeconds": null, "ageSeconds": null },
          "latestMeasuredAt": null,
          "lastSyncAt": null,
          "coverageNote": "Glucose via Apple Health arrives in Phase 2; Stelo data is source-delayed by design.",
          "problems": []
        },
        {
          "provider": "cronometer",
          "displayName": "Cronometer",
          "connectionStatus": "not_connected",
          "freshness": { "status": "NOT_CONNECTED", "latestMeasuredAt": null, "lastSuccessAt": null, "expectedLatencySeconds": null, "ageSeconds": null },
          "latestMeasuredAt": null,
          "lastSyncAt": null,
          "coverageNote": "Nutrition (Apple Health samples or CSV import) arrives in Phase 4.",
          "problems": []
        },
        {
          "provider": "function",
          "displayName": "Function Health",
          "connectionStatus": "not_connected",
          "freshness": { "status": "NOT_CONNECTED", "latestMeasuredAt": null, "lastSuccessAt": null, "expectedLatencySeconds": null, "ageSeconds": null },
          "latestMeasuredAt": null,
          "lastSyncAt": null,
          "coverageNote": "Lab imports arrive in Phase 4.",
          "problems": []
        },
        {
          "provider": "clinical_records",
          "displayName": "Clinical Records",
          "connectionStatus": "not_connected",
          "freshness": { "status": "NOT_CONNECTED", "latestMeasuredAt": null, "lastSuccessAt": null, "expectedLatencySeconds": null, "ageSeconds": null },
          "latestMeasuredAt": null,
          "lastSyncAt": null,
          "coverageNote": "Apple Clinical Health Records arrive in Phase 4.",
          "problems": []
        }
      ]
    }
    """
    // swiftlint:enable line_length
}

// MARK: - Demo provider

/// In-memory implementation of `BPDataProviding` backed by the fixture above.
/// Mirrors the platform's visible behavior closely enough for the UI: session
/// grouping (gap ≤ 15 min), the ≥3-readings first-excluded averaging rule,
/// canonical-only responses unless duplicates are requested, freshness
/// recomputed from the contract §3 algorithm on every call.
public actor DemoPlatformProvider: BPDataProviding {
    public enum DemoModeError: Error, LocalizedError {
        case withingsConnectUnavailable

        public var errorDescription: String? {
            "Demo mode uses bundled fixtures. Withings connection is available when the app runs against the platform backend (see apps/ios/README.md)."
        }
    }

    private var sessionStore: [BpSessionDto] = []
    private var duplicateReadings: [BpReadingDto] = []
    private var sourceRows: [SourceStatusDto] = []
    private var loaded = false
    private var seenHkUuids: Set<String> = []

    public init() {}

    private func ensureLoaded() throws {
        guard !loaded else { return }
        let fixture = DemoData.rebased(try DemoData.loadFixture(), to: Date())
        sessionStore = fixture.sessions
        duplicateReadings = fixture.duplicateReadings
        sourceRows = fixture.sources
        loaded = true
    }

    private var canonicalReadings: [BpReadingDto] {
        sessionStore.flatMap(\.readings).filter(\.canonical)
    }

    private func expectedLatency(for row: SourceStatusDto) -> TimeInterval {
        TimeInterval(row.freshness.expectedLatencySeconds ?? 300)
    }

    // MARK: BPDataProviding

    public func latest() async throws -> LatestBpResponse {
        try ensureLoaded()
        let now = Date()
        let latestReading = canonicalReadings.max { $0.measuredAt < $1.measuredAt }
        let withings = sourceRows.first { $0.provider == .withings }
        let freshness = Freshness.dto(FreshnessInputs(
            connectionStatus: withings?.connectionStatus ?? .connected,
            lastSuccessAt: withings?.lastSyncAt,
            latestMeasuredAt: latestReading?.measuredAt,
            expectedLatencySeconds: withings.map(expectedLatency(for:)) ?? 300,
            now: now
        ))
        return LatestBpResponse(reading: latestReading, freshness: freshness)
    }

    public func readings(from: Date?, to: Date?, includeDuplicates: Bool) async throws -> [BpReadingDto] {
        try ensureLoaded()
        var all = canonicalReadings
        if includeDuplicates {
            all += duplicateReadings
        }
        return all
            .filter { reading in
                (from.map { reading.measuredAt >= $0 } ?? true)
                    && (to.map { reading.measuredAt <= $0 } ?? true)
            }
            .sorted { $0.measuredAt < $1.measuredAt }
    }

    public func sessions(from: Date?, to: Date?) async throws -> [BpSessionDto] {
        try ensureLoaded()
        return sessionStore
            .filter { session in
                (from.map { session.startedAt >= $0 } ?? true)
                    && (to.map { session.startedAt <= $0 } ?? true)
            }
            .sorted { $0.startedAt < $1.startedAt }
    }

    public func summary(window: SummaryWindow) async throws -> BpSummaryDto {
        try ensureLoaded()
        let now = Date()
        let from = now.addingTimeInterval(-Double(window.days) * 86_400)
        let inWindow = canonicalReadings.filter { $0.measuredAt >= from && $0.measuredAt <= now }
        let sessionCount = sessionStore.filter { $0.startedAt >= from && $0.startedAt <= now }.count

        func means(for filter: DaypartFilter) -> DaypartMeansDto {
            let filtered = inWindow.filter { BPDisplayMath.matches($0, filter: filter) }
            return DaypartMeansDto(
                readingCount: filtered.count,
                meanSystolic: BPDisplayMath.mean(filtered.map(\.systolic)),
                meanDiastolic: BPDisplayMath.mean(filtered.map(\.diastolic)),
                meanPulse: BPDisplayMath.meanOfPresent(filtered.map(\.pulse))
            )
        }

        let daily = BPDisplayMath.dailyPoints(readings: inWindow).map { point in
            DailyBpDto(
                date: point.date,
                meanSystolic: point.meanSystolic,
                meanDiastolic: point.meanDiastolic,
                sessionCount: sessionStore.filter { session in
                    session.readings.contains { reading in
                        BPDisplayMath.dayKey(for: reading.measuredAt,
                                             timeZoneIdentifier: reading.measuredTz) == point.date
                    }
                }.count
            )
        }

        return BpSummaryDto(
            window: window,
            from: from,
            to: now,
            readingCount: inWindow.count,
            sessionCount: sessionCount,
            meanSystolic: BPDisplayMath.mean(inWindow.map(\.systolic)),
            meanDiastolic: BPDisplayMath.mean(inWindow.map(\.diastolic)),
            meanPulse: BPDisplayMath.meanOfPresent(inWindow.map(\.pulse)),
            morning: means(for: .morning),
            evening: means(for: .evening),
            daily: daily
        )
    }

    public func submitManual(_ entry: ManualBpEntry) async throws -> BpReadingDto {
        try ensureLoaded()
        let reading = BpReadingDto(
            id: UUID().uuidString.lowercased(),
            measuredAt: entry.measuredAt,
            measuredTz: entry.measuredTz,
            systolic: entry.systolic,
            diastolic: entry.diastolic,
            pulse: entry.pulse,
            source: .manual,
            sourceApp: nil,
            sourceDevice: nil,
            sessionId: nil,
            arm: entry.arm ?? .unknown,
            bodyPosition: entry.bodyPosition ?? .unknown,
            note: entry.note,
            canonical: true,
            duplicateOf: nil,
            ingestedAt: Date()
        )
        attach(reading)
        touchSourceLatest(.manual, measuredAt: reading.measuredAt)
        return readingWithSession(reading.id) ?? reading
    }

    public func sources() async throws -> [SourceStatusDto] {
        try ensureLoaded()
        let now = Date()
        return sourceRows.map { row in
            var updated = row
            updated.freshness = Freshness.dto(FreshnessInputs(
                connectionStatus: row.connectionStatus,
                lastSuccessAt: row.lastSyncAt,
                latestMeasuredAt: row.latestMeasuredAt,
                expectedLatencySeconds: expectedLatency(for: row),
                now: now
            ))
            return updated
        }
    }

    public func withingsConnectURL() async throws -> URL {
        throw DemoModeError.withingsConnectUnavailable
    }

    public func withingsRefresh() async throws -> Int {
        try ensureLoaded()
        // The fixture connector has nothing new to deliver; a refresh still
        // records a successful sync (which is exactly what the real platform
        // reports when Withings has no new measurement groups).
        if let index = sourceRows.firstIndex(where: { $0.provider == .withings }) {
            sourceRows[index].lastSyncAt = Date()
        }
        return 0
    }

    public func ingestHealthKit(_ batch: HealthKitBpBatch) async throws -> HealthKitIngestResponse {
        try ensureLoaded()
        var accepted = 0
        var duplicates = 0

        for sample in batch.samples {
            if seenHkUuids.contains(sample.hkUuid) {
                duplicates += 1
                continue
            }
            seenHkUuids.insert(sample.hkUuid)

            if isCrossSourceDuplicate(sample) {
                duplicates += 1
                continue
            }

            let reading = BpReadingDto(
                id: UUID().uuidString.lowercased(),
                measuredAt: sample.measuredAt,
                measuredTz: sample.measuredTz,
                systolic: sample.systolic,
                diastolic: sample.diastolic,
                pulse: sample.pulse,
                source: .appleHealth,
                sourceApp: sample.sourceApp,
                sourceDevice: sample.sourceDevice,
                sessionId: nil,
                arm: .unknown,
                bodyPosition: .unknown,
                note: nil,
                canonical: true,
                duplicateOf: nil,
                ingestedAt: Date()
            )
            attach(reading)
            accepted += 1
        }

        touchSourceLatest(.appleHealth,
                          measuredAt: batch.samples.map(\.measuredAt).max())
        if let index = sourceRows.firstIndex(where: { $0.provider == .appleHealth }) {
            sourceRows[index].lastSyncAt = Date()
        }
        return HealthKitIngestResponse(accepted: accepted, duplicates: duplicates)
    }

    // MARK: Internals

    /// Contract §4 rule 5 (cross-source): |Δ measured_at| ≤ 180 s AND equal
    /// rounded systolic/diastolic AND pulse both null or |Δ| ≤ 5.
    private func isCrossSourceDuplicate(_ sample: HealthKitBpSample) -> Bool {
        canonicalReadings.contains { existing in
            abs(existing.measuredAt.timeIntervalSince(sample.measuredAt)) <= 180
                && Int(existing.systolic.rounded()) == Int(sample.systolic.rounded())
                && Int(existing.diastolic.rounded()) == Int(sample.diastolic.rounded())
                && pulsesMatch(existing.pulse, sample.pulse)
        }
    }

    private func pulsesMatch(_ a: Double?, _ b: Double?) -> Bool {
        switch (a, b) {
        case (nil, nil): return true
        case let (x?, y?): return abs(x - y) <= 5
        default: return false
        }
    }

    /// Join the reading to a session within the 15-minute gap rule, or start
    /// a new one; recompute the session average with the shared display math.
    private func attach(_ reading: BpReadingDto) {
        var reading = reading

        let joinableIndex = sessionStore.firstIndex { session in
            guard let last = session.readings.map(\.measuredAt).max(),
                  let first = session.readings.map(\.measuredAt).min() else { return false }
            let after = reading.measuredAt.timeIntervalSince(last)
            let before = first.timeIntervalSince(reading.measuredAt)
            return (after >= 0 && after <= BPDisplayMath.sessionGapSeconds)
                || (before >= 0 && before <= BPDisplayMath.sessionGapSeconds)
        }

        if let index = joinableIndex {
            reading.sessionId = sessionStore[index].id
            sessionStore[index].readings.append(reading)
            recompute(sessionAt: index)
        } else {
            let sessionId = UUID().uuidString.lowercased()
            reading.sessionId = sessionId
            let average = BPDisplayMath.sessionAverage(of: [reading])
            sessionStore.append(BpSessionDto(
                id: sessionId,
                startedAt: reading.measuredAt,
                endedAt: reading.measuredAt,
                readingCount: 1,
                avgSystolic: average.avgSystolic,
                avgDiastolic: average.avgDiastolic,
                avgPulse: average.avgPulse,
                averagingMethod: average.averagingMethod,
                firstReadingExcluded: average.firstReadingExcluded,
                readings: [reading]
            ))
        }
    }

    private func recompute(sessionAt index: Int) {
        let ordered = sessionStore[index].readings.sorted { $0.measuredAt < $1.measuredAt }
        let average = BPDisplayMath.sessionAverage(of: ordered)
        sessionStore[index].readings = ordered
        sessionStore[index].readingCount = ordered.count
        sessionStore[index].startedAt = ordered.first?.measuredAt ?? sessionStore[index].startedAt
        sessionStore[index].endedAt = ordered.last?.measuredAt ?? sessionStore[index].endedAt
        sessionStore[index].avgSystolic = average.avgSystolic
        sessionStore[index].avgDiastolic = average.avgDiastolic
        sessionStore[index].avgPulse = average.avgPulse
        sessionStore[index].averagingMethod = average.averagingMethod
        sessionStore[index].firstReadingExcluded = average.firstReadingExcluded
    }

    private func touchSourceLatest(_ provider: Provider, measuredAt: Date?) {
        guard let measuredAt,
              let index = sourceRows.firstIndex(where: { $0.provider == provider }) else { return }
        let current = sourceRows[index].latestMeasuredAt
        if current == nil || measuredAt > (current ?? .distantPast) {
            sourceRows[index].latestMeasuredAt = measuredAt
        }
        sourceRows[index].lastSyncAt = Date()
    }

    private func readingWithSession(_ id: String) -> BpReadingDto? {
        sessionStore.flatMap(\.readings).first { $0.id == id }
    }
}
