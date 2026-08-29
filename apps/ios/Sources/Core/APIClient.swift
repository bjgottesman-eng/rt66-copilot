import Foundation

// MARK: - Data-provider abstraction
//
// The BP feature talks to this protocol. Live mode uses `APIClient`
// (services/platform over HTTPS); demo mode uses `DemoPlatformProvider`
// (bundled synthetic fixtures, zero network).

public protocol BPDataProviding: Sendable {
    func latest() async throws -> LatestBpResponse
    func readings(from: Date?, to: Date?, includeDuplicates: Bool) async throws -> [BpReadingDto]
    func sessions(from: Date?, to: Date?) async throws -> [BpSessionDto]
    func summary(window: SummaryWindow) async throws -> BpSummaryDto
    func submitManual(_ entry: ManualBpEntry) async throws -> BpReadingDto
    func sources() async throws -> [SourceStatusDto]
    func withingsConnectURL() async throws -> URL
    func withingsRefresh() async throws -> Int
    func ingestHealthKit(_ batch: HealthKitBpBatch) async throws -> HealthKitIngestResponse
}

// MARK: - Errors

public enum APIError: Error, LocalizedError, Sendable {
    case notAuthenticated
    case server(status: Int, code: String, message: String)
    case invalidResponse
    case invalidURL
    case transport(underlying: String)

    public var errorDescription: String? {
        switch self {
        case .notAuthenticated:
            return "You need to sign in again."
        case .server(_, _, let message):
            return message
        case .invalidResponse:
            return "The platform returned an unexpected response."
        case .invalidURL:
            return "The platform URL is misconfigured."
        case .transport(let underlying):
            return "Could not reach the platform (\(underlying))."
        }
    }
}

// MARK: - APIClient
//
// async/await URLSession client for services/platform (`/api/v1`, contracts §5).
//
// PRIVACY: this client never logs URLs with query values, request bodies,
// response bodies, or the Authorization header. Errors surface status codes
// and the server's own error envelope message only. Do not add print/debug
// statements that would violate CLAUDE.md rule 1.

public final class APIClient: BPDataProviding, Sendable {
    private let baseURL: URL
    private let tokenStore: any TokenStoring
    private let session: URLSession

    public init(baseURL: URL, tokenStore: any TokenStoring, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.tokenStore = tokenStore
        self.session = session
    }

    // MARK: Auth

    /// `POST /api/v1/auth/login` — on success the JWT goes straight to the
    /// Keychain; it is never returned to callers or held in plain properties.
    @discardableResult
    public func login(email: String, password: String) async throws -> UserDto {
        struct LoginBody: Encodable { let email: String; let password: String }
        let response: LoginResponse = try await send(
            "POST", "auth/login",
            body: LoginBody(email: email, password: password),
            authenticated: false
        )
        try tokenStore.save(token: response.token)
        return response.user
    }

    public func me() async throws -> UserDto {
        try await send("GET", "auth/me")
    }

    public func signOut() throws {
        try tokenStore.deleteToken()
    }

    // MARK: BP endpoints (contracts §5)

    public func latest() async throws -> LatestBpResponse {
        try await send("GET", "bp/latest")
    }

    public func readings(from: Date?, to: Date?, includeDuplicates: Bool) async throws -> [BpReadingDto] {
        var query: [URLQueryItem] = []
        if let from { query.append(URLQueryItem(name: "from", value: JSONCoding.formatDate(from))) }
        if let to { query.append(URLQueryItem(name: "to", value: JSONCoding.formatDate(to))) }
        if includeDuplicates { query.append(URLQueryItem(name: "includeDuplicates", value: "true")) }
        let response: ReadingsResponse = try await send("GET", "bp/readings", query: query)
        return response.readings
    }

    public func sessions(from: Date?, to: Date?) async throws -> [BpSessionDto] {
        var query: [URLQueryItem] = []
        if let from { query.append(URLQueryItem(name: "from", value: JSONCoding.formatDate(from))) }
        if let to { query.append(URLQueryItem(name: "to", value: JSONCoding.formatDate(to))) }
        let response: SessionsResponse = try await send("GET", "bp/sessions", query: query)
        return response.sessions
    }

    public func summary(window: SummaryWindow) async throws -> BpSummaryDto {
        try await send("GET", "bp/summary",
                       query: [URLQueryItem(name: "window", value: window.rawValue)])
    }

    public func submitManual(_ entry: ManualBpEntry) async throws -> BpReadingDto {
        let response: ManualBpResponse = try await send("POST", "bp/manual", body: entry)
        return response.reading
    }

    // MARK: Sources / Withings

    public func sources() async throws -> [SourceStatusDto] {
        let response: SourcesResponse = try await send("GET", "sources")
        return response.sources
    }

    public func withingsConnectURL() async throws -> URL {
        let response: WithingsConnectResponse = try await send("POST", "sources/withings/connect")
        guard let url = URL(string: response.authorizeUrl) else {
            throw APIError.invalidResponse
        }
        return url
    }

    public func withingsRefresh() async throws -> Int {
        let response: WithingsRefreshResponse = try await send("POST", "sources/withings/refresh")
        return response.imported
    }

    // MARK: HealthKit ingestion

    public func ingestHealthKit(_ batch: HealthKitBpBatch) async throws -> HealthKitIngestResponse {
        try await send("POST", "ingest/healthkit", body: batch)
    }

    // MARK: - Request plumbing

    private func makeURL(_ path: String, query: [URLQueryItem]) throws -> URL {
        let full = baseURL.appending(path: "/api/v1/\(path)")
        guard var components = URLComponents(url: full, resolvingAgainstBaseURL: false) else {
            throw APIError.invalidURL
        }
        if !query.isEmpty {
            components.queryItems = query
        }
        guard let url = components.url else { throw APIError.invalidURL }
        return url
    }

    private func send<Response: Decodable>(
        _ method: String,
        _ path: String,
        query: [URLQueryItem] = [],
        authenticated: Bool = true
    ) async throws -> Response {
        try await perform(method, path, query: query, bodyData: nil, authenticated: authenticated)
    }

    private func send<Body: Encodable, Response: Decodable>(
        _ method: String,
        _ path: String,
        query: [URLQueryItem] = [],
        body: Body,
        authenticated: Bool = true
    ) async throws -> Response {
        let data = try JSONCoding.makeEncoder().encode(body)
        return try await perform(method, path, query: query, bodyData: data,
                                 authenticated: authenticated)
    }

    private func perform<Response: Decodable>(
        _ method: String,
        _ path: String,
        query: [URLQueryItem],
        bodyData: Data?,
        authenticated: Bool
    ) async throws -> Response {
        var request = URLRequest(url: try makeURL(path, query: query))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let bodyData {
            request.httpBody = bodyData
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if authenticated {
            guard let token = try tokenStore.readToken() else {
                throw APIError.notAuthenticated
            }
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            // Localized description only — never the request itself.
            throw APIError.transport(underlying: error.localizedDescription)
        }

        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            if http.statusCode == 401 {
                throw APIError.notAuthenticated
            }
            if let envelope = try? JSONCoding.makeDecoder().decode(ApiErrorEnvelope.self, from: data) {
                throw APIError.server(status: http.statusCode,
                                      code: envelope.error.code,
                                      message: envelope.error.message)
            }
            throw APIError.server(status: http.statusCode,
                                  code: "http_\(http.statusCode)",
                                  message: "Platform request failed (\(http.statusCode)).")
        }

        do {
            return try JSONCoding.makeDecoder().decode(Response.self, from: data)
        } catch {
            throw APIError.invalidResponse
        }
    }
}
