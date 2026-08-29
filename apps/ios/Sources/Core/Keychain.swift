import Foundation
import Security

/// Where the platform JWT lives. Never UserDefaults, never a file, never logs.
public protocol TokenStoring: Sendable {
    func readToken() throws -> String?
    func save(token: String) throws
    func deleteToken() throws
}

public enum KeychainError: Error, LocalizedError {
    case unexpectedStatus(OSStatus)
    case notUTF8

    public var errorDescription: String? {
        switch self {
        case .unexpectedStatus(let status):
            // Status codes only — never the item's value.
            return "Keychain operation failed (OSStatus \(status))."
        case .notUTF8:
            return "Keychain item was not valid UTF-8."
        }
    }
}

/// Thin generic-password wrapper. Items are device-only and require the
/// device to be unlocked (`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`),
/// so the JWT never migrates to backups or other devices.
public struct KeychainStore: TokenStoring {
    private let service: String
    private let account: String

    public init(service: String = "com.benhealth.os.platform",
                account: String = "platform-jwt") {
        self.service = service
        self.account = account
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }

    public func readToken() throws -> String? {
        var query = baseQuery
        query[kSecReturnData as String] = kCFBooleanTrue
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        switch status {
        case errSecSuccess:
            guard let data = result as? Data else { return nil }
            guard let token = String(data: data, encoding: .utf8) else {
                throw KeychainError.notUTF8
            }
            return token
        case errSecItemNotFound:
            return nil
        default:
            throw KeychainError.unexpectedStatus(status)
        }
    }

    public func save(token: String) throws {
        let data = Data(token.utf8)

        // Try update first; add if the item does not exist yet.
        let updateAttributes: [String: Any] = [kSecValueData as String: data]
        let updateStatus = SecItemUpdate(baseQuery as CFDictionary,
                                         updateAttributes as CFDictionary)
        switch updateStatus {
        case errSecSuccess:
            return
        case errSecItemNotFound:
            var addQuery = baseQuery
            addQuery[kSecValueData as String] = data
            addQuery[kSecAttrAccessible as String] =
                kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
            guard addStatus == errSecSuccess else {
                throw KeychainError.unexpectedStatus(addStatus)
            }
        default:
            throw KeychainError.unexpectedStatus(updateStatus)
        }
    }

    public func deleteToken() throws {
        let status = SecItemDelete(baseQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.unexpectedStatus(status)
        }
    }
}

/// In-memory stand-in for previews and demo mode (no Keychain traffic needed).
public final class EphemeralTokenStore: TokenStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var token: String?

    public init() {}

    public func readToken() throws -> String? {
        lock.lock(); defer { lock.unlock() }
        return token
    }

    public func save(token: String) throws {
        lock.lock(); defer { lock.unlock() }
        self.token = token
    }

    public func deleteToken() throws {
        lock.lock(); defer { lock.unlock() }
        token = nil
    }
}
