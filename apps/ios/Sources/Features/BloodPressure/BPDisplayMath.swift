import Foundation

// Client-side DISPLAY math only. The platform remains the source of truth for
// stored sessions and summaries; these helpers exist to
//   - split trend charts into morning/evening (contract §5: morning =
//     04:00–11:59 local by measured_tz, UTC fallback; evening = 17:00–23:59),
//   - aggregate readings into per-day chart points by measurement-local date,
//   - preview session averages (mean_excluding_first when ≥ 3 readings,
//     else mean_all — contract §4),
//   - group readings into sessions for the demo provider (gap ≤ 15 min).
// Covered by SessionMathTests.

public enum Daypart: String, Sendable, Equatable {
    case morning
    case evening
    case other
}

public enum DaypartFilter: String, CaseIterable, Identifiable, Sendable {
    case all
    case morning
    case evening

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .all: return "All"
        case .morning: return "Morning"
        case .evening: return "Evening"
        }
    }
}

public enum BPDisplayMath {
    public static let sessionGapSeconds: TimeInterval = 15 * 60

    // MARK: Time zone handling

    /// Measurement-local time zone: IANA `measuredTz` when known, UTC fallback
    /// (matches the contract's morning/evening definition).
    public static func timeZone(for identifier: String?) -> TimeZone {
        if let identifier, let tz = TimeZone(identifier: identifier) {
            return tz
        }
        return TimeZone(identifier: "UTC") ?? .gmt
    }

    static func localCalendar(for tzIdentifier: String?) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone(for: tzIdentifier)
        return calendar
    }

    // MARK: Dayparts

    /// Morning = 04:00–11:59 local; evening = 17:00–23:59 local.
    public static func daypart(of date: Date, timeZoneIdentifier: String?) -> Daypart {
        let hour = localCalendar(for: timeZoneIdentifier).component(.hour, from: date)
        switch hour {
        case 4...11: return .morning
        case 17...23: return .evening
        default: return .other
        }
    }

    public static func matches(_ reading: BpReadingDto, filter: DaypartFilter) -> Bool {
        switch filter {
        case .all:
            return true
        case .morning:
            return daypart(of: reading.measuredAt, timeZoneIdentifier: reading.measuredTz) == .morning
        case .evening:
            return daypart(of: reading.measuredAt, timeZoneIdentifier: reading.measuredTz) == .evening
        }
    }

    // MARK: Means (missing values stay missing — never coerced to zero)

    public static func mean(_ values: [Double]) -> Double? {
        guard !values.isEmpty else { return nil }
        return values.reduce(0, +) / Double(values.count)
    }

    /// Mean over the non-nil values; nil when none exist.
    public static func meanOfPresent(_ values: [Double?]) -> Double? {
        mean(values.compactMap { $0 })
    }

    // MARK: Daily aggregation (chart points)

    /// Measurement-local calendar date key, `yyyy-MM-dd`.
    public static func dayKey(for date: Date, timeZoneIdentifier: String?) -> String {
        let calendar = localCalendar(for: tzIdentifierOrNil(timeZoneIdentifier))
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        let year = c.year ?? 1970
        let month = c.month ?? 1
        let day = c.day ?? 1
        return String(format: "%04d-%02d-%02d", year, month, day)
    }

    private static func tzIdentifierOrNil(_ identifier: String?) -> String? { identifier }

    public struct DailyPoint: Identifiable, Equatable, Sendable {
        /// `yyyy-MM-dd` in measurement-local time.
        public var date: String
        /// Local midnight of that day (chart x value).
        public var day: Date
        public var meanSystolic: Double?
        public var meanDiastolic: Double?
        public var meanPulse: Double?
        public var readingCount: Int

        public var id: String { date }
    }

    /// Group canonical readings into one point per measurement-local day.
    /// Sorted ascending by day.
    public static func dailyPoints(readings: [BpReadingDto]) -> [DailyPoint] {
        struct Accumulator {
            var day: Date
            var systolics: [Double] = []
            var diastolics: [Double] = []
            var pulses: [Double?] = []
        }

        var buckets: [String: Accumulator] = [:]
        for reading in readings where reading.canonical {
            let key = dayKey(for: reading.measuredAt, timeZoneIdentifier: reading.measuredTz)
            let calendar = localCalendar(for: reading.measuredTz)
            let dayStart = calendar.startOfDay(for: reading.measuredAt)
            var acc = buckets[key] ?? Accumulator(day: dayStart)
            acc.systolics.append(reading.systolic)
            acc.diastolics.append(reading.diastolic)
            acc.pulses.append(reading.pulse)
            buckets[key] = acc
        }

        return buckets
            .map { key, acc in
                DailyPoint(
                    date: key,
                    day: acc.day,
                    meanSystolic: mean(acc.systolics),
                    meanDiastolic: mean(acc.diastolics),
                    meanPulse: meanOfPresent(acc.pulses),
                    readingCount: acc.systolics.count
                )
            }
            .sorted { $0.date < $1.date }
    }

    // MARK: Session averaging (contract §4 preview)

    public struct SessionAverage: Equatable, Sendable {
        public var avgSystolic: Double?
        public var avgDiastolic: Double?
        public var avgPulse: Double?
        public var averagingMethod: AveragingMethod
        public var firstReadingExcluded: Bool
    }

    /// `mean_excluding_first` when the session has ≥ 3 readings, else
    /// `mean_all`. Pulse averages only the present values in the included
    /// slice; if none are present it stays nil.
    public static func sessionAverage(of readings: [BpReadingDto]) -> SessionAverage {
        let ordered = readings.sorted { $0.measuredAt < $1.measuredAt }
        let excludeFirst = ordered.count >= 3
        let included = excludeFirst ? Array(ordered.dropFirst()) : ordered
        return SessionAverage(
            avgSystolic: mean(included.map(\.systolic)),
            avgDiastolic: mean(included.map(\.diastolic)),
            avgPulse: meanOfPresent(included.map(\.pulse)),
            averagingMethod: excludeFirst ? .meanExcludingFirst : .meanAll,
            firstReadingExcluded: excludeFirst
        )
    }

    // MARK: Session grouping (demo provider; mirrors contract §4)

    /// Consecutive readings with gaps ≤ 15 minutes form one session.
    public static func groupIntoSessions(readings: [BpReadingDto],
                                         maxGap: TimeInterval = sessionGapSeconds) -> [[BpReadingDto]] {
        let ordered = readings.sorted { $0.measuredAt < $1.measuredAt }
        guard let first = ordered.first else { return [] }

        var groups: [[BpReadingDto]] = []
        var current: [BpReadingDto] = [first]
        for reading in ordered.dropFirst() {
            if let previous = current.last,
               reading.measuredAt.timeIntervalSince(previous.measuredAt) <= maxGap {
                current.append(reading)
            } else {
                groups.append(current)
                current = [reading]
            }
        }
        groups.append(current)
        return groups
    }
}
