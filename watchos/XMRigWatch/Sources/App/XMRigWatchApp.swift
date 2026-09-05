import SwiftUI
import WatchConnectivity

/// XMRig Multi Watch App
/// Stats viewer only - Apple prohibits mining apps
@main
struct XMRigWatchApp: App {
    @StateObject private var statsManager = MiningStatsManager()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(statsManager)
        }
    }
}
