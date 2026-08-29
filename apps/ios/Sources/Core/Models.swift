import Foundation

// Swift mirrors of the Phase 1 DTOs and enums.
// NORMATIVE SOURCE: docs/contracts/phase1-contracts.md §2 (enums) and §5 (DTOs).
// Raw values and JSON field names below are exact contract strings — do not
// rename without an ADR + contract change.

// MARK: - Enums (exact raw values)

public enum Provider: String, Codable, CaseIterable, Sendable {
    case withings
    case appleHealth = "apple_health"
    case oura
    case stelo
    case cronometer
    case function
    case clinicalRecords = "clinical_records"
    case manual
    case benhealth
}

public enum ConnectionStatus: String, Codable, CaseIterable, Sendable {
    case connected
    case error
    case revoked
    case notConnected = "not_connected"
}

public enum FreshnessStatus: String, Codable, CaseIterable, Sendable {
    case current = "CURRENT"
    case recent = "RECENT"
    case delayedBySource = "DELAYED_BY_SOURCE"
    case stale = "STALE"
    case syncError = "SYNC_ERROR"
    case notConnected = "NOT_CONNECTED"
    case insufficientData = "INSUFFICIENT_DATA"
}

public enum BpSource: String, Codable, CaseIterable, Sendable {
    case withingsApi = "withings_api"
    case appleHealth = "apple_health"
    case manual
}

public enum Arm: String, Codable, CaseIterable, Sendable {
    case left
    case right
    case unknown
}

public enum BodyPosition: String, Codable, CaseIterable, Sendable {
    case seated
    case standing
    case lying
    case unknown
}

public enum AveragingMethod: String, Codable, CaseIterable, Sendable {
    case meanAll = "mean_all"
    case meanExcludingFirst = "mean_excluding_first"
}

/// `GET /bp/summary?window=` accepts exactly these strings.
public enum SummaryWindow: String, Codable, CaseIterable, Sendable, Identifiable {
    case sevenDays = "7d"
    case thirtyDays = "30d"

    public var id: String { rawValue }

    public var days: Int {
        switch self {
        case .sevenDays: return 7
        case .thirtyDays: return 30
        }
    }
}

// MARK: - DTOs (contracts §5; camelCase field names are the wire names)

public struct BpReadingDto: Codable, Identifiable, Hashable, Sendable {
    public var id: String
    public var measuredAt: Date
    public var measuredTz: String?
    public var systolic: Double
    public var diastolic: Double
    public var pulse: Double?          // absent pulse stays nil — never coerced to 0
    public var source: BpSource
    public var sourceApp: String?
    public var sourceDevice: String?
    public var sessionId: String?
    public var arm: Arm?
    public var bodyPosition: BodyPosition?
    public var note: String?
    public var canonical: Bool
    public var duplicateOf: String?
    public var ingestedAt: Date

    public init(id: String, measuredAt: Date, measuredTz: String? = nil,
                systolic: Double, diastolic: Double, pulse: Double? = nil,
                source: BpSource, sourceApp: String? = nil, sourceDevice: String? = nil,
                sessionId: String? = nil, arm: Arm? = nil, bodyPosition: BodyPosition? = nil,
                note: String? = nil, canonical: Bool = true, duplicateOf: String? = nil,
                ingestedAt: Date) {
        self.id = id
        self.measuredAt = measuredAt
        self.measuredTz = measuredTz
        self.systolic = systolic
        self.diastolic = diastolic
        self.pulse = pulse
        self.source = source
        self.sourceApp = sourceApp
        self.sourceDevice = sourceDevice
        self.sessionId = sessionId
        self.arm = arm
        self.bodyPosition = bodyPosition
        self.note = note
        self.canonical = canonical
        self.duplicateOf = duplicateOf
        self.ingestedAt = ingestedAt
    }
}

public struct BpSessionDto: Codable, Identifiable, Hashable, Sendable {
    public var id: String
    public var startedAt: Date
    public var endedAt: Date?
    public var readingCount: Int
    public var avgSystolic: Double?
    public var avgDiastolic: Double?
    public var avgPulse: Double?
    public var averagingMethod: AveragingMethod
    public var firstReadingExcluded: Bool
    public var readings: [BpReadingDto]

    public init(id: String, startedAt: Date, endedAt: Date? = nil, readingCount: Int,
                avgSystolic: Double? = nil, avgDiastolic: Double? = nil, avgPulse: Double? = nil,
                averagingMethod: AveragingMethod, firstReadingExcluded: Bool,
                readings: [BpReadingDto]) {
        self.id = id
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.readingCount = readingCount
        self.avgSystolic = avgSystolic
        self.avgDiastolic = avgDiastolic
        self.avgPulse = avgPulse
        self.averagingMethod = averagingMethod
        self.firstReadingExcluded = firstReadingExcluded
        self.readings = readings
    }
}

