import SwiftUI

/// Main view for XMRig Watch App
/// Displays mining statistics from connected iPhone/Mac
struct ContentView: View {
    @EnvironmentObject var statsManager: MiningStatsManager

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    // Status Header — text includes sync quality (#62)
                    StatusBadge(
                        isRunning: statsManager.stats.isRunning,
                        syncLabel: statsManager.stats.syncLabel,
                        pending: statsManager.commandPending
                    )

                    // Hashrate Card
                    HashrateCard(
                        hashrate: statsManager.stats.hashrate,
                        syncQuality: statsManager.stats.syncQuality
                    )

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

                    // Control Buttons — pending shows Working, Stop always easy
                    HStack(spacing: 12) {
                        Button(action: { statsManager.requestStart() }) {
                            Image(systemName: "play.fill")
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.purple)
                        .disabled(statsManager.stats.isRunning || statsManager.commandPending)
                        .accessibilityLabel("Start mining on phone")

                        Button(action: { statsManager.requestStop() }) {
                            Image(systemName: "stop.fill")
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.red)
                        .disabled(statsManager.commandPending && !statsManager.stats.isRunning)
                        .accessibilityLabel("Stop mining on phone")
                    }

                    ConnectionStatus(
                        isConnected: statsManager.isConnected,
                        syncLabel: statsManager.stats.syncLabel,
                        ackReason: statsManager.lastAckReason
                    )
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
    var syncLabel: String = "Live"
    var pending: Bool = false

    var body: some View {
        VStack(spacing: 4) {
            Text(pending ? "Working…" : (isRunning ? "Mining" : "Stopped"))
                .font(.caption)
                .fontWeight(.semibold)
            Text(syncLabel)
                .font(.system(size: 9))
                .foregroundColor(.gray)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(
            Capsule()
                .fill(isRunning ? Color.green.opacity(0.2) : Color.gray.opacity(0.2))
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(isRunning ? "Mining" : "Stopped"), \(syncLabel)")
    }
}

struct HashrateCard: View {
    let hashrate: Double
    var syncQuality: String = "live"

    var body: some View {
        VStack(spacing: 4) {
            Text(String(format: "%.1f", hashrate))
                .font(.system(size: 36, weight: .bold, design: .rounded))
                .foregroundColor(.purple)
            Text(syncQuality == "live" ? "H/s" : "H/s (\(syncQuality))")
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
    var syncLabel: String = ""
    var ackReason: String? = nil

    var body: some View {
        VStack(spacing: 2) {
            Text(syncLabel.isEmpty ? (isConnected ? "Connected" : "Searching...") : syncLabel)
                .font(.caption2)
                .multilineTextAlignment(.center)
            if let ackReason, !ackReason.isEmpty {
                Text(ackReason)
                    .font(.system(size: 9))
                    .foregroundColor(.orange)
                    .multilineTextAlignment(.center)
            }
        }
        .foregroundColor(isConnected ? .primary : .gray)
        .accessibilityLabel(syncLabel)
    }
}

#Preview {
    ContentView()
        .environmentObject(MiningStatsManager())
}
