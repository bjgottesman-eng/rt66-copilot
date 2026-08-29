import Foundation

/// App configuration, sourced from Info.plist keys that `project.yml` wires
/// to build settings:
///
///   BHPlatformBaseURL  <- $(BH_PLATFORM_BASE_URL)   e.g. "http://localhost:8787"
///   BHDemoMode         <- $(BH_DEMO_MODE)           "YES"/"NO"
///
/// Demo mode ships bundled synthetic fixtures and never touches the network;
/// live mode requires a valid platform base URL.
public struct AppConfig: Sendable, Equatable {
    public let platformBaseURL: URL?
    public let demoMode: Bool
    /// True when the plist asked for live mode but the base URL was unusable;
    /// Settings surfaces this so a misconfiguration is never silent.
    public let fellBackToDemo: Bool

    public init(platformBaseURL: URL?, demoMode: Bool, fellBackToDemo: Bool = false) {
        self.platformBaseURL = platformBaseURL
        self.demoMode = demoMode
        self.fellBackToDemo = fellBackToDemo
    }

    public static func load(from bundle: Bundle = .main) -> AppConfig {
        let url = (bundle.object(forInfoDictionaryKey: "BHPlatformBaseURL") as? String)
            .flatMap { raw -> URL? in
                let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !trimmed.isEmpty else { return nil }
                guard let url = URL(string: trimmed), url.scheme != nil else { return nil }
                return url
            }

        let demoRequested = boolValue(bundle.object(forInfoDictionaryKey: "BHDemoMode"),
                                      default: true)

        if demoRequested {
            return AppConfig(platformBaseURL: url, demoMode: true)
        }
        guard let url else {
            // Live mode without a usable URL cannot work; fall back to demo
            // and say so, rather than crashing or silently doing nothing.
            return AppConfig(platformBaseURL: nil, demoMode: true, fellBackToDemo: true)
        }
        return AppConfig(platformBaseURL: url, demoMode: false)
    }

    /// Info.plist values arrive as Bool or as strings like "YES"/"true"/"1"
    /// depending on how the build setting was expanded.
    static func boolValue(_ object: Any?, default defaultValue: Bool) -> Bool {
        switch object {
        case let b as Bool:
            return b
        case let n as NSNumber:
            return n.boolValue
        case let s as String:
            switch s.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
            case "yes", "true", "1": return true
            case "no", "false", "0", "": return false
            default: return defaultValue
            }
        default:
            return defaultValue
        }
    }
}