/// Morning = 04:00–11:59 local (measured_tz or UTC fallback); evening = 17:00–23:59.
public struct DaypartMeansDto: Codable, Hashable, Sendable {
    public var readingCount: Int?
    public var meanSystolic: Double?
    public var meanDiastolic: Double?
    public var meanPulse: Double?

    public init(readingCount: Int? = nil, meanSystolic: Double? = nil,
                meanDiastolic: Double? = nil, meanPulse: Double? = nil) {
        self.readingCount = readingCount
        self.meanSystolic = meanSystolic
        self.meanDiastolic = meanDiastolic
        self.meanPulse = meanPulse
    }
}

public struct DailyBpDto: Codable, Hashable, Sendable {
    /// Measurement-local calendar date, `yyyy-MM-dd`.
    public var date: String
    public var meanSystolic: Double?
    public var meanDiastolic: Double?
    public var sessionCount: Int

    public init(date: String, meanSystolic: Double? = nil, meanDiastolic: Double? = nil,
                sessionCount: Int) {
        self.date = date
        self.meanSystolic = meanSystolic
        self.meanDiastolic = meanDiastolic
        self.sessionCount = sessionCount
    }
}

public struct BpSummaryDto: Codable, Hashable, Sendable {
    public var window: SummaryWindow
    public var from: Date
    public var to: Date
    public var readingCount: Int
    public var sessionCount: Int
    public var meanSystolic: Double?
    public var meanDiastolic: Double?
    public var meanPulse: Double?
    public var morning: DaypartMeansDto
    public var evening: DaypartMeansDto
    public var daily: [DailyBpDto]

    public init(window: SummaryWindow, from: Date, to: Date, readingCount: Int,
                sessionCount: Int, meanSystolic: Double? = nil, meanDiastolic: Double? = nil,
                meanPulse: Double? = nil, morning: DaypartMeansDto, evening: DaypartMeansDto,
                daily: [DailyBpDto]) {
        self.window = window
        self.from = from
        self.to = to
        self.readingCount = readingCount
        self.sessionCount = sessionCount
        self.meanSystolic = meanSystolic
        self.meanDiastolic = meanDiastolic
        self.meanPulse = meanPulse
        self.morning = morning
        self.evening = evening
        self.daily = daily
    }
}

public struct FreshnessDto: Codable, Hashable, Sendable {
    public var status: FreshnessStatus
    public var latestMeasuredAt: Date?
    public var lastSuccessAt: Date?
    public var expectedLatencySeconds: Int?
    public var ageSeconds: Int?

    public init(status: FreshnessStatus, latestMeasuredAt: Date? = nil,
                lastSuccessAt: Date? = nil, expectedLatencySeconds: Int? = nil,
                ageSeconds: Int? = nil) {
        self.status = status
        self.latestMeasuredAt = latestMeasuredAt
        self.lastSuccessAt = lastSuccessAt
        self.expectedLatencySeconds = expectedLatencySeconds
        self.ageSeconds = ageSeconds
    }
}

public struct SourceStatusDto: Codable, Identifiable, Hashable, Sendable {
    public var provider: Provider
    public var displayName: String
    public var connectionStatus: ConnectionStatus
    public var freshness: FreshnessDto
    public var latestMeasuredAt: Date?
    public var lastSyncAt: Date?
    public var coverageNote: String?
    public var problems: [String]

    public var id: String { provider.rawValue }

    public init(provider: Provider, displayName: String, connectionStatus: ConnectionStatus,
                freshness: FreshnessDto, latestMeasuredAt: Date? = nil, lastSyncAt: Date? = nil,
                coverageNote: String? = nil, problems: [String] = []) {
        self.provider = provider
        self.displayName = displayName
        self.connectionStatus = connectionStatus
        self.freshness = freshness
        self.latestMeasuredAt = latestMeasuredAt
        self.lastSyncAt = lastSyncAt
        self.coverageNote = coverageNote
        self.problems = problems
    }
}

/// Body of `POST /bp/manual`. `saveToAppleHealth` is echoed by the server for
/// the iOS client to act on; the server itself just stores the reading.
public struct ManualBpEntry: Codable, Hashable, Sendable {
    public var systolic: Double
    public var diastolic: Double
    public var pulse: Double?
    public var measuredAt: Date
    public var measuredTz: String?
    public var arm: Arm?
    public var bodyPosition: BodyPosition?
    public var seatedRestMinutes: Double?
    public var readingNumberInSession: Int?
    public var note: String?
    public var saveToAppleHealth: Bool?

