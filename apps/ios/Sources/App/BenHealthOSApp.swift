import SwiftUI
import Observation
import LocalAuthentication

// Ben Health OS — SwiftUI entry point.
//
// Security posture: all content sits behind a Face ID / Touch ID / passcode
// gate (LocalAuthentication, `.deviceOwnerAuthentication`). The app re-locks
// whenever it leaves the foreground. If the device has no passcode enrolled,
// the gate explains why it cannot protect the data; only demo mode (synthetic
// fixtures, no real health data) offers a "continue anyway" escape hatch.

@main
struct BenHealthOSApp: App {
    @State private var services: AppServices
    @State private var gate: AuthGate

    init() {
        let services = AppServices()
        _services = State(initialValue: services)
        _gate = State(initialValue: AuthGate(demoMode: services.config.demoMode))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(services)
                .environment(gate)
        }
    }
}

// MARK: - Device-auth gate

@Observable @MainActor
final class AuthGate {
    enum GateState: Equatable {
        case locked
        case unlocking
        case unlocked
        /// Device auth can't run (typically: no passcode enrolled).
        case unavailable(reason: String)
    }

    private(set) var state: GateState = .locked
    let demoMode: Bool

    /// Injectable for previews/tests; production uses a fresh LAContext per attempt.
    private let makeContext: @Sendable () -> LAContext

    init(demoMode: Bool, makeContext: @escaping @Sendable () -> LAContext = { LAContext() }) {
        self.demoMode = demoMode
        self.makeContext = makeContext
    }

    func unlock() async {
        guard state != .unlocked && state != .unlocking else { return }
        state = .unlocking

        let context = makeContext()
        var evaluationError: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &evaluationError) else {
            let reason = evaluationError?.localizedDescription
                ?? "Device authentication is not available."
            state = .unavailable(reason: reason)
            return
        }

        do {
            let success = try await context.evaluatePolicy(
                .deviceOwnerAuthentication,
                localizedReason: "Unlock Ben Health OS to view your health data."
            )
            state = success ? .unlocked : .locked
        } catch {
            // Cancelled or failed — stay locked; the user can retry.
            state = .locked
        }
    }

    func lock() {
        state = .locked
    }

    /// Demo mode only: synthetic fixtures carry no real health data.
    func continueWithoutDeviceAuth() {
        guard demoMode else { return }
        state = .unlocked
    }
}

// MARK: - Locked screen

struct LockedView: View {
    @Environment(AuthGate.self) private var gate

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: "heart.text.square")
                .font(.system(size: 56, weight: .light))
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            Text("Ben Health OS")
                .font(.title2.weight(.semibold))
            Text("Your health data is locked behind device authentication.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            switch gate.state {
            case .unlocking:
                ProgressView()
                    .accessibilityLabel("Unlocking")
            case .unavailable(let reason):
                VStack(spacing: 12) {
                    Text(reason)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                    Text("Set a device passcode to protect your health data.")
                        .font(.footnote)
                        .multilineTextAlignment(.center)
                    if gate.demoMode {
                        Button("Continue in demo mode") {
                            gate.continueWithoutDeviceAuth()
                        }
                        .buttonStyle(.borderedProminent)
                        .accessibilityHint("Demo mode contains only synthetic data.")
                    }
                }
                .padding(.horizontal, 32)
            default:
                Button {
                    Task { await gate.unlock() }
                } label: {
                    Label("Unlock", systemImage: "faceid")
                }
                .buttonStyle(.borderedProminent)
            }
            Spacer()
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
        .task {
            await gate.unlock()
        }
    }
}
