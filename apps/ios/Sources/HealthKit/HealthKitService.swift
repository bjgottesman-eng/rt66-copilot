import Foundation
import HealthKit
import Observation
import UIKit

// Apple Health blood-pressure ingestion (brief §7, contracts §5 `POST /ingest/healthkit`).
//
// - Reads `HKCorrelationType(.bloodPressure)` via a modern anchored query
//   descriptor; systolic and diastolic are paired from quantities INSIDE the
//   same correlation, never across correlations.
// - Captures source app name, bundle id, and device per sample.
// - Persists the HKQueryAnchor (secure-coded archive, complete file
//   protection) so ingestion is incremental and survives relaunches; the
//   anchor only advances after the platform accepts the batch.
// - Observer query + background delivery re-run ingestion when Health changes
//   (background delivery requires a physical device).
// - Tri-state permission truth (brief §7: "Denied permission ≠ no data ≠
//   stale data"): HealthKit intentionally hides read-denial, so an empty
//   result is reported as `deniedOrNoData`, never as "no readings exist".

public enum HealthDataAvailability: Equatable, Sendable {
    /// HealthKit does not exist on this hardware (e.g. some iPads).
    case unavailable
    /// We have never asked for permission.
    case notDetermined
    /// Zero samples visible — read access denied OR genuinely no data;
    /// HealthKit does not let apps distinguish the two, so neither do we.
    case deniedOrNoData
    /// Samples are visible.
    case data(latestMeasuredAt: Date?)

    /// True once a query has ever returned samples (used to resume ingestion
    /// on launch without re-prompting).
    public var hasGrantedHistory: Bool {
        if case .data = self { return true }
        return false
    }
}

@Observable @MainActor
public final class HealthKitService {
    private let store = HKHealthStore()
    private let provider: any BPDataProviding
    private let anchorFileURL: URL
    private var observerQuery: HKObserverQuery?
    private var isIngesting = false

    public private(set) var availability: HealthDataAvailability
    public private(set) var lastIngestResult: HealthKitIngestResponse?
    public private(set) var lastIngestAt: Date?
    public private(set) var lastIngestError: String?
    /// HealthKit deletions detected but not yet propagated to the platform
    /// (no delete endpoint in the Phase 1 contract — see README limitations).
    public private(set) var pendingDeletedCount = 0

    // MARK: Types

    private var bloodPressureType: HKCorrelationType { HKCorrelationType(.bloodPressure) }
    private var systolicType: HKQuantityType { HKQuantityType(.bloodPressureSystolic) }
    private var diastolicType: HKQuantityType { HKQuantityType(.bloodPressureDiastolic) }
    private var heartRateType: HKQuantityType { HKQuantityType(.heartRate) }

    /// Read authorization is requested on the QUANTITY types; the correlation
    /// type itself is queried but not individually authorizable.
    private var readTypes: Set<HKObjectType> {
        [systolicType, diastolicType, heartRateType]
    }

