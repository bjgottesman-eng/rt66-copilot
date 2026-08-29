import SwiftUI

// Calm status pill for the freshness vocabulary (contract §3).
// Design rules (CLAUDE.md / brief §26): subtle colors, no alarm-red walls,
// every status explainable, and the word "LIVE" never appears.

public struct FreshnessStyle {
    public let label: String
    public let color: Color
    public let systemImage: String
    /// One-sentence plain-language explanation, also used for accessibility.
    public let explanation: String

    public static func style(for status: FreshnessStatus) -> FreshnessStyle {
        switch status {
        case .current:
            return FreshnessStyle(
                label: "Current",
                color: .green,
                systemImage: "checkmark.circle",
                explanation: "The latest measurement is within this source's expected sync window."
            )
        case .recent:
            return FreshnessStyle(
                label: "Recent",
                color: .teal,
                systemImage: "clock",
                explanation: "The latest measurement is from the past 24 hours."
            )
        case .delayedBySource:
            return FreshnessStyle(
                label: "Delayed by source",
                color: .yellow,
                systemImage: "hourglass",
                explanation: "The connection is working, but the source hasn't produced new data recently."
            )
        case .stale:
            return FreshnessStyle(
                label: "Stale",
                color: .orange,
                systemImage: "moon.zzz",
                explanation: "No sufficiently recent measurement is available from this source."
            )
        case .syncError:
            return FreshnessStyle(
                label: "Sync error",
                color: .orange,
                systemImage: "exclamationmark.triangle",
                explanation: "The last attempt to sync this source failed. Data shown is from before the error."
            )
        case .notConnected:
            return FreshnessStyle(
                label: "Not connected",
                color: .gray,
                systemImage: "link.badge.plus",
                explanation: "This source isn't connected yet."
            )
        case .insufficientData:
            return FreshnessStyle(
                label: "Insufficient data",
                color: .gray,
                systemImage: "questionmark.circle",
                explanation: "Not enough measurements exist to assess freshness."
            )
        }
    }
}

public struct FreshnessPill: View {
    public let status: FreshnessStatus
    /// Optional age for the accessibility description, e.g. "6 hours ago".
    public var measuredAgo: String?

    public init(status: FreshnessStatus, measuredAgo: String? = nil) {
        self.status = status
        self.measuredAgo = measuredAgo
    }

    private var style: FreshnessStyle { FreshnessStyle.style(for: status) }

    public var body: some View {
        HStack(spacing: 5) {
            Image(systemName: style.systemImage)
                .font(.caption2)
            Text(style.label)
                .font(.caption.weight(.medium))
        }
        .foregroundStyle(style.color)
        .padding(.horizontal, 9)
        .padding(.vertical, 4)
        .background(style.color.opacity(0.14), in: Capsule())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    private var accessibilityText: String {
        var text = "Freshness: \(style.label). \(style.explanation)"
        if let measuredAgo {
            text += " Last measured \(measuredAgo)."
        }
        return text
    }
}

#Preview("All statuses") {
    VStack(alignment: .leading, spacing: 10) {
        ForEach(FreshnessStatus.allCases, id: \.rawValue) { status in
            FreshnessPill(status: status)
        }
    }
    .padding()
}
