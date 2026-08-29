import SwiftUI

// Data sources screen (brief §24, Phase 1 slice): one row per provider —
// connection status, freshness pill, latest measurement time, last sync,
// coverage note, and explained problems. Nothing is silently cleaned or
// hidden; NOT_CONNECTED providers are listed too.

struct SourcesScreen: View {
    @Environment(AppServices.self) private var services

    private var model: BPModel { services.bp }

    var body: some View {
        NavigationStack {
            List {
                if case .offline(let cachedAt) = model.phase {
                    Section {
                        Label("Showing cached statuses from \(cachedAt.formatted(date: .abbreviated, time: .shortened)).",
                              systemImage: "wifi.slash")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }

                Section {
                    if model.sources.isEmpty {
                        Text("No source information loaded yet.")
                            .foregroundStyle(.secondary)
                            .font(.callout)
                    } else {
                        ForEach(model.sources) { source in
                            SourceRow(source: source)
                        }
                    }
                } footer: {
                    Text("Freshness is based on each measurement's own timestamp and the source's expected sync latency — connected does not mean current.")
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Data Sources")
            .refreshable {
                await model.load()
            }
            .task {
                await model.initialLoad()
            }
        }
    }
}

struct SourceRow: View {
    let source: SourceStatusDto

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(source.displayName)
                    .font(.body.weight(.medium))
                Spacer()
                FreshnessPill(
                    status: source.freshness.status,
                    measuredAgo: source.latestMeasuredAt.map { BPFormat.relativeAge(of: $0) }
                )
            }

            VStack(alignment: .leading, spacing: 2) {
                if let latest = source.latestMeasuredAt {
                    Text("Latest measurement \(BPFormat.relativeAge(of: latest))")
                } else {
                    Text("No measurements yet")
                }
                if let lastSync = source.lastSyncAt {
                    Text("Last sync \(BPFormat.relativeAge(of: lastSync))")
                }
                Text(connectionLabel)
            }
            .font(.caption)
            .foregroundStyle(.secondary)

            if let coverageNote = source.coverageNote, !coverageNote.isEmpty {
                Text(coverageNote)
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }

            ForEach(source.problems, id: \.self) { problem in
                Label(problem, systemImage: "info.circle")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    private var connectionLabel: String {
        switch source.connectionStatus {
        case .connected: return "Connected"
        case .error: return "Connection error"
        case .revoked: return "Access revoked"
        case .notConnected: return "Not connected"
        }
    }
}
