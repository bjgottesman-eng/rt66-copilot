import Foundation

// Formatting helpers. House rules:
// - MEASURED time is the headline everywhere and is rendered in the
//   measurement's own time zone (a reading taken at 07:30 in New York stays
//   "7:30 AM" wherever the phone is now).
// - INGESTED/received time is always available but secondary.
// - Nothing is ever labeled "LIVE".
// - Missing values render as an em dash, never as 0.

public enum BPFormat {
    // MARK: Values

    /// "119/77" — BP readings are conventionally shown as integers.
    public static func value(systolic: Double, diastolic: Double) -> String {
        "\(Int(systolic.rounded()))/\(Int(diastolic.rounded()))"
    }

    /// "119.0/76.5" for session averages (one decimal, matching the platform).
    public static func average(systolic: Double?, diastolic: Double?) -> String {
        guard let systolic, let diastolic else { return "—" }
        return String(format: "%.1f/%.1f", systolic, diastolic)
    }

    public static func pulse(_ pulse: Double?) -> String {
        guard let pulse else { return "—" }
        return "\(Int(pulse.rounded())) bpm"
    }

    public static func averagePulse(_ pulse: Double?) -> String {
        guard let pulse else { return "—" }
        return String(format: "%.1f bpm", pulse)
    }

    // MARK: Times

    /// "Aug 28, 9:19 PM" in the measurement-local time zone.
    public static func measuredTime(_ date: Date, tz: String?) -> String {
        let timeZone = BPDisplayMath.timeZone(for: tz)
        var style = Date.FormatStyle(date: .abbreviated, time: .shortened)
        style.timeZone = timeZone
        return date.formatted(style)
    }

    /// Full measured line, e.g. "Measured Aug 28, 9:19 PM (America/New_York)".
    /// The zone is appended only when it differs from the device zone, to
    /// keep the calm default uncluttered but never misleading.
    public static func measuredLine(_ date: Date, tz: String?,
                                    deviceTimeZone: TimeZone = .current) -> String {
        let measured = measuredTime(date, tz: tz)
        let zone = BPDisplayMath.timeZone(for: tz)
        if tz != nil, zone.identifier != deviceTimeZone.identifier {
            return "Measured \(measured) (\(zone.identifier))"
        }
        return "Measured \(measured)"
    }

    /// "Received Aug 28, 9:23 PM" in the device time zone (ingestion is a
    /// system event, not a measurement).
    public static func ingestedLine(_ date: Date) -> String {
        "Received \(date.formatted(Date.FormatStyle(date: .abbreviated, time: .shortened)))"
    }

    /// Relative age, e.g. "6 hours ago". Injectable now for tests.
    public static func relativeAge(of date: Date, now: Date = Date()) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .full
        return formatter.localizedString(for: date, relativeTo: now)
    }

    /// "7:31 AM" (measurement-local), for compact reading rows.
    public static func shortTime(_ date: Date, tz: String?) -> String {
        let timeZone = BPDisplayMath.timeZone(for: tz)
        var style = Date.FormatStyle(date: .omitted, time: .shortened)
        style.timeZone = timeZone
        return date.formatted(style)
    }

    /// "Thu, Aug 28" (measurement-local), for session headers.
    public static func dayHeader(_ date: Date, tz: String?) -> String {
        let timeZone = BPDisplayMath.timeZone(for: tz)
        var style = Date.FormatStyle(date: .abbreviated, time: .omitted)
        style.timeZone = timeZone
        return date.formatted(style.weekday(.abbreviated))
    }

    // MARK: Source labels

    public static func sourceLabel(_ source: BpSource) -> String {
        switch source {
        case .withingsApi: return "Withings API"
        case .appleHealth: return "Apple Health"
        case .manual: return "Manual entry"
        }
    }

    /// "Withings BPM Connect · Withings API" — device first when known.
    public static func provenanceLine(_ reading: BpReadingDto) -> String {
        var parts: [String] = []
        if let device = reading.sourceDevice, !device.isEmpty, device != "unknown" {
            parts.append(device)
        }
        if let app = reading.sourceApp, !app.isEmpty {
            parts.append(app)
        }
        parts.append(sourceLabel(reading.source))
        return parts.joined(separator: " · ")
    }

    public static func averagingMethodLabel(_ method: AveragingMethod) -> String {
        switch method {
        case .meanAll: return "Average of all readings"
        case .meanExcludingFirst: return "Average excludes first reading"
        }
    }
}
