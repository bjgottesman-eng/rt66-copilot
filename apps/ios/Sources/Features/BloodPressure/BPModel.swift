import Foundation
import Observation

/// Shared blood-pressure view model (Today + BP screens).
/// Loads from the data provider (live platform or demo fixtures), snapshots
/// successful loads into the offline cache, and falls back to that cache —
/// clearly labeled with its age — when the platform is unreachable.
@Observable @MainActor
public final class BPModel {
    public enum Phase: Equatable {
        case idle
        case loading
        case ready
        /// Serving cached data because the platform could not be reached.
        case offline(cachedAt: Date)
        case failed(message: String)
    }

    private let provider: any BPDataProviding
    private let cache: LocalCache

    public private(set) var phase: Phase = .idle
    public private(set) var latest: LatestBpResponse?
    public private(set) var sessions: [BpSessionDto] = []
    /// Canonical readings for the last 30 days (chart + history source).
    public private(set) var windowReadings: [BpReadingDto] = []
    public private(set) var sources: [SourceStatusDto] = []
    public private(set) var summary: BpSummaryDto?

    public var window: SummaryWindow = .sevenDays
    public var daypartFilter: DaypartFilter = .all

    public private(set) var isRefreshingWithings = false
    public private(set) var lastWithingsRefreshImported: Int?
    public var actionError: String?

    public init(provider: any BPDataProviding, cache: LocalCache) {
        self.provider = provider
        self.cache = cache
    }

    // MARK: Derived chart data

    /// Daily points for the selected window + daypart, computed from
    /// measurement times in their own time zones (never ingestion time).
    public var chartPoints: [BPDisplayMath.DailyPoint] {
        let cutoff = Calendar.current.date(byAdding: .day, value: -window.days, to: Date())
            ?? Date().addingTimeInterval(-Double(window.days) * 86400)
        let filtered = windowReadings.filter { reading in
            reading.canonical
                && reading.measuredAt >= cutoff
                && BPDisplayMath.matches(reading, filter: daypartFilter)
        }
        return BPDisplayMath.dailyPoints(readings: filtered)
    }

    public var withingsSource: SourceStatusDto? {
        sources.first { $0.provider == .withings }
    }

    public var sessionsNewestFirst: [BpSessionDto] {
        sessions.sorted { $0.startedAt > $1.startedAt }
    }

    // MARK: Loading

    public func initialLoad() async {
        guard phase == .idle else { return }
        await load()
    }

    public func load() async {
        if phase == .idle { phase = .loading }
        let now = Date()
        let from = Calendar.current.date(byAdding: .day, value: -30, to: now)

        do {
            async let latestTask = provider.latest()
            async let sessionsTask = provider.sessions(from: from, to: now)
            async let readingsTask = provider.readings(from: from, to: now, includeDuplicates: false)
            async let sourcesTask = provider.sources()
            async let summaryTask = provider.summary(window: window)

            let latest = try await latestTask
            let sessions = try await sessionsTask
            let readings = try await readingsTask
            let sources = try await sourcesTask
            let summary = try await summaryTask

            self.latest = latest
            self.sessions = sessions
            self.windowReadings = readings
            self.sources = sources
            self.summary = summary
            self.phase = .ready

            await cache.store(latest, key: .latest)
            await cache.store(sessions, key: .sessions)
            await cache.store(readings, key: .readings)
            await cache.store(sources, key: .sources)
            await cache.store(summary, key: .summary(window))
        } catch {
            await fallBackToCache(error: error)
        }
    }

    public func reloadSummary() async {
        do {
            let summary = try await provider.summary(window: window)
            self.summary = summary
            await cache.store(summary, key: .summary(window))
        } catch {
            if let cached = await cache.load(BpSummaryDto.self, key: .summary(window)) {
                self.summary = cached.value
            }
        }
    }

    private func fallBackToCache(error: Error) async {
        var newestCache: Date?

        if let cached = await cache.load(LatestBpResponse.self, key: .latest) {
            latest = cached.value
            newestCache = cached.cachedAt
        }
        if let cached = await cache.load([BpSessionDto].self, key: .sessions) {
            sessions = cached.value
            newestCache = max(newestCache ?? cached.cachedAt, cached.cachedAt)
        }
        if let cached = await cache.load([BpReadingDto].self, key: .readings) {
            windowReadings = cached.value
        }
        if let cached = await cache.load([SourceStatusDto].self, key: .sources) {
            sources = cached.value
        }
        if let cached = await cache.load(BpSummaryDto.self, key: .summary(window)) {
            summary = cached.value
        }

        if let newestCache {
            phase = .offline(cachedAt: newestCache)
        } else {
            let message = (error as? APIError)?.errorDescription
                ?? "Could not load blood pressure data."
            phase = .failed(message: message)
        }
    }

    // MARK: Actions

    /// `POST /bp/manual`; returns the stored reading so the caller can
    /// optionally write it back to Apple Health.
    public func submitManual(_ entry: ManualBpEntry) async throws -> BpReadingDto {
        let reading = try await provider.submitManual(entry)
        await load()
        return reading
    }

    public func withingsConnectURL() async throws -> URL {
        try await provider.withingsConnectURL()
    }

    public func refreshWithings() async {
        guard !isRefreshingWithings else { return }
        isRefreshingWithings = true
        actionError = nil
        defer { isRefreshingWithings = false }
        do {
            lastWithingsRefreshImported = try await provider.withingsRefresh()
            await load()
        } catch {
            actionError = (error as? LocalizedError)?.errorDescription
                ?? "Withings refresh failed."
        }
    }
}
