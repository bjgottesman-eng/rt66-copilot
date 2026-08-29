import SwiftUI

public enum SettingsKeys {
    /// Global opt-in for writing manual readings back to Apple Health.
    public static let saveManualToAppleHealth = "bh.saveManualToAppleHealth"
}

// Settings: demo-mode indicator, Apple Health permission state (honest
// tri-state), the manual-to-Health write-back toggle, and sign-out.

struct SettingsScreen: View {
    @Environment(AppServices.self) private var services
    @AppStorage(SettingsKeys.saveManualToAppleHealth) private var saveManualToHealth = false
    @State private var isRequestingHealthAccess = false
    @State private var isSyncingHealth = false
    @State private var healthWriteError: String?

    var body: some View {
        NavigationStack {
            List {
                modeSection
                appleHealthSection
                manualWriteBackSection
                accountSection
                aboutSection
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Settings")
            .task {
                await services.healthKit.refreshAuthorizationState()
            }
        }
    }

    // MARK: Mode

    private var modeSection: some View {
        Section("Mode") {
            if services.config.demoMode {
                Label {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Demo mode")
                        Text("All data is bundled, synthetic, and fictional. No backend, no credentials.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                } icon: {
                    Image(systemName: "sparkles")
                        .foregroundStyle(.teal)
                }
                if services.config.fellBackToDemo {
                    Label("Live mode was requested but the platform URL is misconfigured — fix BH_PLATFORM_BASE_URL in project.yml.",
                          systemImage: "exclamationmark.triangle")
                        .font(.caption)
                        .foregroundStyle(.orange)
                }
            } else {
                Label {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Live mode")
                        if let host = services.config.platformBaseURL?.host() {
                            Text("Platform: \(host)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                } icon: {
                    Image(systemName: "server.rack")
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    // MARK: Apple Health

    private var appleHealthSection: some View {
        Section {
            LabeledContent("Blood pressure & heart rate") {
                Text(healthStatusLabel)
                    .foregroundStyle(.secondary)
            }
            .accessibilityLabel("Apple Health access: \(healthStatusLabel)")

            if case .notDetermined = services.healthKit.availability {
                Button {
                    isRequestingHealthAccess = true
                    Task {
                        await services.healthKit.requestReadAuthorization()
                        isRequestingHealthAccess = false
                    }
                } label: {
                    if isRequestingHealthAccess {
                        ProgressView()
                    } else {
                        Label("Request Apple Health access", systemImage: "heart.text.square")
                    }
                }
                .disabled(isRequestingHealthAccess)
            }

            Button {
                isSyncingHealth = true
                Task {
                    await services.healthKit.ingestNewBloodPressure()
                    isSyncingHealth = false
                }
            } label: {
                if isSyncingHealth {
                    HStack {
                        ProgressView()
                        Text("Syncing…")
                    }
                } else {
                    Label("Sync from Apple Health now", systemImage: "arrow.triangle.2.circlepath")
                }
            }
            .disabled(isSyncingHealth || services.healthKit.availability == .unavailable)

            if let result = services.healthKit.lastIngestResult,
               let at = services.healthKit.lastIngestAt {
                Text("Last sync \(BPFormat.relativeAge(of: at)): \(result.accepted) accepted, \(result.duplicates) duplicate\(result.duplicates == 1 ? "" : "s").")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if let error = services.healthKit.lastIngestError {
                Label(error, systemImage: "exclamationmark.circle")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
        } header: {
            Text("Apple Health")
        } footer: {
            Text("Apple Health does not tell apps whether read access was denied — an empty result can mean either \u{201C}denied\u{201D} or \u{201C}no data\u{201D}. Manage access in the Health app under Sharing.")
        }
    }

    private var healthStatusLabel: String {
        switch services.healthKit.availability {
        case .unavailable:
            return "Unavailable on this device"
        case .notDetermined:
            return "Not requested yet"
        case .deniedOrNoData:
            return "No data visible (denied, or none exists)"
        case .data(let latest):
            if let latest {
                return "Reading data · latest \(BPFormat.relativeAge(of: latest))"
            }
            return "Reading data"
        }
    }

    // MARK: Manual write-back

    private var manualWriteBackSection: some View {
        Section {
            Toggle("Save manual readings to Apple Health", isOn: $saveManualToHealth)
                .onChange(of: saveManualToHealth) { _, enabled in
                    guard enabled else { return }
                    Task {
                        do {
                            try await services.healthWriter.requestWriteAuthorization()
                        } catch {
                            healthWriteError = (error as? LocalizedError)?.errorDescription
                                ?? "Could not request Apple Health write permission."
                            saveManualToHealth = false
                        }
                    }
                }
            if let healthWriteError {
                Label(healthWriteError, systemImage: "exclamationmark.circle")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
        } footer: {
            Text("When on, readings you enter manually are also written to Apple Health as blood-pressure correlations tagged \u{201C}Ben Health OS\u{201D}, so they are never re-imported as duplicates. Each entry can still opt out individually.")
        }
    }

    // MARK: Account

    private var accountSection: some View {
        Section("Account") {
            if services.config.demoMode {
                Text("No account — demo mode runs entirely on-device.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            } else {
                Button(role: .destructive) {
                    services.signOut()
                } label: {
                    Text("Sign Out")
                }
            }
        }
    }

    // MARK: About

    private var aboutSection: some View {
        Section {
            LabeledContent("Version") {
                Text(appVersion)
                    .foregroundStyle(.secondary)
            }
        } footer: {
            Text("Ben Health OS is a personal health record and analytics tool. It is not a medical device and does not diagnose conditions or give treatment advice. Every value shows its source and measurement time.")
        }
    }

    private var appVersion: String {
        let short = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String
        switch (short, build) {
        case let (s?, b?): return "\(s) (\(b))"
        case let (s?, nil): return s
        default: return "—"
        }
    }
}