    public init(systolic: Double, diastolic: Double, pulse: Double? = nil,
                measuredAt: Date, measuredTz: String? = nil, arm: Arm? = nil,
                bodyPosition: BodyPosition? = nil, seatedRestMinutes: Double? = nil,
                readingNumberInSession: Int? = nil, note: String? = nil,
                saveToAppleHealth: Bool? = nil) {
        self.systolic = systolic
        self.diastolic = diastolic
        self.pulse = pulse
        self.measuredAt = measuredAt
        self.measuredTz = measuredTz
        self.arm = arm
        self.bodyPosition = bodyPosition
        self.seatedRestMinutes = seatedRestMinutes
        self.readingNumberInSession = readingNumberInSession
        self.note = note
        self.saveToAppleHealth = saveToAppleHealth
    }
}

/// Body of `POST /ingest/healthkit`.
public struct HealthKitBpSample: Codable, Hashable, Sendable {
    public var hkUuid: String
    public var measuredAt: Date
    public var measuredTz: String?
    public var systolic: Double
    public var diastolic: Double
    public var pulse: Double?
    public var sourceApp: String
    public var sourceDevice: String
    public var sourceBundleId: String

    public init(hkUuid: String, measuredAt: Date, measuredTz: String? = nil,
                systolic: Double, diastolic: Double, pulse: Double? = nil,
                sourceApp: String, sourceDevice: String, sourceBundleId: String) {
        self.hkUuid = hkUuid
        self.measuredAt = measuredAt
        self.measuredTz = measuredTz
        self.systolic = systolic
        self.diastolic = diastolic
        self.pulse = pulse
        self.sourceApp = sourceApp
        self.sourceDevice = sourceDevice
        self.sourceBundleId = sourceBundleId
    }
}

public struct HealthKitBpBatch: Codable, Hashable, Sendable {
    public var deviceAnchor: String?
    public var samples: [HealthKitBpSample]

    public init(deviceAnchor: String? = nil, samples: [HealthKitBpSample]) {
        self.deviceAnchor = deviceAnchor
        self.samples = samples
    }
}

// MARK: - Response envelopes (contracts §5 endpoint shapes)

public struct UserDto: Codable, Hashable, Sendable {
    public var id: String
    public var email: String

    public init(id: String, email: String) {
        self.id = id
        self.email = email
    }
}

public struct LoginResponse: Codable, Sendable {
    public var token: String
    public var user: UserDto
}

public struct LatestBpResponse: Codable, Hashable, Sendable {
    public var reading: BpReadingDto?
    public var freshness: FreshnessDto

    public init(reading: BpReadingDto?, freshness: FreshnessDto) {
        self.reading = reading
        self.freshness = freshness
    }
}

public struct ReadingsResponse: Codable, Sendable {
    public var readings: [BpReadingDto]
}

public struct SessionsResponse: Codable, Sendable {
    public var sessions: [BpSessionDto]
}

public struct SourcesResponse: Codable, Sendable {
    public var sources: [SourceStatusDto]
}

public struct ManualBpResponse: Codable, Sendable {
    public var reading: BpReadingDto
}

public struct WithingsConnectResponse: Codable, Sendable {
    public var authorizeUrl: String
}

public struct WithingsRefreshResponse: Codable, Sendable {
    public var imported: Int
}

public struct HealthKitIngestResponse: Codable, Hashable, Sendable {
    public var accepted: Int
    public var duplicates: Int

    public init(accepted: Int, duplicates: Int) {
        self.accepted = accepted
        self.duplicates = duplicates
    }
}

/// Error envelope: `{ "error": { "code": string, "message": string } }`.
public struct ApiErrorEnvelope: Codable, Sendable {
    public struct Payload: Codable, Sendable {
        public var code: String
        public var message: String
    }

    public var error: Payload
}

// MARK: - JSON coding (ISO-8601 UTC per contract; tolerant of fractional seconds)

public enum JSONCoding {
    private static let isoFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let isoPlain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    public static func parseDate(_ string: String) -> Date? {
        isoFractional.date(from: string) ?? isoPlain.date(from: string)
    }

    public static func formatDate(_ date: Date) -> String {
        isoPlain.string(from: date)
    }

    public static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let raw = try container.decode(String.self)
            guard let date = parseDate(raw) else {
                throw DecodingError.dataCorruptedError(
                    in: container,
                    debugDescription: "Expected ISO-8601 date, got '\(raw)'"
                )
            }
            return date
        }
        return decoder
    }

    public static func makeEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(formatDate(date))
        }
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }
}
