import Foundation
import HealthKit

/// Stable identity Ben Health OS stamps on everything it writes to Apple
/// Health. `HKMetadataKeySyncIdentifier` + `HKMetadataKeySyncVersion` make the
/// write idempotent (re-saving the same reading updates rather than
/// duplicates), and `HealthKitService` skips correlations carrying this
/// prefix so our own writes are never re-imported as new data.
public enum BenHealthSync {
    // Must stay in lockstep with services/platform ingest suppression, which
    // drops any HealthKit sample whose sync identifier starts with "benhealthos."
    public static let manualSyncIdentifierPrefix = "benhealthos.bp.manual-"
    public static let syncVersion = 1

    public static func syncIdentifier(forReadingId id: String) -> String {
        manualSyncIdentifierPrefix + id
    }
}

/// Optional write-back of MANUAL readings to Apple Health (brief §6):
/// only invoked when the user's "Also save to Apple Health" setting is on AND
/// the individual entry opted in. Writes a proper blood-pressure correlation
/// (systolic + diastolic quantities inside one HKCorrelation), never loose
/// samples.
@MainActor
public final class HealthKitWriter {
    public enum WriteError: Error, LocalizedError {
        case healthKitUnavailable
        case notAuthorized

        public var errorDescription: String? {
            switch self {
            case .healthKitUnavailable:
                return "Apple Health is not available on this device."
            case .notAuthorized:
                return "Ben Health OS does not have permission to save to Apple Health."
            }
        }
    }

    private let store = HKHealthStore()

    private var systolicType: HKQuantityType { HKQuantityType(.bloodPressureSystolic) }
    private var diastolicType: HKQuantityType { HKQuantityType(.bloodPressureDiastolic) }
    private var bloodPressureType: HKCorrelationType { HKCorrelationType(.bloodPressure) }

    public init() {}

    /// Explicit write permission, requested contextually (first time the user
    /// enables the setting), never bundled into the read prompt.
    public func requestWriteAuthorization() async throws {
        guard HKHealthStore.isHealthDataAvailable() else {
            throw WriteError.healthKitUnavailable
        }
        try await store.requestAuthorization(toShare: [systolicType, diastolicType], read: [])
    }

    public var isWriteAuthorized: Bool {
        guard HKHealthStore.isHealthDataAvailable() else { return false }
        return store.authorizationStatus(for: systolicType) == .sharingAuthorized
            && store.authorizationStatus(for: diastolicType) == .sharingAuthorized
    }

    /// Save one manual reading as a BP correlation. `readingId` is the
    /// platform's id for the stored reading, giving the sync identifier a
    /// stable value across re-saves.
    public func saveManualReading(_ entry: ManualBpEntry, readingId: String) async throws {
        guard HKHealthStore.isHealthDataAvailable() else {
            throw WriteError.healthKitUnavailable
        }
        guard isWriteAuthorized else {
            throw WriteError.notAuthorized
        }

        let mmHg = HKUnit.millimeterOfMercury()
        let date = entry.measuredAt
        let syncId = BenHealthSync.syncIdentifier(forReadingId: readingId)

        var metadata: [String: Any] = [
            HKMetadataKeySyncVersion: BenHealthSync.syncVersion,
            HKMetadataKeyWasUserEntered: true
        ]
        if let tz = entry.measuredTz {
            metadata[HKMetadataKeyTimeZone] = tz
        }

        // Sync identifiers are unique per sample TYPE, so the two quantity
        // samples get suffixed ids; the correlation carries the base id that
        // HealthKitService's re-import filter checks.
        var systolicMeta = metadata
        systolicMeta[HKMetadataKeySyncIdentifier] = syncId + "-systolic"
        var diastolicMeta = metadata
        diastolicMeta[HKMetadataKeySyncIdentifier] = syncId + "-diastolic"
        var correlationMeta = metadata
        correlationMeta[HKMetadataKeySyncIdentifier] = syncId

        let systolicSample = HKQuantitySample(
            type: systolicType,
            quantity: HKQuantity(unit: mmHg, doubleValue: entry.systolic),
            start: date, end: date,
            metadata: systolicMeta
        )
        let diastolicSample = HKQuantitySample(
            type: diastolicType,
            quantity: HKQuantity(unit: mmHg, doubleValue: entry.diastolic),
            start: date, end: date,
            metadata: diastolicMeta
        )
        let correlation = HKCorrelation(
            type: bloodPressureType,
            start: date, end: date,
            objects: [systolicSample, diastolicSample],
            metadata: correlationMeta
        )

        try await store.save(correlation)
    }
}
