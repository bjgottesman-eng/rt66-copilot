import SwiftUI

/// Top-level navigation: device-auth gate → (live mode) platform sign-in →
/// tab bar. Re-locks whenever the app leaves the foreground.
struct RootView: View {
    @Environment(AppServices.self) private var services
    @Environment(AuthGate.self) private var gate
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            switch gate.state {
            case .unlocked:
                if services.config.demoMode || services.isAuthenticated {
                    MainTabView()
                } else {
                    LoginView()
                }
            default:
                LockedView()
            }
        }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .background {
                gate.lock()
            }
        }
    }
}

// MARK: - Platform sign-in (live mode only)

struct LoginView: View {
    @Environment(AppServices.self) private var services
    @State private var email = ""
    @State private var password = ""
    @State private var isSigningIn = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Email", text: $email)
                        .textContentType(.username)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField("Password", text: $password)
                        .textContentType(.password)
                } header: {
                    Text("Ben Health OS platform")
                } footer: {
                    Text("Sign in to your self-hosted platform. Credentials are sent only to the configured platform URL; the session token is stored in the Keychain.")
                }

                if let authError = services.authError {
                    Section {
                        Label(authError, systemImage: "exclamationmark.circle")
                            .foregroundStyle(.orange)
                            .font(.callout)
                    }
                }

                Section {
                    Button {
                        isSigningIn = true
                        Task {
                            await services.login(email: email, password: password)
                            isSigningIn = false
                        }
                    } label: {
                        if isSigningIn {
                            ProgressView()
                                .frame(maxWidth: .infinity)
                        } else {
                            Text("Sign In")
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .disabled(email.isEmpty || password.isEmpty || isSigningIn)
                }
            }
            .navigationTitle("Sign In")
        }
    }
}

// MARK: - Tabs

struct MainTabView: View {
    @Environment(AppServices.self) private var services

    var body: some View {
        TabView {
            TodayScreen()
                .tabItem { Label("Today", systemImage: "sun.max") }
            BPScreen()
                .tabItem { Label("Blood Pressure", systemImage: "waveform.path.ecg") }
            SourcesScreen()
                .tabItem { Label("Sources", systemImage: "antenna.radiowaves.left.and.right") }
            SettingsScreen()
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
        .task {
            // Initial load + HealthKit wiring. Authorization is NOT requested
            // here — that happens contextually from Settings; we only resume
            // ingestion if access was granted earlier.
            await services.bp.initialLoad()
            await services.healthKit.refreshAuthorizationState()
            if services.healthKit.availability.hasGrantedHistory {
                await services.healthKit.registerObserverAndBackgroundDelivery()
                await services.healthKit.ingestNewBloodPressure()
            }
        }
    }
}
