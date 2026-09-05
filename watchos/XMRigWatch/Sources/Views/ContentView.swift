import SwiftUI

/// Main view for XMRig Watch App
/// Displays mining statistics from connected iPhone/Mac
struct ContentView: View {
    @EnvironmentObject var statsManager: MiningStatsManager

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    // Status Header
                    StatusBadge(isRunning: statsManager.stats.isRunning)

                    // Hashrate Card
                    HashrateCard(hashrate: statsManager.stats.hashrate)

                    // Quick Stats
                    HStack(spacing: 16) {
                        StatBadge(
                            value: "\(statsManager.stats.sharesAccepted)",
                            label: "Accepted",
                            color: .green
                        )
                        StatBadge(
                            value: "\(statsManager.stats.sharesRejected)",
                            label: "Rejected",
                            color: .red
                        )
                    }

                    // Uptime
                    Text(formatUptime(statsManager.stats.uptime))
                        .font(.caption2)
                        .foregroundColor(.gray)

                    // Control Buttons
                    HStack(spacing: 12) {
                        Button(action: { statsManager.requestStart() }) {
                            Image(systemName: "play.fill")
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.purple)
                        .disabled(statsManager.stats.isRunning)

                        Button(action: { statsManager.requestStop() }) {
                            Image(systemName: "stop.fill")
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.red)
                        .disabled(!statsManager.stats.isRunning)
                    }

                    // Connection Status
                    ConnectionStatus(isConnected: statsManager.isConnected)
                }
                .padding()
            }
            .navigationTitle("XMRig Multi")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private func formatUptime(_ seconds: Int) -> String {
        let hours = seconds / 3600
        let minutes = (seconds % 3600) / 60
        if hours > 0 {
            return "Uptime: \(hours)h \(minutes)m"
        }
        return "Uptime: \(minutes)m"
    }
}

// MARK: - Subviews

struct StatusBadge: View {
    let isRunning: Bool

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(isRunning ? Color.green : Color.gray)
                .frame(width: 8, height: 8)
            Text(isRunning ? "Mining" : "Stopped")
                .font(.caption)
                .fontWeight(.semibold)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(
            Capsule()
                .fill(isRunning ? Color.green.opacity(0.2) : Color.gray.opacity(0.2))
        )
    }
}

struct HashrateCard: View {
    let hashrate: Double

    var body: some View {
        VStack(spacing: 4) {
            Text(String(format: "%.1f", hashrate))
                .font(.system(size: 36, weight: .bold, design: .rounded))
                .foregroundColor(.purple)
            Text("H/s")
                .font(.caption2)
                .foregroundColor(.gray)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.purple.opacity(0.15))
        )
    }
}

struct StatBadge: View {
    let value: String
    let label: String
    let color: Color

    var body: some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundColor(color)
            Text(label)
                .font(.system(size: 9))
                .foregroundColor(.gray)
        }
    }
}

struct ConnectionStatus: View {
    let isConnected: Bool

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: isConnected ? "iphone" : "iphone.slash")
                .font(.caption2)
            Text(isConnected ? "Connected" : "Searching...")
                .font(.caption2)
        }
        .foregroundColor(isConnected ? .green : .gray)
    }
}

#Preview {
    ContentView()
        .environmentObject(MiningStatsManager())
}
