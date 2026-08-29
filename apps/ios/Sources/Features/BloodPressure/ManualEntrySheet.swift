import SwiftUI

// Full manual entry form (brief §6C): systolic, diastolic, pulse, timestamp,
// arm, seated-rest duration, body position, reading number, note, and the
// user-controlled "Also save to Apple Health" toggle. The platform stores the
// reading; if the toggle is on (and write permission is granted) the app then
// writes a properly tagged BP correlation to Apple Health.

struct ManualEntrySheet: View {
    @Environment(AppServices.self) private var services
    @Environment(\.dismiss) private var dismiss

    // Values — kept as text so empty stays empty (never coerced to 0).
    @State private var systolicText = ""
    @State private var diastolicText = ""
    @State private var pulseText = ""
    @State private var measuredAt = Date()
    @State private var arm: Arm = .left
    @State private var bodyPosition: BodyPosition = .seated
    @State private var seatedRestMinutesText = ""
    @State private var readingNumberText = ""
    @State private var note = ""
    @AppStorage(SettingsKeys.saveManualToAppleHealth) private var saveToHealthDefault = false
    @State private var saveToAppleHealth = false
    @State private var didInitializeToggle = false

    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var healthWriteNotice: String?

    // Plausibility bounds mirror the DB checks (contracts §2).
    private static let systolicRange = 40.0...300.0
    private static let diastolicRange = 20.0...200.0
    private static let pulseRange = 20.0...250.0

    private var systolic: Double? { Double(systolicText) }
    private var diastolic: Double? { Double(diastolicText) }
    private var pulse: Double? { pulseText.isEmpty ? nil : Double(pulseText) }
    private var seatedRestMinutes: Double? {
        seatedRestMinutesText.isEmpty ? nil : Double(seatedRestMinutesText)
    }
    private var readingNumber: Int? {
        readingNumberText.isEmpty ? nil : Int(readingNumberText)
    }

    private var validationMessage: String? {
        guard let systolic else { return systolicText.isEmpty ? nil : "Systolic must be a number." }
        guard Self.systolicRange.contains(systolic) else {
            return "Systolic should be between 40 and 300 mmHg."
        }
        guard let diastolic else { return diastolicText.isEmpty ? nil : "Diastolic must be a number." }
        guard Self.diastolicRange.contains(diastolic) else {
            return "Diastolic should be between 20 and 200 mmHg."
        }
        if diastolic >= systolic {
            return "Diastolic is usually lower than systolic — double-check the values."
        }
        if !pulseText.isEmpty {
            guard let pulse, Self.pulseRange.contains(pulse) else {
                return "Pulse should be between 20 and 250 bpm (or left empty)."
            }
        }
        if measuredAt > Date().addingTimeInterval(60) {
            return "Measurement time can't be in the future."
        }
        return nil
    }

    private var canSave: Bool {
        systolic != nil && diastolic != nil && validationMessage == nil && !isSaving
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Reading") {
                    LabeledContent("Systolic (mmHg)") {
                        TextField("120", text: $systolicText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .accessibilityLabel("Systolic in millimeters of mercury")
                    }
                    LabeledContent("Diastolic (mmHg)") {
                        TextField("80", text: $diastolicText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .accessibilityLabel("Diastolic in millimeters of mercury")
                    }
                    LabeledContent("Pulse (bpm)") {
                        TextField("Optional", text: $pulseText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .accessibilityLabel("Pulse in beats per minute, optional")
                    }
                    DatePicker("Measured at", selection: $measuredAt,
                               in: ...Date(),
                               displayedComponents: [.date, .hourAndMinute])
                }

                Section("Context") {
                    Picker("Arm", selection: $arm) {
                        Text("Left").tag(Arm.left)
                        Text("Right").tag(Arm.right)
                        Text("Not sure").tag(Arm.unknown)
                    }
                    Picker("Position", selection: $bodyPosition) {
                        Text("Seated").tag(BodyPosition.seated)
                        Text("Standing").tag(BodyPosition.standing)
                        Text("Lying down").tag(BodyPosition.lying)
                        Text("Not sure").tag(BodyPosition.unknown)
                    }
                    LabeledContent("Seated rest (min)") {
                        TextField("Optional", text: $seatedRestMinutesText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                    }
                    LabeledContent("Reading # in session") {
                        TextField("Optional", text: $readingNumberText)
                            .keyboardType(.numberPad)
                            .multilineTextAlignment(.trailing)
                    }
                    TextField("Note (device, circumstances…)", text: $note, axis: .vertical)
                        .lineLimit(1...3)
                }

                Section {
                    Toggle("Also save to Apple Health", isOn: $saveToAppleHealth)
                } footer: {
                    Text("Saved readings are tagged as coming from Ben Health OS so they are never re-imported as duplicates. Requires Apple Health write permission.")
                }

                if let validationMessage {
                    Section {
                        Label(validationMessage, systemImage: "exclamationmark.circle")
                            .font(.callout)
                            .foregroundStyle(.orange)
                    }
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "xmark.circle")
                            .font(.callout)
                            .foregroundStyle(.orange)
                    }
                }
            }
            .navigationTitle("Add Reading")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await save() }
                    } label: {
                        if isSaving {
                            ProgressView()
                        } else {
                            Text("Save")
                        }
                    }
                    .disabled(!canSave)
                }
            }
            .onAppear {
                if !didInitializeToggle {
                    saveToAppleHealth = saveToHealthDefault
                    didInitializeToggle = true
                }
            }
            .alert("Saved, but not to Apple Health",
                   isPresented: Binding(
                       get: { healthWriteNotice != nil },
                       set: { if !$0 { healthWriteNotice = nil; dismiss() } }
                   )) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(healthWriteNotice ?? "")
            }
        }
    }

    private func save() async {
        guard let systolic, let diastolic else { return }
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }

        let entry = ManualBpEntry(
            systolic: systolic,
            diastolic: diastolic,
            pulse: pulse,
            measuredAt: measuredAt,
            measuredTz: TimeZone.current.identifier,
            arm: arm,
            bodyPosition: bodyPosition,
            seatedRestMinutes: seatedRestMinutes,
            readingNumberInSession: readingNumber,
            note: note.isEmpty ? nil : note,
            saveToAppleHealth: saveToAppleHealth
        )

        do {
            let reading = try await services.bp.submitManual(entry)

            // Optional Apple Health write-back — only when BOTH the global
            // setting and this entry's toggle are on.
            if saveToAppleHealth && saveToHealthDefault {
                do {
                    if !services.healthWriter.isWriteAuthorized {
                        try await services.healthWriter.requestWriteAuthorization()
                    }
                    try await services.healthWriter.saveManualReading(entry, readingId: reading.id)
                } catch {
                    // The platform save succeeded; report the Health write
                    // separately instead of failing the whole entry.
                    healthWriteNotice = (error as? LocalizedError)?.errorDescription
                        ?? "Apple Health write failed."
                    return
                }
            } else if saveToAppleHealth && !saveToHealthDefault {
                healthWriteNotice = "Turn on “Save manual readings to Apple Health” in Settings first."
                return
            }
            dismiss()
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription
                ?? "Could not save the reading."
        }
    }
}
