//
//  ContentView.swift
//  XMRigMiner-iOS
//

import SwiftUI

struct ContentView: View {
    @EnvironmentObject var miner: XMRigWrapper
    @State private var showConfig = false
    @State private var showLogs = false
    @State private var startError: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 0) {
                    StatusCardView()
                    StatsGridView()
                    LogPreviewView(showLogs: $showLogs)
                }
            }
            .background(Color(.systemGroupedBackground))
            .safeAreaInset(edge: .bottom) {
                ControlButtonsView(
                    showConfig: $showConfig,
                    startError: $startError
                )
                .background(Color(.systemGroupedBackground))
            }
            .navigationTitle("XMRig Multi")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { showConfig = true }) {
                        Image(systemName: "gear")
                    }
                }
            }
            .sheet(isPresented: $showConfig) {
                ConfigView()
            }
            .sheet(isPresented: $showLogs) {
                LogsView()
            }
            .alert("Cannot start mining", isPresented: Binding(
                get: { startError != nil },
                set: { if !$0 { startError = nil } }
            )) {
                Button("Configure") { showConfig = true }
                Button("OK", role: .cancel) { startError = nil }
            } message: {
                Text(startError ?? "")
            }
        }
    }
}

// MARK: - Status Card

struct StatusCardView: View {
    @EnvironmentObject var miner: XMRigWrapper
    
    var body: some View {
        VStack(spacing: 16) {
            HStack {
                Circle()
                    .fill(miner.isRunning ? Color.green : Color.gray)
                    .frame(width: 12, height: 12)
                Text(miner.isRunning ? "Mining" : "Stopped")
                    .font(.headline)
                Spacer()
                Text("v\(miner.version)")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            
            VStack(spacing: 4) {
                Text(String(format: "%.1f", miner.stats.hashrate10s))
                    .font(.system(size: 48, weight: .bold, design: .monospaced))
                Text("H/s")
                    .font(.title3)
                    .foregroundColor(.secondary)
            }
        }
        .padding()
        .background(Color(.secondarySystemGroupedBackground))
        .cornerRadius(16)
        .padding()
    }
}

// MARK: - Stats Grid

struct StatsGridView: View {
    @EnvironmentObject var miner: XMRigWrapper
    
    var body: some View {
        LazyVGrid(columns: [
            GridItem(.flexible()),
            GridItem(.flexible())
        ], spacing: 12) {
            StatCell(title: "Accepted", value: "\(miner.stats.acceptedShares)", color: .green)
            StatCell(title: "Rejected", value: "\(miner.stats.rejectedShares)", color: .red)
            StatCell(title: "60s Avg", value: String(format: "%.1f H/s", miner.stats.hashrate60s), color: .blue)
            StatCell(title: "Threads", value: "\(miner.stats.threads)", color: .orange)
        }
        .padding(.horizontal)
    }
}

struct StatCell: View {
    let title: String
    let value: String
    let color: Color
    
    var body: some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.title2)
                .fontWeight(.semibold)
                .foregroundColor(color)
            Text(title)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding()
        .background(Color(.secondarySystemGroupedBackground))
        .cornerRadius(12)
    }
}

// MARK: - Log Preview

struct LogPreviewView: View {
    @EnvironmentObject var miner: XMRigWrapper
    @Binding var showLogs: Bool
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Logs")
                    .font(.headline)
                Spacer()
                Button(action: { showLogs = true }) {
                    Text("View All")
                        .font(.caption)
                }
            }
            
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(miner.logs.suffix(3), id: \.self) { line in
                        Text(line)
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                    }
                }
            }
            .frame(height: 50)
        }
        .padding()
        .background(Color(.secondarySystemGroupedBackground))
        .cornerRadius(12)
        .padding(.horizontal)
    }
}

// MARK: - Full Logs View

struct LogsView: View {
    @EnvironmentObject var miner: XMRigWrapper
    @Environment(\.dismiss) var dismiss
    
    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 2) {
                        ForEach(Array(miner.logs.enumerated()), id: \.offset) { index, line in
                            Text(line)
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundColor(.primary)
                                .id(index)
                        }
                    }
                    .padding()
                }
                .onChange(of: miner.logs.count) { _ in
                    if let lastIndex = miner.logs.indices.last {
                        withAnimation {
                            proxy.scrollTo(lastIndex, anchor: .bottom)
                        }
                    }
                }
            }
            .navigationTitle("XMRig Logs")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Close") { dismiss() }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Clear") { miner.clearLogs() }
                }
            }
        }
    }
}

// MARK: - Control Buttons

struct ControlButtonsView: View {
    @EnvironmentObject var miner: XMRigWrapper
    @Binding var showConfig: Bool
    @Binding var startError: String?
    
    var body: some View {
        HStack(spacing: 16) {
            Button(action: {
                if miner.isRunning {
                    miner.stop()
                } else {
                    guard let config = MiningConfigStore.load(), !config.pool.user.isEmpty else {
                        startError = "Set a wallet address in Settings before mining."
                        showConfig = true
                        return
                    }
                    if miner.initialize(config: config) {
                        miner.start()
                    } else {
                        startError = "Failed to initialize XMRig with the saved configuration."
                    }
                }
            }) {
                Label(
                    miner.isRunning ? "Stop" : "Start",
                    systemImage: miner.isRunning ? "stop.fill" : "play.fill"
                )
                .font(.headline)
                .frame(maxWidth: .infinity)
                .padding()
                .background(miner.isRunning ? Color.red : Color.green)
                .foregroundColor(.white)
                .cornerRadius(12)
            }
        }
        .padding()
    }
}

#Preview {
    ContentView()
        .environmentObject(XMRigWrapper())
}