    public init(provider: any BPDataProviding, anchorDirectory: URL? = nil) {
        self.provider = provider
        self.availability = HKHealthStore.isHealthDataAvailable() ? .notDetermined : .unavailable

        let base = anchorDirectory
            ?? FileManager.default.urls(for: .applicationSupportDirectory,
                                        in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        self.anchorFileURL = base
            .appending(path: "BenHealthOS", directoryHint: .isDirectory)
            .appending(path: "healthkit-bp.anchor")
    }

    // MARK: - Authorization

    /// Recompute the tri-state without prompting.
    public func refreshAuthorizationState() async {
        guard HKHealthStore.isHealthDataAvailable() else {
            availability = .unavailable
            return
        }
        do {
            let status = try await store.statusForAuthorizationRequest(toShare: [], read: readTypes)
            if status == .shouldRequest {
                availability = .notDetermined
                return
            }
        } catch {
            // Fall through to a probe query; the state below is still honest.
        }
        await probeVisibility()
    }

    /// Contextual permission prompt (called from Settings / BP screen, never
    /// on launch). Follows up with a probe so `availability` is truthful.
    public func requestReadAuthorization() async {
        guard HKHealthStore.isHealthDataAvailable() else {
            availability = .unavailable
            return
        }
        do {
            try await store.requestAuthorization(toShare: [], read: readTypes)
        } catch {
            lastIngestError = "Health permission request failed."
        }
        await probeVisibility()
    }

    /// One unanchored sample query to distinguish `deniedOrNoData` from `data`.
    private func probeVisibility() async {
        do {
            let descriptor = HKSampleQueryDescriptor(
                predicates: [.sample(type: bloodPressureType)],
                sortDescriptors: [SortDescriptor(\.endDate, order: .reverse)],
                limit: 1
            )
            let samples = try await descriptor.result(for: store)
            if let latest = samples.first {
                availability = .data(latestMeasuredAt: latest.startDate)
            } else {
                availability = .deniedOrNoData
            }
        } catch {
            availability = .deniedOrNoData
        }
    }

    // MARK: - Ingestion

    /// Anchored incremental ingestion: fetch new BP correlations since the
    /// stored anchor, batch-POST them to `/api/v1/ingest/healthkit`, and only
    /// then persist the new anchor (so a failed upload retries next time).
    public func ingestNewBloodPressure() async {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        guard !isIngesting else { return }
        isIngesting = true
        defer { isIngesting = false }

        do {
            let anchor = loadAnchor()
            let descriptor = HKAnchoredObjectQueryDescriptor(
                predicates: [.sample(type: bloodPressureType)],
                anchor: anchor
            )
            let result = try await descriptor.result(for: store)

            let correlations = result.addedSamples.compactMap { $0 as? HKCorrelation }
            let samples = correlations.compactMap { batchSample(from: $0) }

            if !result.deletedObjects.isEmpty {
                // Deletion handling: counted and surfaced; propagation to the
                // platform is a known Phase 1 gap (no contract endpoint).
                pendingDeletedCount += result.deletedObjects.count
            }

            if !samples.isEmpty {
                let batch = HealthKitBpBatch(
                    deviceAnchor: await deviceAnchorToken(),
                    samples: samples.sorted { $0.measuredAt < $1.measuredAt }
                )
                let response = try await provider.ingestHealthKit(batch)
                lastIngestResult = response
                lastIngestAt = Date()
            }

            // Advance the anchor only after the platform accepted the batch
            // (or there was nothing to send).
            saveAnchor(result.newAnchor)
            lastIngestError = nil

            // Update the tri-state: new samples prove data; otherwise an
            // unknown state gets probed once, and known states are kept
            // (an empty incremental batch proves nothing new).
            if let latest = samples.map(\.measuredAt).max() {
                availability = .data(latestMeasuredAt: latest)
            } else if availability == .notDetermined {
                await probeVisibility()
            }
        } catch {
            // Status only — never sample values (CLAUDE.md rule 1).
            lastIngestError = "Apple Health sync failed. It will retry automatically."
        }
    }

    /// Map one HKCorrelation into the contract's `HealthKitBpBatch.samples[]`
    /// element. Returns nil for correlations we wrote ourselves (manual
    /// write-back, tagged with the Ben Health OS sync identifier) so they are
    /// never re-imported — plus the server dedups by hkUuid as a second net.
    func batchSample(from correlation: HKCorrelation) -> HealthKitBpSample? {
        if let syncId = correlation.metadata?[HKMetadataKeySyncIdentifier] as? String,
           syncId.hasPrefix(BenHealthSync.manualSyncIdentifierPrefix) {
            return nil
        }

        guard
            let systolicSample = correlation.objects(for: systolicType).first as? HKQuantitySample,
            let diastolicSample = correlation.objects(for: diastolicType).first as? HKQuantitySample
        else {
            // A BP correlation without both quantities is malformed; skip it
            // rather than invent a value.
            return nil
        }

        let mmHg = HKUnit.millimeterOfMercury()
        let systolic = systolicSample.quantity.doubleValue(for: mmHg)
        let diastolic = diastolicSample.quantity.doubleValue(for: mmHg)

        // Pulse only if the source embedded a heart-rate sample in the SAME
        // correlation (rare). Absent pulse stays nil — never zero.
        var pulse: Double?
        if let hrSample = correlation.objects(for: heartRateType).first as? HKQuantitySample {
            pulse = hrSample.quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
        }

        let timeZone = correlation.metadata?[HKMetadataKeyTimeZone] as? String
        let source = correlation.sourceRevision.source
        let device = correlation.device?.name
            ?? correlation.device?.model
            ?? "unknown"

        return HealthKitBpSample(
            hkUuid: correlation.uuid.uuidString,
            measuredAt: correlation.startDate,
            measuredTz: timeZone,
            systolic: systolic,
            diastolic: diastolic,
            pulse: pulse,
            sourceApp: source.name,
            sourceDevice: device,
            sourceBundleId: source.bundleIdentifier
        )
    }

    // MARK: - Observer + background delivery

    /// Registers an observer query and asks HealthKit to wake the app when
    /// blood-pressure data changes. Note: observer queries do not fire for
    /// correlation types, so we observe the systolic QUANTITY type — any new
    /// BP correlation necessarily adds a systolic sample. Background delivery
    /// needs the background-delivery entitlement and a physical device;
    /// foreground observation still works in the Simulator.
    public func registerObserverAndBackgroundDelivery() async {
        guard HKHealthStore.isHealthDataAvailable(), observerQuery == nil else { return }

        let query = HKObserverQuery(sampleType: systolicType, predicate: nil) {
            [weak self] _, completionHandler, error in
            // HealthKit calls this on a background queue.
            Task { @MainActor [weak self] in
                if error == nil {
                    await self?.ingestNewBloodPressure()
                }
                completionHandler()
            }
        }
        observerQuery = query
        store.execute(query)

        do {
            try await store.enableBackgroundDelivery(for: systolicType, frequency: .hourly)
        } catch {
            // Expected in the Simulator; foreground syncs still work.
        }
    }

    // MARK: - Anchor persistence

    private func loadAnchor() -> HKQueryAnchor? {
        guard let data = try? Data(contentsOf: anchorFileURL) else { return nil }
        return try? NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: data)
    }

    private func saveAnchor(_ anchor: HKQueryAnchor?) {
        guard let anchor else { return }
        do {
            try FileManager.default.createDirectory(
                at: anchorFileURL.deletingLastPathComponent(),
                withIntermediateDirectories: true,
                attributes: [.protectionKey: FileProtectionType.complete]
            )
            let data = try NSKeyedArchiver.archivedData(withRootObject: anchor,
                                                        requiringSecureCoding: true)
            try data.write(to: anchorFileURL, options: [.atomic, .completeFileProtection])
        } catch {
            // Anchor persistence is best-effort; worst case we re-fetch and
            // the platform dedups by hkUuid.
        }
    }

    /// Opaque per-install token for the batch's optional `deviceAnchor` field.
    private func deviceAnchorToken() async -> String? {
        UIDevice.current.identifierForVendor?.uuidString
    }
}
