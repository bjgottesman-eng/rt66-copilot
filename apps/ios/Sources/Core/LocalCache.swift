import Foundation

// Lightweight offline cache: JSON snapshots in Application Support, written
// with `.completeFileProtection` so they are encrypted at rest and unreadable
// while the device is locked. The app stays useful with no connectivity —
// cached data is always presented WITH its cache timestamp, never as fresh.

public actor LocalCache {
    public enum Key: String, CaseIterable, Sendable {
        case latest = "bp-latest"
        case sessions = "bp-sessions"
        case readings = "bp-readings"
        case summary7d = "bp-summary-7d"
        case summary30d = "bp-summary-30d"
        case sources = "sources"

        public static func summary(_ window: SummaryWindow) -> Key {
            switch window {
            case .sevenDays: return .summary7d
            case .thirtyDays: return .summary30d
            }
        }
    }

    public struct Snapshot<Value: Codable & Sendable>: Codable, Sendable {
        public var value: Value
        public var cachedAt: Date

        public init(value: Value, cachedAt: Date) {
            self.value = value
            self.cachedAt = cachedAt
        }
    }

    private let directory: URL

    /// Default location: `<Application Support>/BenHealthOS/Cache`.
    public init(directory: URL? = nil) {
        if let directory {
            self.directory = directory
        } else {
            let base = FileManager.default.urls(for: .applicationSupportDirectory,
                                                in: .userDomainMask).first
                ?? FileManager.default.temporaryDirectory
            self.directory = base
                .appending(path: "BenHealthOS", directoryHint: .isDirectory)
                .appending(path: "Cache", directoryHint: .isDirectory)
        }
    }

    private func fileURL(for key: Key) -> URL {
        directory.appending(path: "\(key.rawValue).json")
    }

    private func ensureDirectory() throws {
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.complete]
        )
    }

    /// Persist a snapshot. Failures are swallowed by callers by design — the
    /// cache is best-effort and must never break the live path.
    public func store<Value: Codable & Sendable>(_ value: Value, key: Key, now: Date = Date()) {
        do {
            try ensureDirectory()
            let snapshot = Snapshot(value: value, cachedAt: now)
            let data = try JSONCoding.makeEncoder().encode(snapshot)
            try data.write(to: fileURL(for: key),
                           options: [.atomic, .completeFileProtection])
        } catch {
            // Best-effort: a failed cache write is not an app error, and we
            // never log payload contents.
        }
    }

    /// Read a snapshot back, or nil if absent/corrupt (corrupt files are removed).
    public func load<Value: Codable & Sendable>(_ type: Value.Type, key: Key) -> Snapshot<Value>? {
        let url = fileURL(for: key)
        guard let data = try? Data(contentsOf: url) else { return nil }
        do {
            return try JSONCoding.makeDecoder().decode(Snapshot<Value>.self, from: data)
        } catch {
            try? FileManager.default.removeItem(at: url)
            return nil
        }
    }

    /// Wipe everything (sign-out path).
    public func clearAll() {
        try? FileManager.default.removeItem(at: directory)
    }
}
