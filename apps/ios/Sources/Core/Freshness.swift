import Foundation

// Freshness model — exact mirror of docs/contracts/phase1-contracts.md §3
// (also implemented in packages/shared for TypeScript; the two must stay in
// lockstep — FreshnessTests mirrors the shared table-driven tests).
//
//   if connectionStatus == 'not_connected'            -> NOT_CONNECTED
//   if connectionStatus == 'error'                    -> SYNC_ERROR
//   if latestMeasuredAt == null                       -> INSUFFICIENT_DATA
//   age = now - latestMeasuredAt
//   if age <= max(2 * expectedLatency, 15 min)        -> CURRENT
//   if age <= 24 h                                    -> RECENT
//   if age <= 72 h and (now - lastSuccessAt) <= 6 h   -> DELAYED_BY_SOURCE
//   else                                              -> STALE
//
// The word "LIVE" is forbidden in all UI copy.

public struct FreshnessInputs: Sendable, Equatable {
    public var connectionStatus: ConnectionStatus
    public var lastSuccessAt: Date?
    public var latestMeasuredAt: Date?
    public var expectedLatencySeconds: TimeInterval
    /// Injectable clock — pass a fixed instant in tests.
    public var now: Date

    public init(connectionStatus: ConnectionStatus,
                lastSuccessAt: Date?,
                latestMeasuredAt: Date?,
                expectedLatencySeconds: TimeInterval,
                now: Date) {
        self.connectionStatus = connectionStatus
        self.lastSuccessAt = lastSuccessAt
        self.latestMeasuredAt = latestMeasuredAt
        self.expectedLatencySeconds = expectedLatencySeconds
        self.now = now
    }
}

public enum Freshness {
    public static let fifteenMinutes: TimeInterval = 15 * 60
    public static let twentyFourHours: TimeInterval = 24 * 60 * 60
    public static let seventyTwoHours: TimeInterval = 72 * 60 * 60
    public static let sixHours: TimeInterval = 6 * 60 * 60

    /// Pure function; no wall clock inside — `inputs.now` is the only "now".
    public static func compute(_ inputs: FreshnessInputs) -> FreshnessStatus {
        if inputs.connectionStatus == .notConnected {
            return .notConnected
        }
        if inputs.connectionStatus == .error {
            return .syncError
        }
        guard let latestMeasuredAt = inputs.latestMeasuredAt else {
            return .insufficientData
        }

        let age = inputs.now.timeIntervalSince(latestMeasuredAt)
        let currentBound = max(2 * inputs.expectedLatencySeconds, fifteenMinutes)

        if age <= currentBound {
            return .current
        }
        if age <= twentyFourHours {
            return .recent
        }
        if age <= seventyTwoHours,
           let lastSuccessAt = inputs.lastSuccessAt,
           inputs.now.timeIntervalSince(lastSuccessAt) <= sixHours {
            // Connector is fine, the source is just quiet.
            return .delayedBySource
        }
        return .stale
    }

    /// Convenience: full `FreshnessDto` for the same inputs.
    public static func dto(_ inputs: FreshnessInputs) -> FreshnessDto {
        let ageSeconds: Int? = inputs.latestMeasuredAt.map {
            Int(inputs.now.timeIntervalSince($0).rounded(.down))
        }
        return FreshnessDto(
            status: compute(inputs),
            latestMeasuredAt: inputs.latestMeasuredAt,
            lastSuccessAt: inputs.lastSuccessAt,
            expectedLatencySeconds: Int(inputs.expectedLatencySeconds),
            ageSeconds: ageSeconds
        )
    }
}
