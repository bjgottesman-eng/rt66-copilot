import SwiftUI
import Charts
import AuthenticationServices

// First-class blood pressure screen (brief §6E):
// latest reading (value, source, device, measured + ingested time, freshness),
// 7/30-day trend with morning/evening toggle, session list with averages and
// first-excluded markers, full history, sync status, Connect/Reconnect
// Withings, Refresh, Add Manually. Measurement time is always shown; nothing
// is ever labeled "LIVE".

struct BPScreen: View {
    @Environment(AppServices.self) private var services
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    @State private var showManualSheet = false
    @State private var isConnecting = false

    private var model: BPModel { services.bp }

    var body: some View {
        @Bindable var model = services.bp
        NavigationStack {
            List {
                offlineBanner
                latestSection
                trendSection(model: $model)
                sessionsSection
                syncSection
            }
            .listStyle(.insetGrouped)
            .navigationDestination(for: BpSessionDto.self) { session in
                SessionDetailView(session: session)
            }
            .navigationTitle("Blood Pressure")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showManualSheet = true
                    } label: {
                        Label("Add Manually", systemImage: "plus")
                    }
                    .accessibilityLabel("Add a blood pressure reading manually")
                }
            }
            .refreshable {
                await model.load()
            }
            .sheet(isPresented: $showManualSheet) {
                ManualEntrySheet()
            }
            .task {
                await model.initialLoad()
            }
            .alert("Something went wrong",
                   isPresented: Binding(
                       get: { model.actionError != nil },
                       set: { if !$0 { model.actionError = nil } }
                   )) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(model.actionError ?? "")
            }
        }
    }

    // MARK: Offline / error banner

    @ViewBuilder
    private var offlineBanner: some View {
        switch model.phase {
        case .offline(let cachedAt):
            Section {
                Label {
                    Text("Platform unreachable — showing cached data from \(cachedAt.formatted(date: .abbreviated, time: .shortened)).")
                } icon: {
                    Image(systemName: "wifi.slash")
                }
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
        case .failed(let message):
            Section {
                Label(message, systemImage: "exclamationmark.circle")
                    .font(.footnote)
                    .foregroundStyle(.orange)
            }
        default:
            EmptyView()
        }
    }

    // MARK: Latest reading

    @ViewBuilder
    private var latestSection: some View {
        Section("Latest reading") {
            if let latest = model.latest {
                LatestReadingCard(latest: latest)
            } else if model.phase == .loading || model.phase == .idle {
                HStack {
                    ProgressView()
                    Text("Loading…")
                        .foregroundStyle(.secondary)
                }
            } else {
                Text("No blood pressure readings yet. Connect Withings or add a reading manually.")
                    .foregroundStyle(.secondary)
                    .font(.callout)
            }
        }
    }

    // MARK: Trend

    private func trendSection(model: Bindable<BPModel>) -> some View {
        Section("Trend") {
            Picker("Window", selection: model.window) {
                Text("7 days").tag(SummaryWindow.sevenDays)
                Text("30 days").tag(SummaryWindow.thirtyDays)
            }
            .pickerStyle(.segmented)
            .onChange(of: self.model.window) {
                Task { await self.model.reloadSummary() }
            }

            Picker("Time of day", selection: model.daypartFilter) {
                ForEach(DaypartFilter.allCases) { filter in
                    Text(filter.label).tag(filter)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityLabel("Filter trend by time of day")

            BPTrendChart(points: self.model.chartPoints)

            if let summary = self.model.summary {
                SummaryMeansRow(summary: summary, daypartFilter: self.model.daypartFilter)
            }
        }
    }

    // MARK: Sessions

    @ViewBuilder
    private var sessionsSection: some View {
        Section {
            if model.sessionsNewestFirst.isEmpty {
                Text("No sessions in the last 30 days.")
                    .foregroundStyle(.secondary)
                    .font(.callout)
            } else {
                ForEach(model.sessionsNewestFirst.prefix(8)) { session in
                    NavigationLink(value: session) {
                        SessionRow(session: session)
                    }
                }
                NavigationLink("All readings") {
                    HistoryListView(readings: model.windowReadings)
                }
                .font(.callout)
            }
        } header: {
            Text("Sessions")
        } footer: {
            Text("A session groups readings taken within 15 minutes of each other. With three or more readings, the first is excluded from the session average.")
        }
    }

    // MARK: Sync status + Withings actions

    @ViewBuilder
    private var syncSection: some View {
        Section("Sync") {
            if let withings = model.withingsSource {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(withings.displayName)
                            .font(.body)
                        if let lastSyncAt = withings.lastSyncAt {
                            Text("Last sync \(BPFormat.relativeAge(of: lastSyncAt))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } else {
                            Text("Never synced")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    Spacer()
                    FreshnessPill(
                        status: withings.freshness.status,
                        measuredAgo: withings.latestMeasuredAt.map { BPFormat.relativeAge(of: $0) }
                    )
                }
                ForEach(withings.problems, id: \.self) { problem in
                    Label(problem, systemImage: "info.circle")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            connectButton

            Button {
                Task { await model.refreshWithings() }
            } label: {
                if model.isRefreshingWithings {
                    HStack {
                        ProgressView()
                        Text("Refreshing…")
                    }
                } else {
                    Label("Refresh from Withings", systemImage: "arrow.clockwise")
                }
            }
            .disabled(model.isRefreshingWithings)

            if let imported = model.lastWithingsRefreshImported {
                Text(imported == 0
                     ? "Refresh complete — no new measurements."
                     : "Refresh imported \(imported) measurement\(imported == 1 ? "" : "s").")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if services.config.demoMode {
                Label("Demo mode: data comes from bundled synthetic fixtures.",
                      systemImage: "sparkles")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var connectButton: some View {
        let isConnected = model.withingsSource?.connectionStatus == .connected
        return Button {
            isConnecting = true
            Task {
                await connectWithings()
                isConnecting = false
            }
        } label: {
            Label(isConnected ? "Reconnect Withings" : "Connect Withings",
                  systemImage: "link")
        }
        .disabled(isConnecting)
    }

    /// Opens the platform-issued authorize URL in ASWebAuthenticationSession
    /// (OAuth Authorization Code; the code/state exchange happens entirely
    /// server-side, then the platform 302s back to the `benhealth` scheme).
    private func connectWithings() async {
        do {
            let url = try await model.withingsConnectURL()
            _ = try await webAuthenticationSession.authenticate(
                using: url,
                callbackURLScheme: "benhealth"
            )
            await model.refreshWithings()
        } catch is ASWebAuthenticationSessionError {
            // User cancelled — not an error worth surfacing.
        } catch {
            model.actionError = (error as? LocalizedError)?.errorDescription
                ?? "Could not start the Withings connection."
        }
    }
}

// MARK: - Latest reading card

struct LatestReadingCard: View {
    let latest: LatestBpResponse

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let reading = latest.reading {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(BPFormat.value(systolic: reading.systolic, diastolic: reading.diastolic))
                        .font(.system(size: 40, weight: .medium, design: .rounded))
                        .monospacedDigit()
                    Text("mmHg")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Spacer()
                    FreshnessPill(
                        status: latest.freshness.status,
                        measuredAgo: BPFormat.relativeAge(of: reading.measuredAt)
                    )
                }

                HStack(spacing: 14) {
                    Label(BPFormat.pulse(reading.pulse), systemImage: "heart")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .accessibilityLabel("Pulse \(BPFormat.pulse(reading.pulse))")
                    Text(BPFormat.provenanceLine(reading))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text(BPFormat.measuredLine(reading.measuredAt, tz: reading.measuredTz))
                    Text(BPFormat.ingestedLine(reading.ingestedAt))
                }
                .font(.caption)
                .foregroundStyle(.tertiary)

                if let note = reading.note, !note.isEmpty {
                    Text(note)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else {
                HStack {
                    Text("No reading available")
                        .foregroundStyle(.secondary)
                    Spacer()
                    FreshnessPill(status: latest.freshness.status)
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Trend chart (Swift Charts)

struct BPTrendChart: View {
    let points: [BPDisplayMath.DailyPoint]

    var body: some View {
        if points.isEmpty {
            Text("No readings in this window.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, minHeight: 120)
        } else {
            Chart {
                ForEach(points) { point in
                    if let systolic = point.meanSystolic {
                        LineMark(
                            x: .value("Day", point.day, unit: .day),
                            y: .value("mmHg", systolic),
                            series: .value("Series", "Systolic")
                        )
                        .interpolationMethod(.monotone)
                        .foregroundStyle(by: .value("Series", "Systolic"))
                        PointMark(
                            x: .value("Day", point.day, unit: .day),
                            y: .value("mmHg", systolic)
                        )
                        .symbolSize(24)
                        .foregroundStyle(by: .value("Series", "Systolic"))
                    }
                    if let diastolic = point.meanDiastolic {
                        LineMark(
                            x: .value("Day", point.day, unit: .day),
                            y: .value("mmHg", diastolic),
                            series: .value("Series", "Diastolic")
                        )
                        .interpolationMethod(.monotone)
                        .foregroundStyle(by: .value("Series", "Diastolic"))
                        PointMark(
                            x: .value("Day", point.day, unit: .day),
                            y: .value("mmHg", diastolic)
                        )
                        .symbolSize(24)
                        .foregroundStyle(by: .value("Series", "Diastolic"))
                    }
                }
            }
            .chartForegroundStyleScale([
                "Systolic": Color.indigo,
                "Diastolic": Color.teal
            ])
            .chartYScale(domain: 40...170)
            .chartLegend(position: .bottom, spacing: 8)
            .frame(height: 190)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Blood pressure trend by measurement day")
            .accessibilityValue(accessibilitySummary)
        }
    }

    /// Spoken summary so the chart is useful without sight of it.
    private var accessibilitySummary: String {
        guard let first = points.first, let last = points.last else { return "No data" }
        var parts: [String] = ["\(points.count) days with readings."]
        if let s = first.meanSystolic, let d = first.meanDiastolic {
            parts.append("Starts \(first.date) at \(Int(s.rounded())) over \(Int(d.rounded())).")
        }
        if let s = last.meanSystolic, let d = last.meanDiastolic {
            parts.append("Ends \(last.date) at \(Int(s.rounded())) over \(Int(d.rounded())).")
        }
        return parts.joined(separator: " ")
    }
}

// MARK: - Summary means row

struct SummaryMeansRow: View {
    let summary: BpSummaryDto
    let daypartFilter: DaypartFilter

    private var means: (label: String, systolic: Double?, diastolic: Double?, pulse: Double?) {
        switch daypartFilter {
        case .all:
            return ("Overall", summary.meanSystolic, summary.meanDiastolic, summary.meanPulse)
        case .morning:
            return ("Morning (4:00–11:59)", summary.morning.meanSystolic,
                    summary.morning.meanDiastolic, summary.morning.meanPulse)
        case .evening:
            return ("Evening (17:00–23:59)", summary.evening.meanSystolic,
                    summary.evening.meanDiastolic, summary.evening.meanPulse)
        }
    }

    var body: some View {
        let m = means
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("\(m.label) mean")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(BPFormat.average(systolic: m.systolic, diastolic: m.diastolic))
                    .font(.headline)
                    .monospacedDigit()
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text("Pulse")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(BPFormat.averagePulse(m.pulse))
                    .font(.headline)
                    .monospacedDigit()
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text("Readings")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text("\(summary.readingCount)")
                    .font(.headline)
                    .monospacedDigit()
            }
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Session row + detail

struct SessionRow: View {
    let session: BpSessionDto

    private var tz: String? { session.readings.first?.measuredTz }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(BPFormat.dayHeader(session.startedAt, tz: tz))
                    .font(.body)
                Text(BPFormat.shortTime(session.startedAt, tz: tz))
                    .font(.body)
                    .foregroundStyle(.secondary)
                Spacer()
                Text(BPFormat.average(systolic: session.avgSystolic,
                                      diastolic: session.avgDiastolic))
                    .font(.body.weight(.medium))
                    .monospacedDigit()
            }
            HStack(spacing: 6) {
                Text("\(session.readingCount) reading\(session.readingCount == 1 ? "" : "s")")
                Text("·")
                Text(BPFormat.averagingMethodLabel(session.averagingMethod))
                if session.firstReadingExcluded {
                    Image(systemName: "1.circle")
                        .accessibilityLabel("First reading excluded from average")
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }
}

struct SessionDetailView: View {
    let session: BpSessionDto

    private var orderedReadings: [BpReadingDto] {
        session.readings.sorted { $0.measuredAt < $1.measuredAt }
    }

    var body: some View {
        List {
            Section {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Session average")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(BPFormat.average(systolic: session.avgSystolic,
                                              diastolic: session.avgDiastolic))
                            .font(.title3.weight(.semibold))
                            .monospacedDigit()
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("Pulse")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(BPFormat.averagePulse(session.avgPulse))
                            .monospacedDigit()
                    }
                }
                Text(BPFormat.averagingMethodLabel(session.averagingMethod))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Readings") {
                ForEach(Array(orderedReadings.enumerated()), id: \.element.id) { index, reading in
                    ReadingRow(
                        reading: reading,
                        excludedFromAverage: session.firstReadingExcluded && index == 0
                    )
                }
            }
        }
        .navigationTitle(BPFormat.dayHeader(session.startedAt,
                                            tz: orderedReadings.first?.measuredTz))
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct ReadingRow: View {
    let reading: BpReadingDto
    var excludedFromAverage = false

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(BPFormat.value(systolic: reading.systolic, diastolic: reading.diastolic))
                    .font(.body.weight(.medium))
                    .monospacedDigit()
                Text(BPFormat.pulse(reading.pulse))
                    .font(.callout)
                    .foregroundStyle(.secondary)
                Spacer()
                Text(BPFormat.shortTime(reading.measuredAt, tz: reading.measuredTz))
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            HStack(spacing: 6) {
                Text(BPFormat.provenanceLine(reading))
                if excludedFromAverage {
                    Text("· Excluded from average")
                }
                if !reading.canonical {
                    Text("· Duplicate")
                }
            }
            .font(.caption)
            .foregroundStyle(.tertiary)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - History

struct HistoryListView: View {
    let readings: [BpReadingDto]

    private var newestFirst: [BpReadingDto] {
        readings.sorted { $0.measuredAt > $1.measuredAt }
    }

    var body: some View {
        List {
            Section {
                ForEach(newestFirst) { reading in
                    VStack(alignment: .leading, spacing: 3) {
                        HStack {
                            Text(BPFormat.value(systolic: reading.systolic,
                                                diastolic: reading.diastolic))
                                .font(.body.weight(.medium))
                                .monospacedDigit()
                            Text(BPFormat.pulse(reading.pulse))
                                .font(.callout)
                                .foregroundStyle(.secondary)
                            Spacer()
                            Text(BPFormat.measuredTime(reading.measuredAt, tz: reading.measuredTz))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Text(BPFormat.provenanceLine(reading))
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                    .accessibilityElement(children: .combine)
                }
            } footer: {
                Text("Last 30 days · times shown in each measurement's own time zone.")
            }
        }
        .navigationTitle("History")
        .navigationBarTitleDisplayMode(.inline)
    }
}
