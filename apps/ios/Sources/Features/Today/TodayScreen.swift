import SwiftUI

// Minimal Phase 1 "Today" placeholder: latest blood pressure with its
// freshness and measurement time. The full Today view (recovery status,
// training recommendation, experiments, three priorities — brief §14)
// arrives with Phase 2's executive dashboard.

struct TodayScreen: View {
    @Environment(AppServices.self) private var services

    private var model: BPModel { services.bp }

    var body: some View {
        NavigationStack {
            List {
                Section("Blood pressure") {
                    if let latest = model.latest {
                        LatestReadingCard(latest: latest)
                    } else if model.phase == .loading || model.phase == .idle {
                        HStack {
                            ProgressView()
                            Text("Loading…")
                                .foregroundStyle(.secondary)
                        }
                    } else {
                        Text("No readings yet — connect Withings or add one manually from the Blood Pressure tab.")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                }

                if let summary = model.summary,
                   let systolic = summary.meanSystolic,
                   let diastolic = summary.meanDiastolic {
                    Section("Last \(summary.window.days) days") {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Mean")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Text(BPFormat.average(systolic: systolic, diastolic: diastolic))
                                    .font(.headline)
                                    .monospacedDigit()
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 2) {
                                Text("Sessions")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Text("\(summary.sessionCount)")
                                    .font(.headline)
                                    .monospacedDigit()
                            }
                        }
                        .accessibilityElement(children: .combine)
                    }
                }

                Section {
                    Text("Phase 1 focuses on blood pressure. Recovery, activity, and the executive dashboard arrive in later phases.")
                        .font(.footnote)
                        .foregroundStyle(.tertiary)
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Today")
            .refreshable {
                await model.load()
            }
            .task {
                await model.initialLoad()
            }
        }
    }
}
