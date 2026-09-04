import Foundation

enum MiningConfigStore {
    static let key = "miningConfig"

    static func load() -> MiningConfig? {
        guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(MiningConfig.self, from: data)
    }

    static func save(_ config: MiningConfig) {
        if let encoded = try? JSONEncoder().encode(config) {
            UserDefaults.standard.set(encoded, forKey: key)
        }
    }
}
