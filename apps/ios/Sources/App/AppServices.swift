import Foundation
import Observation

/// Composition root: owns configuration, the data provider (live API client or
/// demo fixtures), the offline cache, HealthKit services, and the shared
/// blood-pressure model. Injected once via `.environment(...)`.
@Observable @MainActor
public final class AppServices {
    public let config: AppConfig
    public let tokenStore: any TokenStoring
    public let cache: LocalCache
    public let provider: any BPDataProviding
    /// Present only in live mode (auth endpoints are not part of demo mode).
    public let apiClient: APIClient?
    public let healthKit: HealthKitService
    public let healthWriter: HealthKitWriter
    public let bp: BPModel

    public private(set) var isAuthenticated: Bool
    public var authError: String?

    public init(config: AppConfig = .load()) {
        self.config = config
        let cache = LocalCache()
        self.cache = cache

        if config.demoMode {
            let tokenStore = EphemeralTokenStore()
            self.tokenStore = tokenStore
            self.apiClient = nil
            self.provider = DemoPlatformProvider()
            self.isAuthenticated = true // no platform auth in demo mode
        } else if let baseURL = config.platformBaseURL {
            let tokenStore = KeychainStore()
            self.tokenStore = tokenStore
            let client = APIClient(baseURL: baseURL, tokenStore: tokenStore)
            self.apiClient = client
            self.provider = client
            self.isAuthenticated = ((try? tokenStore.readToken()) ?? nil) != nil
        } else {
            // AppConfig.load() never produces this combination (live mode
            // without URL falls back to demo), but stay total anyway.
            let tokenStore = EphemeralTokenStore()
            self.tokenStore = tokenStore
            self.apiClient = nil
            self.provider = DemoPlatformProvider()
            self.isAuthenticated = true
        }

        self.bp = BPModel(provider: provider, cache: cache)
        self.healthKit = HealthKitService(provider: provider)
        self.healthWriter = HealthKitWriter()
    }

    // MARK: - Platform auth (live mode only)

    public func login(email: String, password: String) async {
        guard let apiClient else { return }
        authError = nil
        do {
            _ = try await apiClient.login(email: email, password: password)
            isAuthenticated = true
        } catch {
            authError = (error as? APIError)?.errorDescription
                ?? "Sign-in failed. Check the platform is reachable."
        }
    }

    public func signOut() {
        try? tokenStore.deleteToken()
        isAuthenticated = false
        let cache = cache
        Task { await cache.clearAll() }
    }
}
